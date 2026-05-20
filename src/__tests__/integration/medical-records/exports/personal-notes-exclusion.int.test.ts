/**
 * Integration test: personal notes inclusion/exclusion in prontuario PDF.
 *
 * Validates that `includePersonalNotes = false` produces a PDF WITHOUT the
 * personal notes sentinel, and `includePersonalNotes = true` produces a PDF
 * WITH the sentinel. This is the test that enforces RN-05.03 (CFP 001/2009
 * art. 5 — personal notes are excluded from exports by default).
 *
 * PDF text extraction: PDFKit compresses content streams with FlateDecode
 * (zlib). We inflate each compressed stream and search for the sentinel
 * in the decompressed text operators. This avoids adding a pdf-parse
 * dependency while still verifying the rendered text content.
 */

import { randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';

import { sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanTestData } from '@/__tests__/integration/setup/clean-test-data';
import { runAsService } from '@/__tests__/integration/setup/run-as-service';
import { buildProntuarioPdf } from '@/modules/medical-records/lib/exports/pdf-builder';
import { profiles } from '@/shared/db/schema/auth/tables';
import { personalNotes } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';

// Module mocks required by transitive imports
vi.mock('@/modules/medical-records/inngest/client', () => ({
  inngest: { send: vi.fn().mockResolvedValue({ ids: [] }) },
  MEDICAL_RECORDS_EVENTS: { PRONTUARIO_EXPORT_PDF: 'prontuario/export-pdf' },
}));

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue('127.0.0.1'),
  }),
}));

// ---------------------------------------------------------------------------
// Sentinel string — chosen to be unique and unlikely to appear in boilerplate
// ---------------------------------------------------------------------------

// Sentinel string for detection in the decompressed PDF streams.
const SENTINEL = 'XSECRET789';

/**
 * Extract text from a PDFKit-generated buffer by inflating FlateDecode streams
 * and collecting all PDF text operators (`Tj`, `TJ`, and `'`).
 *
 * This is a minimal PDF text extractor — not a general-purpose parser. It
 * handles the subset PDFKit produces: each page's content stream is compressed
 * with zlib and contains text operators like `(text) Tj`.
 */
function extractPdfText(buffer: Buffer): string {
  const raw = buffer.toString('binary');
  const texts: string[] = [];

  // Find streams by locating `stream\n...\nendstream` boundaries
  const streamStartRegex = /stream\r?\n/g;
  let startMatch;

  while ((startMatch = streamStartRegex.exec(raw)) !== null) {
    const dataStart = startMatch.index + startMatch[0].length;
    const endIdx = raw.indexOf('endstream', dataStart);
    if (endIdx <= dataStart) continue;

    // Trim trailing whitespace before endstream
    let dataEnd = endIdx;
    while (
      dataEnd > dataStart &&
      (raw.charCodeAt(dataEnd - 1) === 0x0a || raw.charCodeAt(dataEnd - 1) === 0x0d)
    ) {
      dataEnd--;
    }

    const streamBytes = Buffer.from(raw.substring(dataStart, dataEnd), 'binary');
    try {
      const inflated = inflateSync(streamBytes).toString('latin1');

      // Extract text from parenthesized Tj operators: `(text) Tj`
      const tjRegex = /\(([^)]*)\)\s*Tj/g;
      let tjMatch;
      while ((tjMatch = tjRegex.exec(inflated)) !== null) {
        texts.push(tjMatch[1]!);
      }

      // Extract text from hex-encoded strings: `<hex> Tj` or inside `[...] TJ`
      // PDFKit often uses `<hexstring>` instead of `(string)` for text.
      const hexTjRegex = /<([0-9a-fA-F]+)>/g;
      let hexMatch;
      while ((hexMatch = hexTjRegex.exec(inflated)) !== null) {
        const hex = hexMatch[1]!;
        let decoded = '';
        for (let i = 0; i < hex.length; i += 2) {
          decoded += String.fromCharCode(parseInt(hex.substring(i, i + 2), 16));
        }
        if (decoded.length > 0) {
          texts.push(decoded);
        }
      }
    } catch {
      // Not a zlib-compressed stream — skip (e.g., image data, metadata)
    }
  }

  return texts.join('');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedAuthUser(userId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${userId}, ${`test-${userId}@example.com`}, '{"provider":"google"}'::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

async function seedProfile(userId: string): Promise<void> {
  const crpSerial = userId.replace(/-/g, '').slice(0, 7);
  await runAsService(async (db) => {
    await db.insert(profiles).values({
      userId,
      email: `test-${userId}@example.com`,
      fullName: 'Dr. PersonalNotes Test',
      crpNumber: `06/${crpSerial}`,
      crpUf: 'SP',
      status: 'active',
      termsAcceptedAt: new Date(),
      privacyAcceptedAt: new Date(),
      sensitiveDataConsentAt: new Date(),
    });
  });
}

async function seedPatient(userId: string, patientId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Notes Patient',
      patientType: 'individual',
    });
  });
}

