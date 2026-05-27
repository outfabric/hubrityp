import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestAudioUploadUrlImpl } from '@/modules/ai-transcription/server/request-audio-upload-url';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Track inserted rows so tests can verify the INSERT
const insertedRows: Record<string, unknown>[] = [];
// Track deleted IDs for cleanup assertions
const deletedFilters: Array<{ id: string; userId: string }> = [];

// Select call tracking — ownership check for patient + session
let selectCallIndex = 0;
let selectResults: Record<string, unknown>[][] = [];

vi.mock('@/shared/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => {
            const result = selectResults[selectCallIndex] ?? [];
            selectCallIndex++;
            return Promise.resolve(result);
          }),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((row: Record<string, unknown>) => {
        insertedRows.push(row);
        const id = randomUUID();
        return {
          returning: vi.fn(() => Promise.resolve([{ id }])),
        };
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => {
        // Track but don't need to inspect details for unit tests
        deletedFilters.push({ id: 'mock', userId: 'mock' });
        return Promise.resolve();
      }),
    })),
  },
}));

// Mock assertAiConsentActive
let consentResult: {
  ok: boolean;
  reason?: string;
  termId?: string;
  signedAt?: Date;
  templateVersion?: number;
} = {
  ok: true,
  termId: randomUUID(),
  signedAt: new Date(),
  templateVersion: 1,
};

vi.mock('@/modules/ai-transcription/lib/consent', () => ({
  assertAiConsentActive: vi.fn(() => Promise.resolve(consentResult)),
}));

// Mock rate limiter
let rateLimitResult = { allowed: true, remaining: 5, resetAt: new Date(Date.now() + 60_000) };

vi.mock('@/shared/lib/rate-limit/postgres', () => ({
  enforceRateLimit: vi.fn(() => Promise.resolve(rateLimitResult)),
}));

// Mock serverEnv
vi.mock('@/shared/env', () => ({
  serverEnv: {
    AI_TRANSCRIPTION_MAX_AUDIO_MB: 200,
    AI_TRANSCRIPTION_BUCKET: 'ai-transcription-audio',
  },
}));

