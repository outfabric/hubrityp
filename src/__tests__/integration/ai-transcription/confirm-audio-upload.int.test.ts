import { randomBytes, randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { aiTranscriptions } from '@/shared/db/schema/ai-transcription/tables';
import { consentTerms, patients } from '@/shared/db/schema/patients/tables';
import { rateLimits } from '@/shared/db/schema/rate-limits/tables';

import { openClient } from '../setup/db';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Mock Storage SDK at module level — there is no local Supabase Storage in
// Testcontainers. Everything else (Drizzle, auth, consent, rate-limit) hits
// real Postgres.
// ---------------------------------------------------------------------------

vi.mock('@/shared/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock inngest — capture sends for event dispatch assertions
// ---------------------------------------------------------------------------

const inngestSendCalls: unknown[] = [];

vi.mock('@/modules/ai-transcription/inngest/client', () => ({
  inngest: {
    send: vi.fn((...args: unknown[]) => {
      inngestSendCalls.push(args);
      return Promise.resolve();
    }),
  },
}));

// ---------------------------------------------------------------------------
// Seed helpers
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

async function seedActiveConsent(userId: string, patientId: string): Promise<string> {
  const id = randomUUID();
  await runAsService(async (db) => {
    await db.insert(consentTerms).values({
      id,
      patientId,
      userId,
      kind: 'ai_recording',
      termText: 'AI consent term text',
      signatureToken: generateToken(),
      signedAt: new Date(),
      revokedAt: null,
      templateVersion: 1,
      templateSnapshot: { version: 1 },
      revocationTakesEffectImmediately: true,
      createdAt: new Date(),
    });
  });
  return id;
}

async function seedPendingTranscription(
  userId: string,
  patientId: string,
  transcriptionId: string,
  audioSizeBytes: number = 1024 * 1024,
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(aiTranscriptions).values({
      id: transcriptionId,
      userId,
      patientId,
      source: 'manual_upload',
      status: 'pending',
      audioSizeBytes,
      // audio_object_key is NULL at this stage (set on confirm)
    });
  });
}

// ---------------------------------------------------------------------------
// Dynamic import — ensure mocks are registered before the module loads
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let confirmAudioUploadImpl: typeof import('@/modules/ai-transcription/server/confirm-audio-upload').confirmAudioUploadImpl;

async function importImpl() {
  const mod = await import('@/modules/ai-transcription/server/confirm-audio-upload');
  confirmAudioUploadImpl = mod.confirmAudioUploadImpl;
}

// ---------------------------------------------------------------------------
// Mock Supabase factory
// ---------------------------------------------------------------------------

/**
 * Creates a small valid MP3-like buffer (ID3v2 header + sync word).
 * Used for the ranged header download mock.
 */
function createMp3HeaderBuffer(): Buffer {
  const buf = Buffer.alloc(1024);
  // Minimal valid MP3: ID3v2 header followed by a sync word
  buf.write('ID3', 0); // ID3 marker
  buf[3] = 0x04; // ID3 version major
  buf[4] = 0x00; // ID3 version minor
  buf[5] = 0x00; // flags
  // Size: synchsafe integer (4 bytes, MSB first)
  buf[6] = 0x00;
  buf[7] = 0x00;
  buf[8] = 0x00;
  buf[9] = 0x00;
  // MP3 sync word at offset 10 (0xFF 0xFB = MPEG1 Layer3)
  buf[10] = 0xff;
  buf[11] = 0xfb;
  buf[12] = 0x90; // bitrate/sample rate
  buf[13] = 0x00;
  return buf;
}

/**
 * Sets up global `fetch` mock to return the given buffer as a ranged response.
 */
function setupMockFetch(buffer: Buffer) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 206,
      arrayBuffer: () =>
        Promise.resolve(
          buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
        ),
    }),
  );
}

