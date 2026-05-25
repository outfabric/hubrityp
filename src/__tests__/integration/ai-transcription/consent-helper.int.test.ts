import { randomBytes, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import { sql as dsql } from 'drizzle-orm';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { assertAiConsentActive } from '@/modules/ai-transcription/lib/consent';
import { consentTerms } from '@/shared/db/schema/patients/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { openClient } from '../setup/db';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function seedAuthUser(userId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${userId}, ${`test-${userId}@example.com`}, '{"provider":"google"}'::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

async function seedPatient(userId: string, patientId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Test Patient',
    });
  });
}

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

interface SeedConsentOpts {
  id?: string;
  userId: string;
  patientId: string;
  signedAt?: Date | null;
  revokedAt?: Date | null;
  createdAt?: Date;
  templateVersion?: number;
}

async function seedConsentTerm(opts: SeedConsentOpts): Promise<string> {
  const id = opts.id ?? randomUUID();
  await runAsService(async (db) => {
    await db.insert(consentTerms).values({
      id,
      patientId: opts.patientId,
      userId: opts.userId,
      kind: 'ai_recording',
      termText: 'AI consent term text',
      signatureToken: generateToken(),
      signedAt: opts.signedAt ?? null,
      revokedAt: opts.revokedAt ?? null,
      templateVersion: opts.templateVersion ?? 1,
      templateSnapshot: { version: 1 },
      revocationTakesEffectImmediately: true,
      createdAt: opts.createdAt ?? new Date(),
    });
  });
  return id;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(consentTerms);
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// Helper: create a real Drizzle db for the helper (service-level, no RLS)
// ---------------------------------------------------------------------------

function openDb() {
  return openClient();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('assertAiConsentActive — real Postgres', () => {
  it('returns never_signed when no ai_recording row exists for the patient', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const { sql, db } = openDb();
    try {
      const result = await assertAiConsentActive({ userId, patientId }, { db });
      expect(result).toEqual({ ok: false, reason: 'never_signed' });
    } finally {
      await sql.end();
    }
  });

  it('returns pending_signature when term exists but is unsigned and not expired', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await seedConsentTerm({
      userId,
      patientId,
      signedAt: null,
      createdAt: new Date(), // Just created, not expired
    });

    const { sql, db } = openDb();
    try {
      const result = await assertAiConsentActive({ userId, patientId }, { db });
      expect(result).toEqual({ ok: false, reason: 'pending_signature' });
    } finally {
      await sql.end();
    }
  });

  it('returns ok with termId, signedAt, templateVersion when signed and not revoked', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const signedAt = new Date('2026-05-15T10:00:00Z');
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const termId = await seedConsentTerm({
      userId,
      patientId,
      signedAt,
      templateVersion: 1,
    });

    const { sql, db } = openDb();
    try {
      const result = await assertAiConsentActive({ userId, patientId }, { db });
      expect(result).toEqual({
        ok: true,
        termId,
        signedAt,
        templateVersion: 1,
      });
    } finally {
      await sql.end();
    }
  });

  it('returns revoked when term was signed then revoked', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await seedConsentTerm({
      userId,
      patientId,
      signedAt: new Date('2026-05-10T10:00:00Z'),
      revokedAt: new Date('2026-05-12T15:00:00Z'),
    });

    const { sql, db } = openDb();
    try {
      const result = await assertAiConsentActive({ userId, patientId }, { db });
      expect(result).toEqual({ ok: false, reason: 'revoked' });
    } finally {
      await sql.end();
    }
  });

  it('returns expired when unsigned and created_at + 7 days < now', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Created 8 days ago — past the 7-day window
    const createdAt = new Date(Date.now() - 8 * ONE_DAY_MS);
    await seedConsentTerm({
      userId,
      patientId,
      signedAt: null,
      createdAt,
    });

    const { sql, db } = openDb();
    try {
      const result = await assertAiConsentActive({ userId, patientId }, { db });
      expect(result).toEqual({ ok: false, reason: 'expired' });
    } finally {
      await sql.end();
    }
  });

  it('considers only the most recent row when multiple exist', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Older row: signed and active
    await seedConsentTerm({
      userId,
      patientId,
      signedAt: new Date('2026-05-01T10:00:00Z'),
      createdAt: new Date('2026-04-30T10:00:00Z'),
      templateVersion: 1,
    });

    // Newer row: revoked — this should be the one returned
    await seedConsentTerm({
      userId,
      patientId,
      signedAt: new Date('2026-05-10T10:00:00Z'),
      revokedAt: new Date('2026-05-12T15:00:00Z'),
      createdAt: new Date('2026-05-09T10:00:00Z'),
      templateVersion: 2,
    });

    const { sql, db } = openDb();
    try {
      const result = await assertAiConsentActive({ userId, patientId }, { db });
      // The most recent row is revoked
      expect(result).toEqual({ ok: false, reason: 'revoked' });
    } finally {
      await sql.end();
    }
  });

  it('does not log PII — no name, token, or reason keys in log output', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await seedConsentTerm({
      userId,
      patientId,
      signedAt: new Date('2026-05-15T10:00:00Z'),
    });

    // Capture log output via a Pino destination that collects lines
    const logLines: string[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _encoding: string, callback: () => void) {
        logLines.push(chunk.toString());
        callback();
      },
    });

    // Mock the logger module to use our capturing transport
    const capturingLogger = pino({ level: 'trace' }, destination);
    const mockCreateTranscriptionLogger = vi.fn(() => capturingLogger);

    // Use vi.mock to intercept the logger
    vi.doMock('@/modules/ai-transcription/lib/logger', () => ({
      createTranscriptionLogger: mockCreateTranscriptionLogger,
    }));

    // Re-import the module to pick up the mocked logger
    const { assertAiConsentActive: assertWithMockedLogger } =
      await import('@/modules/ai-transcription/lib/consent');

    const { sql, db } = openDb();
    try {
      await assertWithMockedLogger({ userId, patientId }, { db });

      // Flush the pino destination
      destination.end();
      await new Promise<void>((resolve) => destination.on('finish', resolve));

      // Verify no PII keys appear in any log line
      const PII_KEYS = ['name', 'fullName', 'patientName', 'token', 'signatureToken', 'reason'];
      for (const line of logLines) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line) as Record<string, unknown>;
        for (const key of PII_KEYS) {
          expect(parsed).not.toHaveProperty(key);
        }
      }
    } finally {
      await sql.end();
      vi.doUnmock('@/modules/ai-transcription/lib/logger');
    }
  });
});
