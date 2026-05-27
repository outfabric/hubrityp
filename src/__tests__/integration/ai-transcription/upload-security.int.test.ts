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
// Mock Storage SDK — no local Supabase Storage in Testcontainers.
// ---------------------------------------------------------------------------

vi.mock('@/shared/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock inngest — capture sends for event dispatch assertions
// ---------------------------------------------------------------------------

vi.mock('@/modules/ai-transcription/inngest/client', () => ({
  inngest: {
    send: vi.fn().mockResolvedValue(undefined),
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
    });
  });
}

// ---------------------------------------------------------------------------
// Dynamic imports — ensure mocks are registered before modules load
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let requestAudioUploadUrlImpl: typeof import('@/modules/ai-transcription/server/request-audio-upload-url').requestAudioUploadUrlImpl;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let confirmAudioUploadImpl: typeof import('@/modules/ai-transcription/server/confirm-audio-upload').confirmAudioUploadImpl;

async function importImpls() {
  const reqMod = await import('@/modules/ai-transcription/server/request-audio-upload-url');
  requestAudioUploadUrlImpl = reqMod.requestAudioUploadUrlImpl;
  const confirmMod = await import('@/modules/ai-transcription/server/confirm-audio-upload');
  confirmAudioUploadImpl = confirmMod.confirmAudioUploadImpl;
}

// ---------------------------------------------------------------------------
// Mock Supabase factory
// ---------------------------------------------------------------------------

function createMockSupabaseAnonymous() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: null },
      }),
    },
  } as unknown as Parameters<typeof requestAudioUploadUrlImpl>[0];
}

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
        list: vi.fn().mockResolvedValue({
          data: [],
          error: null,
        }),
        createSignedUrl: vi.fn().mockResolvedValue({
          data: { signedUrl: 'https://storage.example.com/signed?token=abc' },
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
// Tests — security-focused
// ---------------------------------------------------------------------------

describe('audio upload security — integration (real Postgres)', () => {
  it('setup: imports the implementations', async () => {
    await importImpls();
    expect(requestAudioUploadUrlImpl).toBeDefined();
    expect(confirmAudioUploadImpl).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // (a) Anonymous request to requestAudioUploadUrl is rejected
  // -----------------------------------------------------------------------

  it('rejects requestAudioUploadUrl when the caller is anonymous', async () => {
    const supabase = createMockSupabaseAnonymous();
    const result = await requestAudioUploadUrlImpl(supabase, {
      patientId: randomUUID(),
      sessionId: null,
      contentType: 'audio/mpeg',
      sizeBytes: 1024 * 1024,
    });

    expect(result).toEqual({ ok: false, code: 'UNAUTHORIZED' });
  });

  // -----------------------------------------------------------------------
  // (a2) Anonymous request to confirmAudioUpload is rejected
  // -----------------------------------------------------------------------

  it('rejects confirmAudioUpload when the caller is anonymous', async () => {
    const supabase = createMockSupabaseAnonymous();
    const result = await confirmAudioUploadImpl(supabase, {
      transcriptionId: randomUUID(),
      audioDurationSeconds: 60,
    });

    expect(result).toEqual({ ok: false, code: 'UNAUTHORIZED' });
  });

  // -----------------------------------------------------------------------
  // (b) objectKey regex check — 10 generated URLs have no PII leak
  // -----------------------------------------------------------------------

  it('objectKey on 10 generated URLs matches the PII-free regex', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedActiveConsent(userId, patientId);

    // Use a rate limit window large enough for 10 calls
    // (the default is 6/min, so we need to clean rate limits between batches)
    const objectKeyRegex = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(mp3|m4a|wav|webm)$/;
    const objectKeys: string[] = [];

    // First batch: 6 calls (within rate limit)
    for (let i = 0; i < 6; i++) {
      const supabase = createMockSupabase(userId);
      const result = await requestAudioUploadUrlImpl(supabase, {
        patientId,
        sessionId: null,
        contentType: 'audio/mpeg',
        sizeBytes: 1024 * 1024,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        objectKeys.push(result.objectKey);
      }
    }

    // Clear rate limits and run 4 more calls
    await runAsService(async (db) => {
      await db.delete(rateLimits);
    });

    for (let i = 0; i < 4; i++) {
      const supabase = createMockSupabase(userId);
      const result = await requestAudioUploadUrlImpl(supabase, {
        patientId,
        sessionId: null,
        contentType: 'audio/mpeg',
        sizeBytes: 1024 * 1024,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        objectKeys.push(result.objectKey);
      }
    }

    // Verify all 10 object keys match the spec regex and contain no PII
    expect(objectKeys).toHaveLength(10);
    for (const key of objectKeys) {
      expect(key).toMatch(objectKeyRegex);
      // No email, name, or patient identifier in the key (only UUIDs)
      expect(key).not.toContain('test');
      expect(key).not.toContain('patient');
      expect(key).not.toContain('@');
    }

    // All keys should be unique
    const unique = new Set(objectKeys);
    expect(unique.size).toBe(10);
  });

  // -----------------------------------------------------------------------
  // (c) Signed URL TTL expires within 5 minutes
  // -----------------------------------------------------------------------

  it('signed URL expiresAt is within 5 minutes of now', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedActiveConsent(userId, patientId);

    const before = Date.now();
    const supabase = createMockSupabase(userId);
    const result = await requestAudioUploadUrlImpl(supabase, {
      patientId,
      sessionId: null,
      contentType: 'audio/mpeg',
      sizeBytes: 1024 * 1024,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected ok result');

    const expiresAtMs = result.expiresAt.getTime();
    const fiveMinutesMs = 5 * 60 * 1000;

    // expiresAt should be between now and now+5min (±1 second tolerance)
    expect(expiresAtMs).toBeGreaterThan(before);
    expect(expiresAtMs).toBeLessThanOrEqual(before + fiveMinutesMs + 1000);

    // More precisely, the TTL should be approximately 300 seconds
    const ttlSeconds = (expiresAtMs - before) / 1000;
    expect(ttlSeconds).toBeGreaterThan(295); // allow small clock drift
    expect(ttlSeconds).toBeLessThanOrEqual(301);
  });

  // -----------------------------------------------------------------------
  // (d) Cross-tenant IDOR on confirmAudioUpload rejected with NOT_FOUND
  // -----------------------------------------------------------------------

  it("cross-tenant IDOR: psychologist B cannot confirm A's transcription", async () => {
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

    // Verify A's row was NOT modified
    const { sql, db } = openClient();
    try {
      const rows = await db
        .select()
        .from(aiTranscriptions)
        .where(and(eq(aiTranscriptions.id, transcriptionId), eq(aiTranscriptions.userId, userA)));

      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      // Status unchanged, no object key set
      expect(row.status).toBe('pending');
      expect(row.audioObjectKey).toBeNull();
    } finally {
      await sql.end();
    }
  });
});