function createMockSupabase(
  userId: string,
  overrides?: {
    /** Override the list response. When provided, the `transcriptionId` parameter is ignored. */
    storageListResult?: Array<{ name: string; metadata: { size: number } }> | null;
    /** Buffer to use for the ranged header download. Defaults to valid MP3. */
    headerBuffer?: Buffer;
    /** Audio size reported in list metadata (defaults to 1MB). */
    audioSizeBytes?: number;
  },
) {
  const audioSize = overrides?.audioSizeBytes ?? 1024 * 1024;

  // Set up global fetch for ranged download
  const headerBuf = overrides?.headerBuffer ?? createMp3HeaderBuffer();
  setupMockFetch(headerBuf);

  // The list mock dynamically returns an object matching the search query
  // (the transcription ID). When a storageListResult override is provided,
  // it is used as-is (e.g. for "not found" tests).
  const listMock =
    overrides?.storageListResult !== undefined
      ? vi.fn().mockResolvedValue({ data: overrides.storageListResult, error: null })
      : vi.fn().mockImplementation((_prefix: string, opts?: { search?: string }) => {
          const search = opts?.search ?? 'unknown';
          return Promise.resolve({
            data: [{ name: `${search}.mp3`, metadata: { size: audioSize } }],
            error: null,
          });
        });

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: userId } },
      }),
    },
    storage: {
      from: vi.fn(() => ({
        list: listMock,
        createSignedUrl: vi.fn().mockResolvedValue({
          data: { signedUrl: 'https://storage.example.com/signed?token=abc' },
          error: null,
        }),
      })),
    },
  } as unknown as Parameters<typeof confirmAudioUploadImpl>[0];
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(async () => {
  inngestSendCalls.length = 0;
  await runAsService(async (db) => {
    await db.delete(aiTranscriptions);
    await db.delete(consentTerms);
    await db.delete(patients);
    await db.delete(rateLimits);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('confirmAudioUpload — integration (real Postgres)', () => {
  // Import the action once before all tests
  it('setup: imports the implementation', async () => {
    await importImpl();
    expect(confirmAudioUploadImpl).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Happy path
  // -----------------------------------------------------------------------

  it('updates the row and dispatches the event on a valid confirm', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();
    const audioSize = 1024 * 1024;

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedActiveConsent(userId, patientId);
    await seedPendingTranscription(userId, patientId, transcriptionId, audioSize);

    const supabase = createMockSupabase(userId);
    const result = await confirmAudioUploadImpl(supabase, {
      transcriptionId,
      audioDurationSeconds: 120,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected ok result');
    expect(result.transcriptionId).toBe(transcriptionId);

    // Verify the row in the real database
    const { sql, db } = openClient();
    try {
      const rows = await db
        .select()
        .from(aiTranscriptions)
        .where(eq(aiTranscriptions.id, transcriptionId));

      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.status).toBe('pending'); // status stays pending until the Inngest consumer changes it
      expect(row.audioObjectKey).toMatch(
        new RegExp(`^${userId}/${transcriptionId}\\.(mp3|m4a|wav|webm)$`),
      );
      expect(row.audioSizeBytes).toBe(audioSize);
      expect(row.audioDurationSeconds).toBe(120);
    } finally {
      await sql.end();
    }

    // Verify event was dispatched
    expect(inngestSendCalls).toHaveLength(1);
    const sentEvent = inngestSendCalls[0] as [{ name: string; data: unknown }];
    expect(sentEvent[0].name).toBe('ai-transcription/audio.uploaded');
  });

  // -----------------------------------------------------------------------
  // Consent revoked between request and confirm
  // -----------------------------------------------------------------------

  it('marks row as failed when consent was revoked between request and confirm', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    // Seed consent but then revoke it
    const termId = await seedActiveConsent(userId, patientId);
    await runAsService(async (db) => {
      await db
        .update(consentTerms)
        .set({ revokedAt: new Date() })
        .where(eq(consentTerms.id, termId));
    });
    await seedPendingTranscription(userId, patientId, transcriptionId);

    const supabase = createMockSupabase(userId);
    const result = await confirmAudioUploadImpl(supabase, {
      transcriptionId,
      audioDurationSeconds: null,
    });

    expect(result).toEqual({ ok: false, code: 'CONSENT_INACTIVE' });

    // Verify the row was marked as failed
    const { sql, db } = openClient();
    try {
      const rows = await db
        .select()
        .from(aiTranscriptions)
        .where(eq(aiTranscriptions.id, transcriptionId));

      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.status).toBe('failed');
      expect(row.errorCode).toBe('consent_revoked_during_upload');
    } finally {
      await sql.end();
    }

    // No event dispatched
    expect(inngestSendCalls).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Double confirm (idempotency)
  // -----------------------------------------------------------------------

  it('returns ALREADY_CONFIRMED on a second confirm call', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedActiveConsent(userId, patientId);
    await seedPendingTranscription(userId, patientId, transcriptionId, 1024 * 1024);

    const supabase = createMockSupabase(userId);

    // First confirm — should succeed
    const first = await confirmAudioUploadImpl(supabase, {
      transcriptionId,
      audioDurationSeconds: 60,
    });
    expect(first.ok).toBe(true);

    // Second confirm — should return ALREADY_CONFIRMED
    const second = await confirmAudioUploadImpl(supabase, {
      transcriptionId,
      audioDurationSeconds: 60,
    });
    expect(second).toEqual({ ok: false, code: 'ALREADY_CONFIRMED' });

    // Only one event dispatched (from the first call)
    expect(inngestSendCalls).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // Cross-tenant (IDOR)
  // -----------------------------------------------------------------------

  it("cross-tenant: psychologist B cannot confirm A's transcription — returns NOT_FOUND", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientOfA = randomUUID();
    const transcriptionId = randomUUID();

    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientOfA);
    await seedActiveConsent(userA, patientOfA);
    await seedPendingTranscription(userA, patientOfA, transcriptionId);

    // psychologist B tries to confirm A's transcription
    const supabaseB = createMockSupabase(userB);
    const result = await confirmAudioUploadImpl(supabaseB, {
      transcriptionId,
      audioDurationSeconds: 60,
    });

    expect(result).toEqual({ ok: false, code: 'NOT_FOUND' });

    // Verify the row was NOT modified
    const { sql, db } = openClient();
    try {
      const rows = await db
        .select()
        .from(aiTranscriptions)
        .where(eq(aiTranscriptions.id, transcriptionId));

      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.status).toBe('pending');
      expect(row.audioObjectKey).toBeNull();
    } finally {
      await sql.end();
    }

    // No event dispatched
    expect(inngestSendCalls).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Magic-number mismatch via real validation
  // -----------------------------------------------------------------------

  it('marks row as failed when the uploaded file has invalid magic numbers', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedActiveConsent(userId, patientId);
    await seedPendingTranscription(userId, patientId, transcriptionId, 1024);

    // Ranged header download returns garbage bytes — not a valid audio format
    const garbageBuffer = Buffer.alloc(1024);
    garbageBuffer.fill(0x42); // All 'B' bytes — not a recognized format

    const supabase = createMockSupabase(userId, {
      headerBuffer: garbageBuffer,
      audioSizeBytes: 1024,
    });

    const result = await confirmAudioUploadImpl(supabase, {
      transcriptionId,
      audioDurationSeconds: null,
    });

    expect(result).toEqual({ ok: false, code: 'INVALID_MIME' });

    // Verify the row was marked as failed
    const { sql, db } = openClient();
    try {
      const rows = await db
        .select()
        .from(aiTranscriptions)
        .where(eq(aiTranscriptions.id, transcriptionId));

      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.status).toBe('failed');
      expect(row.errorCode).toBe('invalid_mime');
    } finally {
      await sql.end();
    }

    // No event dispatched
    expect(inngestSendCalls).toHaveLength(0);
  });
});
