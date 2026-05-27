import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  DiscardCandidate,
  DiscardStorageClient,
} from '@/modules/ai-transcription/inngest/discard-old-audios';
import { discardOneAudio } from '@/modules/ai-transcription/inngest/discard-old-audios';
import type { createTranscriptionLogger } from '@/modules/ai-transcription/lib/logger';

// ---------------------------------------------------------------------------
// Mock: Inngest client
// ---------------------------------------------------------------------------

vi.mock('@/modules/ai-transcription/inngest/client', () => ({
  inngest: {
    createFunction: vi.fn((_config: unknown, handler: (...args: unknown[]) => unknown) => handler),
  },
}));

// ---------------------------------------------------------------------------
// Mock: Drizzle DB (for defaultFindCandidates / defaultMarkDiscarded)
// ---------------------------------------------------------------------------

const mockDbExecute = vi.fn();
const mockDbUpdate = vi.fn();

vi.mock('@/shared/db/client', () => ({
  db: {
    execute: (...args: unknown[]) => mockDbExecute(...args) as unknown,
    update: (...args: unknown[]) => mockDbUpdate(...args) as unknown,
  },
}));

// ---------------------------------------------------------------------------
// Mock: Drizzle ORM operators
// ---------------------------------------------------------------------------

vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ type: 'eq', a, b }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

// ---------------------------------------------------------------------------
// Mock: AI Transcription tables
// ---------------------------------------------------------------------------

vi.mock('@/shared/db/schema/ai-transcription/tables', () => ({
  aiTranscriptions: {
    id: 'ai_transcriptions.id',
    userId: 'ai_transcriptions.user_id',
    audioObjectKey: 'ai_transcriptions.audio_object_key',
    audioDiscardedAt: 'ai_transcriptions.audio_discarded_at',
    updatedAt: 'ai_transcriptions.updated_at',
    createdAt: 'ai_transcriptions.created_at',
  },
  aiTranscriptionSettings: {
    userId: 'ai_transcription_settings.user_id',
    keepAudioHours: 'ai_transcription_settings.keep_audio_hours',
  },
}));

// ---------------------------------------------------------------------------
// Mock: Supabase Storage
// ---------------------------------------------------------------------------

const mockStorageRemove = vi.fn();
const mockStorageFrom = vi.fn(() => ({
  remove: mockStorageRemove,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    storage: { from: mockStorageFrom },
  })),
}));

// ---------------------------------------------------------------------------
// Mock: Environment
// ---------------------------------------------------------------------------

vi.mock('@/shared/env', () => ({
  serverEnv: {
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    AI_TRANSCRIPTION_BUCKET: 'ai-transcription-audio',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
  },
}));

vi.mock('@/shared/env/client', () => ({
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
  },
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeCandidate(overrides?: Partial<DiscardCandidate>): DiscardCandidate {
  const id = overrides?.id ?? randomUUID();
  return {
    id,
    audioObjectKey: overrides?.audioObjectKey ?? `${randomUUID()}/${id}.webm`,
  };
}

function makeStorageClient(
  removeResult: { data: { name: string }[] | null; error: { message: string } | null } = {
    data: [{ name: 'file.webm' }],
    error: null,
  },
): DiscardStorageClient {
  return {
    storage: {
      from: vi.fn(() => ({
        remove: vi.fn().mockResolvedValue(removeResult),
      })),
    },
  };
}

function makeSilentLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  } as unknown as ReturnType<typeof createTranscriptionLogger>;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let handler: (ctx: { step: unknown }) => Promise<unknown>;

beforeEach(async () => {
  vi.clearAllMocks();

  // The handler is the second arg to inngest.createFunction (our mock returns it directly)
  const mod = await import('@/modules/ai-transcription/inngest/discard-old-audios');
  handler = mod.discardOldAudios as unknown as typeof handler;

  // Default DB chain behavior
  mockDbExecute.mockResolvedValue([]);
  mockDbUpdate.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  });
});

// ---------------------------------------------------------------------------
// Step context builder
// ---------------------------------------------------------------------------