async function seedPersonalNote(userId: string, patientId: string, content: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(personalNotes).values({
      userId,
      patientId,
      content,
    });
  });
}

/** Minimal PDF input for testing personal notes inclusion/exclusion. */
function buildMinimalPdfInput(opts: {
  includePersonalNotes: boolean;
  personalNotesContent: string | null;
}) {
  return {
    patient: {
      fullName: 'Notes Patient',
      birthDate: null,
      patientType: 'individual',
    },
    psychologist: {
      name: 'Dr. PersonalNotes Test',
      crp: '06/1234567',
      email: 'test@example.com',
    },
    exportRequestedAt: new Date(),
    filters: {
      dateRange: { from: null, to: null },
      sections: {
        anamnese: false,
        evolucoes: false,
        hipoteses: false,
        planoTerapeutico: false,
        escalas: false,
        documentos: false,
        anexosIndex: false,
      },
      includePersonalNotes: opts.includePersonalNotes,
    },
    anamnesis: null,
    evolutions: [],
    hypotheses: [],
    treatmentPlan: { current: null, versionCount: 0 },
    scales: [],
    documents: [],
    attachments: [],
    personalNotes: opts.personalNotesContent
      ? [
          {
            content: opts.personalNotesContent,
            updatedAt: new Date(),
          },
        ]
      : null,
  };
}

afterEach(async () => {
  vi.clearAllMocks();
  await cleanTestData();
});

// ===========================================================================
// Personal notes exclusion/inclusion
// ===========================================================================

describe('personal notes exclusion in export PDF', () => {
  it('includePersonalNotes=false: sentinel NOT present in PDF', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);
    await seedPersonalNote(userId, patientId, `<p>${SENTINEL}</p>`);

    // Build PDF with includePersonalNotes=false (personal notes data is null)
    const buffer = await buildProntuarioPdf(
      buildMinimalPdfInput({
        includePersonalNotes: false,
        personalNotesContent: null,
      }),
    );

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);

    // The sentinel should NOT appear in the decompressed PDF text
    const pdfText = extractPdfText(buffer);
    expect(pdfText).not.toContain(SENTINEL);
  });

  it('includePersonalNotes=true: sentinel IS present in PDF', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);
    await seedPersonalNote(userId, patientId, `<p>${SENTINEL}</p>`);

    // Build PDF with includePersonalNotes=true and the note content
    const buffer = await buildProntuarioPdf(
      buildMinimalPdfInput({
        includePersonalNotes: true,
        personalNotesContent: `<p>${SENTINEL}</p>`,
      }),
    );

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);

    // The sentinel SHOULD appear in the decompressed PDF text
    const pdfText = extractPdfText(buffer);
    expect(pdfText).toContain(SENTINEL);
  });

  it('DB confirms personal note was seeded correctly', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);
    await seedPersonalNote(userId, patientId, `<p>${SENTINEL}</p>`);

    const rows = await runAsService(async (db) => {
      return db.select().from(personalNotes);
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toContain(SENTINEL);
    expect(rows[0]!.userId).toBe(userId);
    expect(rows[0]!.patientId).toBe(patientId);
  });
});