// Mock logger
vi.mock('@/shared/lib/logger', () => ({
  logger: {
    child: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

vi.mock('@/modules/ai-transcription/lib/logger', () => ({
  createTranscriptionLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_USER_ID = randomUUID();
const MOCK_PATIENT_ID = randomUUID();
const MOCK_SESSION_ID = randomUUID();

function createMockSupabase(overrides?: {
  authenticated?: boolean;
  userId?: string;
  storageError?: boolean;
}) {
  const { authenticated = true, userId = MOCK_USER_ID, storageError = false } = overrides ?? {};

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: authenticated ? { id: userId } : null },
      }),
    },
    storage: {
      from: vi.fn(() => ({
        createSignedUploadUrl: vi.fn().mockResolvedValue(
          storageError
            ? { data: null, error: new Error('Storage error') }
            : {
                data: {
                  signedUrl: 'https://storage.example.com/upload?token=abc',
                  token: 'abc',
                  path: 'mock/path',
                },
                error: null,
              },
        ),
      })),
    },
  } as unknown as Parameters<typeof requestAudioUploadUrlImpl>[0];
}

function validInput(
  overrides?: Partial<{
    patientId: string;
    sessionId: string | null;
    contentType: string;
    sizeBytes: number;
  }>,
) {
  return {
    patientId: overrides?.patientId ?? MOCK_PATIENT_ID,
    sessionId: overrides?.sessionId ?? null,
    contentType: overrides?.contentType ?? 'audio/mpeg',
    sizeBytes: overrides?.sizeBytes ?? 1024 * 1024, // 1 MB
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('requestAudioUploadUrlImpl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertedRows.length = 0;
    deletedFilters.length = 0;
    selectCallIndex = 0;
    selectResults = [];
    consentResult = { ok: true, termId: randomUUID(), signedAt: new Date(), templateVersion: 1 };
    rateLimitResult = { allowed: true, remaining: 5, resetAt: new Date(Date.now() + 60_000) };
  });

  // -----------------------------------------------------------------------
  // Authentication
  // -----------------------------------------------------------------------

  describe('authentication', () => {
    it('returns UNAUTHORIZED when user is anonymous', async () => {
      const supabase = createMockSupabase({ authenticated: false });

      const result = await requestAudioUploadUrlImpl(supabase, validInput());

      expect(result).toEqual({ ok: false, code: 'UNAUTHORIZED' });
      expect(insertedRows).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // IDOR — patient ownership
  // -----------------------------------------------------------------------

  describe('IDOR prevention', () => {
    it('returns NOT_FOUND when patient does not belong to the user', async () => {
      const supabase = createMockSupabase();
      // Patient ownership check returns empty → not found
      selectResults = [[]];

      const result = await requestAudioUploadUrlImpl(supabase, validInput());

      expect(result).toEqual({ ok: false, code: 'NOT_FOUND' });
      expect(insertedRows).toHaveLength(0);
    });

    it('returns NOT_FOUND when session does not belong to user/patient', async () => {
      const supabase = createMockSupabase();
      // Patient found, but session not found
      selectResults = [[{ id: MOCK_PATIENT_ID }], []];

      const result = await requestAudioUploadUrlImpl(
        supabase,
        validInput({ sessionId: MOCK_SESSION_ID }),
      );

      expect(result).toEqual({ ok: false, code: 'NOT_FOUND' });
      expect(insertedRows).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Consent
  // -----------------------------------------------------------------------

  describe('consent', () => {
    it('returns CONSENT_INACTIVE when no active AI consent exists', async () => {
      const supabase = createMockSupabase();
      selectResults = [[{ id: MOCK_PATIENT_ID }]]; // Patient found
      consentResult = { ok: false, reason: 'never_signed' };

      const result = await requestAudioUploadUrlImpl(supabase, validInput());

      expect(result).toEqual({ ok: false, code: 'CONSENT_INACTIVE' });
      expect(insertedRows).toHaveLength(0);
    });

    it('returns CONSENT_INACTIVE when consent is revoked', async () => {
      const supabase = createMockSupabase();
      selectResults = [[{ id: MOCK_PATIENT_ID }]];
      consentResult = { ok: false, reason: 'revoked' };

      const result = await requestAudioUploadUrlImpl(supabase, validInput());

      expect(result).toEqual({ ok: false, code: 'CONSENT_INACTIVE' });
      expect(insertedRows).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Content type validation
  // -----------------------------------------------------------------------

  describe('content type validation', () => {
    it('returns CONTENT_TYPE_NOT_ALLOWED for disallowed content type', async () => {
      const supabase = createMockSupabase();
      // No need for select results — Zod rejects before DB query

      const result = await requestAudioUploadUrlImpl(
        supabase,
        validInput({ contentType: 'application/x-msdownload' }),
      );

      expect(result).toEqual({ ok: false, code: 'CONTENT_TYPE_NOT_ALLOWED' });
      expect(insertedRows).toHaveLength(0);
    });

    it('accepts all five allowed content types', async () => {
      const allowedTypes = [
        'audio/mpeg',
        'audio/mp4',
        'audio/wav',
        'audio/webm',
        'audio/x-m4a',
      ] as const;

      for (const contentType of allowedTypes) {
        selectCallIndex = 0;
        insertedRows.length = 0;
        selectResults = [[{ id: MOCK_PATIENT_ID }]]; // Patient found
        consentResult = {
          ok: true,
          termId: randomUUID(),
          signedAt: new Date(),
          templateVersion: 1,
        };
        rateLimitResult = { allowed: true, remaining: 5, resetAt: new Date(Date.now() + 60_000) };

        const supabase = createMockSupabase();
        const result = await requestAudioUploadUrlImpl(supabase, validInput({ contentType }));

        expect(result.ok).toBe(true);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Size validation
  // -----------------------------------------------------------------------

  describe('size validation', () => {
    it('returns SIZE_EXCEEDED when sizeBytes exceeds the limit', async () => {
      const supabase = createMockSupabase();
      selectResults = [[{ id: MOCK_PATIENT_ID }]]; // Patient found

      // 210 MB — above the 200 MB default limit
      const result = await requestAudioUploadUrlImpl(
        supabase,
        validInput({ sizeBytes: 210 * 1024 * 1024 }),
      );

      expect(result).toEqual({ ok: false, code: 'SIZE_EXCEEDED' });
      expect(insertedRows).toHaveLength(0);
    });

    it('accepts sizeBytes exactly at the limit', async () => {
      const supabase = createMockSupabase();
      selectResults = [[{ id: MOCK_PATIENT_ID }]];

      const result = await requestAudioUploadUrlImpl(
        supabase,
        validInput({ sizeBytes: 200 * 1024 * 1024 }),
      );

      expect(result.ok).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Rate limiting
  // -----------------------------------------------------------------------

  describe('rate limiting', () => {
    it('returns RATE_LIMITED when the rate limit is exceeded', async () => {
      const supabase = createMockSupabase();
      selectResults = [[{ id: MOCK_PATIENT_ID }]]; // Patient found
      rateLimitResult = { allowed: false, remaining: 0, resetAt: new Date(Date.now() + 30_000) };

      const result = await requestAudioUploadUrlImpl(supabase, validInput());

      expect(result).toEqual({ ok: false, code: 'RATE_LIMITED' });
      expect(insertedRows).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Happy path
  // -----------------------------------------------------------------------

  describe('happy path', () => {
    it('inserts a row with status=pending and returns a signed URL', async () => {
      const supabase = createMockSupabase();
      selectResults = [[{ id: MOCK_PATIENT_ID }]]; // Patient found

      const result = await requestAudioUploadUrlImpl(supabase, validInput());

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('Expected ok result');

      // Verify the inserted row
      expect(insertedRows).toHaveLength(1);
      const row = insertedRows[0]!;
      expect(row).toMatchObject({
        userId: MOCK_USER_ID,
        patientId: MOCK_PATIENT_ID,
        sessionId: null,
        source: 'manual_upload',
        status: 'pending',
        audioSizeBytes: 1024 * 1024,
      });

      // Verify the returned data
      expect(result.transcriptionId).toBeDefined();
      expect(result.uploadUrl).toBe('https://storage.example.com/upload?token=abc');
      expect(result.expiresAt).toBeInstanceOf(Date);
      // TTL should be ≤ 5 minutes from now
      const fiveMinutesFromNow = Date.now() + 5 * 60 * 1000;
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(fiveMinutesFromNow);
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('inserts a row with sessionId when provided', async () => {
      const supabase = createMockSupabase();
      // Patient found, session found
      selectResults = [[{ id: MOCK_PATIENT_ID }], [{ id: MOCK_SESSION_ID }]];

      const result = await requestAudioUploadUrlImpl(
        supabase,
        validInput({ sessionId: MOCK_SESSION_ID }),
      );

      expect(result.ok).toBe(true);
      expect(insertedRows).toHaveLength(1);
      expect(insertedRows[0]).toMatchObject({
        sessionId: MOCK_SESSION_ID,
      });
    });
  });

  // -----------------------------------------------------------------------
  // Object key format
  // -----------------------------------------------------------------------

  describe('object key format', () => {
    it('matches the spec regex pattern — UUIDs and allowed extension, no PII', async () => {
      const objectKeyRegex = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(mp3|m4a|wav|webm)$/;

      const contentTypeToExt: Record<string, string> = {
        'audio/mpeg': 'mp3',
        'audio/mp4': 'm4a',
        'audio/wav': 'wav',
        'audio/webm': 'webm',
        'audio/x-m4a': 'm4a',
      };

      for (const [contentType, expectedExt] of Object.entries(contentTypeToExt)) {
        selectCallIndex = 0;
        insertedRows.length = 0;
        selectResults = [[{ id: MOCK_PATIENT_ID }]];
        consentResult = {
          ok: true,
          termId: randomUUID(),
          signedAt: new Date(),
          templateVersion: 1,
        };
        rateLimitResult = { allowed: true, remaining: 5, resetAt: new Date(Date.now() + 60_000) };

        const supabase = createMockSupabase();
        const result = await requestAudioUploadUrlImpl(supabase, validInput({ contentType }));

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('Expected ok result');

        expect(result.objectKey).toMatch(objectKeyRegex);
        expect(result.objectKey).toContain(`.${expectedExt}`);
        // Verify the key starts with the user's ID
        expect(result.objectKey.startsWith(MOCK_USER_ID)).toBe(true);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Storage error handling
  // -----------------------------------------------------------------------

  describe('storage errors', () => {
    it('cleans up the inserted row and returns NOT_FOUND on storage failure', async () => {
      const supabase = createMockSupabase({ storageError: true });
      selectResults = [[{ id: MOCK_PATIENT_ID }]]; // Patient found

      const result = await requestAudioUploadUrlImpl(supabase, validInput());

      // Row was inserted then deleted
      expect(insertedRows).toHaveLength(1);
      expect(deletedFilters).toHaveLength(1);
      expect(result).toEqual({ ok: false, code: 'NOT_FOUND' });
    });
  });

  // -----------------------------------------------------------------------
  // Input validation edge cases
  // -----------------------------------------------------------------------

  describe('input validation', () => {
    it('rejects non-UUID patientId', async () => {
      const supabase = createMockSupabase();

      const result = await requestAudioUploadUrlImpl(
        supabase,
        validInput({ patientId: 'not-a-uuid' }),
      );

      expect(result.ok).toBe(false);
      expect(insertedRows).toHaveLength(0);
    });

    it('rejects negative sizeBytes', async () => {
      const supabase = createMockSupabase();

      const result = await requestAudioUploadUrlImpl(supabase, validInput({ sizeBytes: -100 }));

      expect(result.ok).toBe(false);
      expect(insertedRows).toHaveLength(0);
    });

    it('rejects zero sizeBytes', async () => {
      const supabase = createMockSupabase();

      const result = await requestAudioUploadUrlImpl(supabase, validInput({ sizeBytes: 0 }));

      expect(result.ok).toBe(false);
      expect(insertedRows).toHaveLength(0);
    });
  });
});