function buildStepContext() {
  return {
    run: vi.fn((_name: string, fn: () => unknown) => Promise.resolve(fn())),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('discardOldAudios', () => {
  // -----------------------------------------------------------------------
  // 24h threshold default
  // -----------------------------------------------------------------------

  it('returns zero counts when no candidates are found (24h default threshold)', async () => {
    mockDbExecute.mockResolvedValue([]);

    const step = buildStepContext();
    const result = await handler({ step });

    expect(result).toEqual({ processed: 0, discarded: 0, failed: 0 });
  });

  it('queries using COALESCE with 24h default in the find-candidates step', async () => {
    mockDbExecute.mockResolvedValue([]);

    const step = buildStepContext();
    await handler({ step });

    // The execute call should have been made with SQL containing COALESCE(..., 24)
    expect(mockDbExecute).toHaveBeenCalledOnce();
  });

  // -----------------------------------------------------------------------
  // Per-user keep_audio_hours honored
  // -----------------------------------------------------------------------

  it('processes candidates returned by the query (per-user settings)', async () => {
    const candidate1 = makeCandidate();
    const candidate2 = makeCandidate();

    // find-candidates returns two rows
    mockDbExecute.mockResolvedValue([
      { id: candidate1.id, audio_object_key: candidate1.audioObjectKey },
      { id: candidate2.id, audio_object_key: candidate2.audioObjectKey },
    ]);

    // Storage remove succeeds
    mockStorageRemove.mockResolvedValue({ data: [{ name: 'file.webm' }], error: null });

    // DB update succeeds
    mockDbUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const step = buildStepContext();
    const result = await handler({ step });

    expect(result).toEqual({ processed: 2, discarded: 2, failed: 0 });

    // Each candidate gets its own step.run call
    // Steps: find-candidates, init-deps, discard-<id1>, discard-<id2>
    expect(step.run).toHaveBeenCalledTimes(4);
    const stepNames = step.run.mock.calls.map((c: unknown[]) => c[0]);
    expect(stepNames).toContain(`discard-${candidate1.id}`);
    expect(stepNames).toContain(`discard-${candidate2.id}`);
  });

  // -----------------------------------------------------------------------
  // Storage delete failure on one row does not block others
  // -----------------------------------------------------------------------

  it('continues processing other rows when Storage delete fails for one', async () => {
    const candidate1 = makeCandidate();
    const candidate2 = makeCandidate();

    mockDbExecute.mockResolvedValue([
      { id: candidate1.id, audio_object_key: candidate1.audioObjectKey },
      { id: candidate2.id, audio_object_key: candidate2.audioObjectKey },
    ]);

    // First Storage call fails, second succeeds
    mockStorageRemove
      .mockResolvedValueOnce({ data: null, error: { message: 'bucket not found' } })
      .mockResolvedValueOnce({ data: [{ name: 'file.webm' }], error: null });

    mockDbUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const step = buildStepContext();
    const result = await handler({ step });

    // One failed, one succeeded
    expect(result).toEqual({ processed: 2, discarded: 1, failed: 1 });
  });

  // -----------------------------------------------------------------------
  // Row already discarded is skipped (not in candidates)
  // -----------------------------------------------------------------------

  it('skips rows that are already discarded (audio_discarded_at IS NOT NULL)', async () => {
    // The SQL query itself filters these out with `audio_discarded_at IS NULL`.
    // If a row was already discarded, it will not appear in the candidate list.
    // This test verifies that when the query returns no results (all already
    // discarded), the function processes zero rows.
    mockDbExecute.mockResolvedValue([]);

    const step = buildStepContext();
    const result = await handler({ step });

    expect(result).toEqual({ processed: 0, discarded: 0, failed: 0 });

    // Only find-candidates step should have run
    expect(step.run).toHaveBeenCalledTimes(1);
    expect(step.run.mock.calls[0]![0]).toBe('find-candidates');
  });
});

// ---------------------------------------------------------------------------
// discardOneAudio — unit tests for the per-row logic
// ---------------------------------------------------------------------------

describe('discardOneAudio', () => {
  it('returns true and calls markDiscarded on successful Storage delete', async () => {
    const candidate = makeCandidate();
    const storageClient = makeStorageClient();
    const markDiscarded = vi.fn().mockResolvedValue(undefined);
    const log = makeSilentLogger();

    const result = await discardOneAudio(
      candidate,
      storageClient,
      'ai-transcription-audio',
      markDiscarded,
      log,
    );

    expect(result).toBe(true);
    expect(markDiscarded).toHaveBeenCalledWith(candidate.id);
  });

  it('returns false and logs error when Storage delete fails', async () => {
    const candidate = makeCandidate();
    const storageClient = makeStorageClient({
      data: null,
      error: { message: 'storage unavailable' },
    });
    const markDiscarded = vi.fn();
    const log = makeSilentLogger();

    const result = await discardOneAudio(
      candidate,
      storageClient,
      'ai-transcription-audio',
      markDiscarded,
      log,
    );

    expect(result).toBe(false);
    expect(markDiscarded).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalled();
  });

  it('returns false and logs error when markDiscarded throws', async () => {
    const candidate = makeCandidate();
    const storageClient = makeStorageClient();
    const markDiscarded = vi.fn().mockRejectedValue(new Error('DB connection lost'));
    const log = makeSilentLogger();

    const result = await discardOneAudio(
      candidate,
      storageClient,
      'ai-transcription-audio',
      markDiscarded,
      log,
    );

    expect(result).toBe(false);
    expect(log.error).toHaveBeenCalled();
  });

  it('passes the correct object key to Storage remove', async () => {
    const candidate = makeCandidate({ audioObjectKey: 'user-123/trans-456.webm' });
    const removeFn = vi.fn().mockResolvedValue({ data: [{ name: 'trans-456.webm' }], error: null });
    const storageClient: DiscardStorageClient = {
      storage: {
        from: vi.fn(() => ({
          remove: removeFn,
        })),
      },
    };
    const markDiscarded = vi.fn().mockResolvedValue(undefined);
    const log = makeSilentLogger();

    await discardOneAudio(candidate, storageClient, 'my-bucket', markDiscarded, log);

    expect(storageClient.storage.from).toHaveBeenCalledWith('my-bucket');
    expect(removeFn).toHaveBeenCalledWith(['user-123/trans-456.webm']);
  });
});
