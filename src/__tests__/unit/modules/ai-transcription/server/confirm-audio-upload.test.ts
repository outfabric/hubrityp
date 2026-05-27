import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { confirmAudioUploadImpl } from '@/modules/ai-transcription/server/confirm-audio-upload';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Track updated rows so tests can verify the UPDATE calls
const updateCalls: Array<{
  set: Record<string, unknown>;
  id: string;
  userId: string;
}> = [];

// SELECT call tracking — ownership check for the transcription row
let selectResult: Record<string, unknown>[] = [];

vi.mock('@/shared/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(selectResult)),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((setValues: Record<string, unknown>) => ({
        where: vi.fn(() => {
          updateCalls.push({ set: setValues, id: 'mock', userId: 'mock' });
          return Promise.resolve();
        }),
      })),
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

// Mock validateAudioMagicNumbers
let mimeResult: { ok: boolean; detected?: string; reason?: string } = {
  ok: true,
  detected: 'audio/mpeg',
};

vi.mock('@/modules/ai-transcription/server/validators/mime', () => ({
  validateAudioMagicNumbers: vi.fn(() => Promise.resolve(mimeResult)),
}));

// Mock inngest
const inngestSendMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/modules/ai-transcription/inngest/client', () => ({
  inngest: { send: (...args: unknown[]) => inngestSendMock(...args) as Promise<void> },
}));

