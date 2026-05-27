import { randomBytes, randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
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

// ---------------------------------------------------------------------------
// The implementation under test uses `db` from `@/shared/db/client` which
// connects to the Testcontainers Postgres automatically via DATABASE_URL.
// We import the implementation directly and pass a mock Supabase client
// for auth + Storage.
// ---------------------------------------------------------------------------

// We dynamically import the implementation to ensure mocks are registered first.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let requestAudioUploadUrlImpl: typeof import('@/modules/ai-transcription/server/request-audio-upload-url').requestAudioUploadUrlImpl;

// ---------------------------------------------------------------------------
// Setup: import the action after mocks
// ---------------------------------------------------------------------------

// We import dynamically to ensure vi.mock registrations take effect before the
// module is loaded.
async function importImpl() {
  const mod = await import('@/modules/ai-transcription/server/request-audio-upload-url');
  requestAudioUploadUrlImpl = mod.requestAudioUploadUrlImpl;
}

// ---------------------------------------------------------------------------
// Mock Supabase factory
// ---------------------------------------------------------------------------

function createMockSupabase(userId: string) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: userId } },
      }),
    },
    storage: {
      from: vi.fn(() => ({
        createSignedUploadUrl: vi.fn().mockResolvedValue({
          data: {
            signedUrl: 'https://storage.example.com/upload?token=abc',
            token: 'abc',
            path: 'mock/path',
          },
          error: null,
        }),
      })),
    },
  } as unknown as Parameters<typeof requestAudioUploadUrlImpl>[0];
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(async () => {
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

describe('requestAudioUploadUrl — integration (real Postgres)', () => {
  // Import the action once before all tests
  it('setup: imports the implementation', async () => {
    await importImpl();
    expect(requestAudioUploadUrlImpl).toBeDefined();
  });

  it('inserts a row with status=pending after a successful call', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedActiveConsent(userId, patientId);

    const supabase = createMockSupabase(userId);
    const result = await requestAudioUploadUrlImpl(supabase, {
      patientId,
      sessionId: null,
      contentType: 'audio/mpeg',
      sizeBytes: 1024 * 1024,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected ok result');

    // Verify the row exists in the real database
    const { sql, db } = openClient();
    try {
      const rows = await db
        .select()
        .from(aiTranscriptions)
        .where(eq(aiTranscriptions.id, result.transcriptionId));

      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.status).toBe('pending');
      expect(row.source).toBe('manual_upload');
      expect(row.userId).toBe(userId);
      expect(row.patientId).toBe(patientId);
      expect(row.sessionId).toBeNull();
      expect(row.audioSizeBytes).toBe(1024 * 1024);
      // audio_object_key is NULL at request time (set on confirm)
      expect(row.audioObjectKey).toBeNull();
    } finally {
      await sql.end();
    }
  });

  it('returns RATE_LIMITED on the 7th call within 60 seconds', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedActiveConsent(userId, patientId);

    const input = {
      patientId,
      sessionId: null,
      contentType: 'audio/mpeg' as const,
      sizeBytes: 1024 * 1024,
    };

    // Make 6 successful calls
    for (let i = 0; i < 6; i++) {
      const supabase = createMockSupabase(userId);
      const result = await requestAudioUploadUrlImpl(supabase, input);
      expect(result.ok).toBe(true);
    }

    // 7th call should be rate-limited
    const supabase = createMockSupabase(userId);
    const result = await requestAudioUploadUrlImpl(supabase, input);

    expect(result).toEqual({ ok: false, code: 'RATE_LIMITED' });

    // Verify only 6 rows were inserted (the 7th was blocked before INSERT)
    const { sql, db } = openClient();
    try {
      const rows = await db
        .select()
        .from(aiTranscriptions)
        .where(and(eq(aiTranscriptions.userId, userId), eq(aiTranscriptions.patientId, patientId)));

      expect(rows).toHaveLength(6);
    } finally {
      await sql.end();
    }
  });

  it("cross-tenant: psychologist B cannot request URL for A's patient — returns NOT_FOUND, zero rows inserted", async () => {
    // Setup: psychologist A owns a patient
    const userA = randomUUID();
    const userB = randomUUID();
    const patientOfA = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientOfA);
    await seedActiveConsent(userA, patientOfA);

    // psychologist B tries to request an upload URL for A's patient
    const supabaseB = createMockSupabase(userB);
    const result = await requestAudioUploadUrlImpl(supabaseB, {
      patientId: patientOfA,
      sessionId: null,
      contentType: 'audio/mpeg',
      sizeBytes: 1024 * 1024,
    });

    expect(result).toEqual({ ok: false, code: 'NOT_FOUND' });

    // Verify zero rows were inserted by userB
    const { sql, db } = openClient();
    try {
      const rows = await db
        .select()
        .from(aiTranscriptions)
        .where(eq(aiTranscriptions.userId, userB));

      expect(rows).toHaveLength(0);
    } finally {
      await sql.end();
    }
  });

  it('returns CONSENT_INACTIVE when no consent exists', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    // No consent seeded

    const supabase = createMockSupabase(userId);
    const result = await requestAudioUploadUrlImpl(supabase, {
      patientId,
      sessionId: null,
      contentType: 'audio/mpeg',
      sizeBytes: 1024 * 1024,
    });

    expect(result).toEqual({ ok: false, code: 'CONSENT_INACTIVE' });
  });

  it('objectKey matches the spec regex and does not contain PII', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedActiveConsent(userId, patientId);

    const supabase = createMockSupabase(userId);
    const result = await requestAudioUploadUrlImpl(supabase, {
      patientId,
      sessionId: null,
      contentType: 'audio/wav',
      sizeBytes: 1024 * 1024,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected ok result');

    const objectKeyRegex = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(mp3|m4a|wav|webm)$/;
    expect(result.objectKey).toMatch(objectKeyRegex);
    expect(result.objectKey).toContain('.wav');
  });
});
