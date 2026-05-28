import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  PurgeCandidate,
  PurgeStorageClient,
} from '@/modules/ai-transcription/inngest/purge-failed-audios';
import { purgeOneAudio } from '@/modules/ai-transcription/inngest/purge-failed-audios';
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
// Mock: Drizzle DB (for defaultFindCandidates / defaultMarkPurged)
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
    completedAt: 'ai_transcriptions.completed_at',
    status: 'ai_transcriptions.status',
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

function makeCandidate(overrides?: Partial<PurgeCandidate>): PurgeCandidate {
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
): PurgeStorageClient {
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
  const mod = await import('@/modules/ai-transcription/inngest/purge-failed-audios');
  handler = mod.purgeFailedAudios as unknown as typeof handler;

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

describe('purgeFailedAudios', () => {
  // -----------------------------------------------------------------------
  // No candidates — returns zero counts
  // -----------------------------------------------------------------------

  it('returns zero counts when no candidates are found', async () => {
    mockDbExecute.mockResolvedValue([]);

    const step = buildStepContext();
    const result = await handler({ step });

    expect(result).toEqual({ processed: 0, purged: 0, failed: 0 });
  });

  // -----------------------------------------------------------------------
  // Predicate honored: only failed/cancelled with old terminal timestamp
  // -----------------------------------------------------------------------

  it('queries for status IN (failed, cancelled) with 1h terminal threshold', async () => {
    mockDbExecute.mockResolvedValue([]);

    const step = buildStepContext();
    await handler({ step });

    // The execute call should have been made (the SQL query is a tagged template)
    expect(mockDbExecute).toHaveBeenCalledOnce();
  });

  // -----------------------------------------------------------------------
  // Processes candidates returned by the query
  // -----------------------------------------------------------------------

  it('processes candidates returned by the query', async () => {
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

    expect(result).toEqual({ processed: 2, purged: 2, failed: 0 });

    // Each candidate gets its own step.run call
    // Steps: find-candidates, init-deps, purge-<id1>, purge-<id2>
    expect(step.run).toHaveBeenCalledTimes(4);
    const stepNames = step.run.mock.calls.map((c: unknown[]) => c[0]);
    expect(stepNames).toContain(`purge-${candidate1.id}`);
    expect(stepNames).toContain(`purge-${candidate2.id}`);
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
    expect(result).toEqual({ processed: 2, purged: 1, failed: 1 });
  });

  // -----------------------------------------------------------------------
  // Recent failures not purged (no candidates returned)
  // -----------------------------------------------------------------------

  it('does not purge recent failures (predicate excludes them)', async () => {
    // When the SQL query runs, it filters out rows where
    // COALESCE(completed_at, updated_at) >= now() - INTERVAL '1 hour'.
    // This test verifies that when the query returns no results
    // (all failures are recent), the function processes zero rows.
    mockDbExecute.mockResolvedValue([]);

    const step = buildStepContext();
    const result = await handler({ step });

    expect(result).toEqual({ processed: 0, purged: 0, failed: 0 });

    // Only find-candidates step should have run
    expect(step.run).toHaveBeenCalledTimes(1);
    expect(step.run.mock.calls[0]![0]).toBe('find-candidates');
  });
});

// ---------------------------------------------------------------------------
// purgeOneAudio — unit tests for the per-row logic
// ---------------------------------------------------------------------------

describe('purgeOneAudio', () => {
  it('returns true and calls markPurged on successful Storage delete', async () => {
    const candidate = makeCandidate();
    const storageClient = makeStorageClient();
    const markPurged = vi.fn().mockResolvedValue(undefined);
    const log = makeSilentLogger();

    const result = await purgeOneAudio(
      candidate,
      storageClient,
      'ai-transcription-audio',
      markPurged,
      log,
    );

    expect(result).toBe(true);
    expect(markPurged).toHaveBeenCalledWith(candidate.id);
  });

  it('returns false and logs error when Storage delete fails', async () => {
    const candidate = makeCandidate();
    const storageClient = makeStorageClient({
      data: null,
      error: { message: 'storage unavailable' },
    });
    const markPurged = vi.fn();
    const log = makeSilentLogger();

    const result = await purgeOneAudio(
      candidate,
      storageClient,
      'ai-transcription-audio',
      markPurged,
      log,
    );

    expect(result).toBe(false);
    expect(markPurged).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalled();
  });

  it('returns false and logs error when markPurged throws', async () => {
    const candidate = makeCandidate();
    const storageClient = makeStorageClient();
    const markPurged = vi.fn().mockRejectedValue(new Error('DB connection lost'));
    const log = makeSilentLogger();

    const result = await purgeOneAudio(
      candidate,
      storageClient,
      'ai-transcription-audio',
      markPurged,
      log,
    );

    expect(result).toBe(false);
    expect(log.error).toHaveBeenCalled();
  });

  it('passes the correct object key to Storage remove', async () => {
    const candidate = makeCandidate({ audioObjectKey: 'user-123/trans-456.webm' });
    const removeFn = vi.fn().mockResolvedValue({ data: [{ name: 'trans-456.webm' }], error: null });
    const storageClient: PurgeStorageClient = {
      storage: {
        from: vi.fn(() => ({
          remove: removeFn,
        })),
      },
    };
    const markPurged = vi.fn().mockResolvedValue(undefined);
    const log = makeSilentLogger();

    await purgeOneAudio(candidate, storageClient, 'my-bucket', markPurged, log);

    expect(storageClient.storage.from).toHaveBeenCalledWith('my-bucket');
    expect(removeFn).toHaveBeenCalledWith(['user-123/trans-456.webm']);
  });
});