// Mock rate limiter
vi.mock('@/shared/lib/rate-limit/postgres', () => ({
  enforceRateLimit: vi.fn(() =>
    Promise.resolve({ allowed: true, remaining: 5, resetAt: new Date() }),
  ),
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
const MOCK_TRANSCRIPTION_ID = randomUUID();

/** Creates a small valid MP3-like buffer (ID3v2 header). */
function createMp3Buffer(sizeBytes: number = 1024): Buffer {
  const buf = Buffer.alloc(sizeBytes);
  // ID3v2 header: "ID3" + version (2 bytes) + flags (1 byte) + size (4 bytes)
  buf.write('ID3', 0);
  buf[3] = 0x04; // version major
  buf[4] = 0x00; // version minor
  buf[5] = 0x00; // flags
  return buf;
}

// Mock global fetch for ranged header download
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

function createMockSupabase(overrides?: {
  authenticated?: boolean;
  userId?: string;
  /** Override list result. Use [] for "not found". */
  storageListResult?: Array<{ name: string; metadata: { size: number } }> | null;
  /** Buffer to return from ranged fetch. Defaults to valid MP3 header. */
  headerBuffer?: Buffer;
  /** Size reported in list metadata. Defaults to 1MB. */
  audioSizeBytes?: number;
}) {
  const {
    authenticated = true,
    userId = MOCK_USER_ID,
    storageListResult,
    headerBuffer,
    audioSizeBytes = 1024 * 1024,
  } = overrides ?? {};

  // Set up global fetch mock for the ranged download
  const buf = headerBuffer ?? createMp3Buffer(1024);
  setupMockFetch(buf);

  // The list mock dynamically returns an object matching the search query
  // (the transcription ID). When a storageListResult override is provided,
  // it is used as-is.
  const listMock =
    storageListResult !== undefined
      ? vi.fn().mockResolvedValue({ data: storageListResult, error: null })
      : vi.fn().mockImplementation((_prefix: string, opts?: { search?: string }) => {
          const search = opts?.search ?? MOCK_TRANSCRIPTION_ID;
          return Promise.resolve({
            data: [{ name: `${search}.mp3`, metadata: { size: audioSizeBytes } }],
            error: null,
          });
        });

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: authenticated ? { id: userId } : null },
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

function validInput(
  overrides?: Partial<{
    transcriptionId: string;
    audioDurationSeconds: number | null;
  }>,
) {
  return {
    transcriptionId: overrides?.transcriptionId ?? MOCK_TRANSCRIPTION_ID,
    audioDurationSeconds:
      overrides && 'audioDurationSeconds' in overrides ? overrides.audioDurationSeconds : 300,
  };
}

function defaultRow(
  overrides?: Partial<{
    id: string;
    userId: string;
    patientId: string;
    status: string;
    audioObjectKey: string | null;
    audioSizeBytes: number | null;
  }>,
) {
  return {
    id: overrides?.id ?? MOCK_TRANSCRIPTION_ID,
    userId: overrides?.userId ?? MOCK_USER_ID,
    patientId: overrides?.patientId ?? MOCK_PATIENT_ID,
    status: overrides?.status ?? 'pending',
    audioObjectKey: overrides?.audioObjectKey ?? null,
    audioSizeBytes: overrides?.audioSizeBytes ?? 1024 * 1024,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('confirmAudioUploadImpl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateCalls.length = 0;
    selectResult = [];
    consentResult = {
      ok: true,
      termId: randomUUID(),
      signedAt: new Date(),
      templateVersion: 1,
    };
    mimeResult = { ok: true, detected: 'audio/mpeg' };
    inngestSendMock.mockResolvedValue(undefined);
  });

  // -----------------------------------------------------------------------
  // Authentication
  // -----------------------------------------------------------------------

  describe('authentication', () => {
    it('returns UNAUTHORIZED when user is anonymous', async () => {
      const supabase = createMockSupabase({ authenticated: false });

      const result = await confirmAudioUploadImpl(supabase, validInput());

      expect(result).toEqual({ ok: false, code: 'UNAUTHORIZED' });
      expect(updateCalls).toHaveLength(0);
      expect(inngestSendMock).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // IDOR prevention
  // -----------------------------------------------------------------------

  describe('IDOR prevention', () => {
    it('returns NOT_FOUND when the transcription row does not belong to the user', async () => {
      const supabase = createMockSupabase();
      // SELECT returns empty — row not found for this user
      selectResult = [];

      const result = await confirmAudioUploadImpl(supabase, validInput());

      expect(result).toEqual({ ok: false, code: 'NOT_FOUND' });
      expect(updateCalls).toHaveLength(0);
      expect(inngestSendMock).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Double-confirm idempotency
  // -----------------------------------------------------------------------

  describe('double-confirm idempotency', () => {
    it('returns ALREADY_CONFIRMED when the row status is not pending', async () => {
      const supabase = createMockSupabase();
      selectResult = [defaultRow({ status: 'transcribing' })];

      const result = await confirmAudioUploadImpl(supabase, validInput());

      expect(result).toEqual({ ok: false, code: 'ALREADY_CONFIRMED' });
      expect(updateCalls).toHaveLength(0);
      expect(inngestSendMock).not.toHaveBeenCalled();
    });

    it('returns ALREADY_CONFIRMED when audio_object_key is already set', async () => {
      const supabase = createMockSupabase();
      selectResult = [
        defaultRow({
          status: 'pending',
          audioObjectKey: `${MOCK_USER_ID}/${MOCK_TRANSCRIPTION_ID}.mp3`,
        }),
      ];

      const result = await confirmAudioUploadImpl(supabase, validInput());

      expect(result).toEqual({ ok: false, code: 'ALREADY_CONFIRMED' });
      expect(updateCalls).toHaveLength(0);
      expect(inngestSendMock).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Consent revoked between request and confirm
  // -----------------------------------------------------------------------

  describe('consent revoked between request and confirm', () => {
    it('marks row as failed with consent_revoked_during_upload and returns CONSENT_INACTIVE', async () => {
      const supabase = createMockSupabase();
      selectResult = [defaultRow()];
      consentResult = { ok: false, reason: 'revoked' };

      const result = await confirmAudioUploadImpl(supabase, validInput());

      expect(result).toEqual({ ok: false, code: 'CONSENT_INACTIVE' });
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0]!.set).toMatchObject({
        status: 'failed',
        errorCode: 'consent_revoked_during_upload',
      });
      expect(inngestSendMock).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Magic number mismatch
  // -----------------------------------------------------------------------

  describe('magic number mismatch', () => {
    it('marks row as failed with invalid_mime and returns INVALID_MIME, NO event dispatched', async () => {
      const supabase = createMockSupabase();
      selectResult = [defaultRow()];
      mimeResult = { ok: false, reason: 'mismatch' };

      const result = await confirmAudioUploadImpl(supabase, validInput());

      expect(result).toEqual({ ok: false, code: 'INVALID_MIME' });
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0]!.set).toMatchObject({
        status: 'failed',
        errorCode: 'invalid_mime',
      });
      expect(inngestSendMock).not.toHaveBeenCalled();
    });

    it('marks row as failed when MIME is undetected', async () => {
      const supabase = createMockSupabase();
      selectResult = [defaultRow()];
      mimeResult = { ok: false, reason: 'undetected' };

      const result = await confirmAudioUploadImpl(supabase, validInput());

      expect(result).toEqual({ ok: false, code: 'INVALID_MIME' });
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0]!.set).toMatchObject({
        status: 'failed',
        errorCode: 'invalid_mime',
      });
      expect(inngestSendMock).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Size mismatch
  // -----------------------------------------------------------------------

  describe('size validation', () => {
    it('returns SIZE_MISMATCH when actual size (from metadata) exceeds MAX', async () => {
      // Metadata reports size larger than the max (200MB)
      const oversizedBytes = 210 * 1024 * 1024;
      const supabase = createMockSupabase({
        audioSizeBytes: oversizedBytes,
      });
      selectResult = [defaultRow({ audioSizeBytes: oversizedBytes })];

      const result = await confirmAudioUploadImpl(supabase, validInput());

      expect(result).toEqual({ ok: false, code: 'SIZE_MISMATCH' });
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0]!.set).toMatchObject({
        status: 'failed',
        errorCode: 'size_exceeded',
      });
      expect(inngestSendMock).not.toHaveBeenCalled();
    });

    it('returns SIZE_MISMATCH when actual size deviates >5% from declared', async () => {
      // Declared: 1MB, actual metadata: 500KB (50% deviation)
      const supabase = createMockSupabase({
        audioSizeBytes: 500 * 1024,
      });
      selectResult = [defaultRow({ audioSizeBytes: 1024 * 1024 })];

      const result = await confirmAudioUploadImpl(supabase, validInput());

      expect(result).toEqual({ ok: false, code: 'SIZE_MISMATCH' });
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0]!.set).toMatchObject({
        status: 'failed',
        errorCode: 'size_mismatch',
      });
      expect(inngestSendMock).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Object not found
  // -----------------------------------------------------------------------

  describe('object not found', () => {
    it('returns NOT_FOUND when no object exists (list returns empty)', async () => {
      const supabase = createMockSupabase({
        storageListResult: [],
      });
      selectResult = [defaultRow()];

      const result = await confirmAudioUploadImpl(supabase, validInput());

      expect(result).toEqual({ ok: false, code: 'NOT_FOUND' });
      expect(updateCalls).toHaveLength(0);
      expect(inngestSendMock).not.toHaveBeenCalled();
    });

    it('returns NOT_FOUND when no object with a known extension exists', async () => {
      const supabase = createMockSupabase({
        storageListResult: [{ name: `${MOCK_TRANSCRIPTION_ID}.ogg`, metadata: { size: 1024 } }],
      });
      selectResult = [defaultRow()];

      const result = await confirmAudioUploadImpl(supabase, validInput());

      expect(result).toEqual({ ok: false, code: 'NOT_FOUND' });
      expect(updateCalls).toHaveLength(0);
      expect(inngestSendMock).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Happy path
  // -----------------------------------------------------------------------

  describe('happy path', () => {
    it('updates the row and dispatches the event on success', async () => {
      const supabase = createMockSupabase();
      selectResult = [defaultRow()];

      const result = await confirmAudioUploadImpl(supabase, validInput());

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('Expected ok result');

      expect(result.transcriptionId).toBe(MOCK_TRANSCRIPTION_ID);

      // Verify the row was updated with the object key and metadata
      expect(updateCalls).toHaveLength(1);
      const updateSet = updateCalls[0]!.set;
      expect(updateSet).toMatchObject({
        audioSizeBytes: expect.any(Number),
        audioDurationSeconds: 300,
      });
      expect(updateSet.audioObjectKey).toMatch(
        new RegExp(`^${MOCK_USER_ID}/${MOCK_TRANSCRIPTION_ID}\\.(mp3|m4a|wav|webm)$`),
      );

      // Verify the event was dispatched
      expect(inngestSendMock).toHaveBeenCalledTimes(1);
      expect(inngestSendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'ai-transcription/audio.uploaded',
          data: expect.objectContaining({
            transcriptionId: MOCK_TRANSCRIPTION_ID,
            userId: MOCK_USER_ID,
            patientId: MOCK_PATIENT_ID,
            source: 'manual_upload',
          }),
        }),
      );
    });

    it('accepts null audioDurationSeconds', async () => {
      const supabase = createMockSupabase();
      selectResult = [defaultRow()];

      const result = await confirmAudioUploadImpl(
        supabase,
        validInput({ audioDurationSeconds: null }),
      );

      expect(result.ok).toBe(true);
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0]!.set).toMatchObject({
        audioDurationSeconds: null,
      });
    });

    it('does not fail the action when inngest.send throws', async () => {
      const supabase = createMockSupabase();
      selectResult = [defaultRow()];
      inngestSendMock.mockRejectedValueOnce(new Error('Inngest down'));

      const result = await confirmAudioUploadImpl(supabase, validInput());

      // Action still succeeds — the event is fire-and-forget
      expect(result.ok).toBe(true);
      // Row was still updated (the update call before inngest.send)
      expect(updateCalls).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Input validation
  // -----------------------------------------------------------------------

  describe('input validation', () => {
    it('rejects non-UUID transcriptionId', async () => {
      const supabase = createMockSupabase();

      const result = await confirmAudioUploadImpl(supabase, {
        transcriptionId: 'not-a-uuid',
        audioDurationSeconds: 300,
      });

      expect(result).toEqual({ ok: false, code: 'NOT_FOUND' });
      expect(updateCalls).toHaveLength(0);
    });

    it('rejects negative audioDurationSeconds', async () => {
      const supabase = createMockSupabase();

      const result = await confirmAudioUploadImpl(supabase, {
        transcriptionId: MOCK_TRANSCRIPTION_ID,
        audioDurationSeconds: -10,
      });

      expect(result).toEqual({ ok: false, code: 'NOT_FOUND' });
      expect(updateCalls).toHaveLength(0);
    });
  });
});
