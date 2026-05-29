import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — all mutable state and mock fns live in a single vi.hoisted
// block so vi.mock() factories can reference them before module evaluation.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockInngestSend = vi.fn();
  const mockLoggerError = vi.fn();

  // The "existing session" returned by the ownership query.
  let currentExistingSession: Record<string, unknown> | undefined = {};
  // The row returned by the transaction's update().returning() — `null`
  // simulates a concurrent modification (optimistic lock miss).
  let updateReturnRow: { id: string } | null = { id: 'updated' };

  const mockSelectWhere = vi.fn().mockImplementation(() => {
    return Promise.resolve(currentExistingSession ? [currentExistingSession] : []);
  });

  const mockTransaction = vi
    .fn()
    .mockImplementation(
      async (
        fn: (tx: {
          update: ReturnType<typeof vi.fn>;
          insert: ReturnType<typeof vi.fn>;
        }) => Promise<unknown>,
      ) => {
        const tx = {
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue(updateReturnRow ? [updateReturnRow] : []),
              }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue(undefined),
          }),
        };
        return fn(tx);
      },
    );

  return {
    mockInngestSend,
    mockLoggerError,
    mockSelectWhere,
    mockTransaction,
    setExistingSession: (session: Record<string, unknown> | undefined) => {
      currentExistingSession = session;
    },
    setUpdateReturnRow: (row: { id: string } | null) => {
      updateReturnRow = row;
    },
  };
});

vi.mock('@/modules/agenda/inngest/client', () => ({
  inngest: { send: mocks.mockInngestSend },
}));

vi.mock('@/shared/lib/logger', () => ({
  logger: { error: mocks.mockLoggerError, info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/shared/db/client', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: mocks.mockSelectWhere,
      }),
    }),
    transaction: mocks.mockTransaction,
  },
}));

vi.mock('@/shared/db/schema/agenda/tables', () => ({
  sessions: {
    id: 'sessions.id',
    userId: 'sessions.userId',
    patientId: 'sessions.patientId',
    status: 'sessions.status',
  },
  sessionHistory: {
    sessionId: 'sessionHistory.sessionId',
    userId: 'sessionHistory.userId',
    action: 'sessionHistory.action',
    changes: 'sessionHistory.changes',
  },
}));

// Import the module under test (after mocks are set up)
import { confirmSessionImpl } from '@/modules/agenda/server/confirm-session';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_ID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_USER_ID = '660e8400-e29b-41d4-a716-446655440001';
const VALID_PATIENT_ID = '770e8400-e29b-41d4-a716-446655440002';

function buildExistingSession(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    userId: VALID_USER_ID,
    patientId: VALID_PATIENT_ID,
    status: 'scheduled',
    ...overrides,
  };
}

function createMockSupabase(userId: string | null): SupabaseClient {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as unknown as SupabaseClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('confirmSessionImpl — Inngest event emission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setExistingSession(buildExistingSession());
    mocks.setUpdateReturnRow({ id: SESSION_ID });
    mocks.mockInngestSend.mockResolvedValue({ ids: ['evt-1'] });
  });

  // -----------------------------------------------------------------------
  // (a) Successful confirm emits with confirmedBy: 'therapist'
  // -----------------------------------------------------------------------

  it('calls inngest.send() with agenda/session.confirmed and confirmedBy: therapist', async () => {
    const supabase = createMockSupabase(VALID_USER_ID);

    const result = await confirmSessionImpl(supabase, SESSION_ID);

    expect(result).toEqual({ ok: true });
    expect(mocks.mockInngestSend).toHaveBeenCalledTimes(1);

    const sendArg = mocks.mockInngestSend.mock.calls[0]![0] as {
      name: string;
      data: Record<string, unknown>;
    };
    expect(sendArg.name).toBe('agenda/session.confirmed');
    expect(sendArg.data.sessionId).toBe(SESSION_ID);
    expect(sendArg.data.userId).toBe(VALID_USER_ID);
    expect(sendArg.data.patientId).toBe(VALID_PATIENT_ID);
    expect(sendArg.data.confirmedBy).toBe('therapist');
    expect(sendArg.data.confirmedAt).toBeInstanceOf(Date);

    expect(mocks.mockLoggerError).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // (b) Fire-and-forget on failure
  // -----------------------------------------------------------------------

  it('returns { ok: true } even when inngest.send() throws', async () => {
    mocks.mockInngestSend.mockRejectedValueOnce(new Error('Inngest is down'));
    const supabase = createMockSupabase(VALID_USER_ID);

    const result = await confirmSessionImpl(supabase, SESSION_ID);

    expect(result).toEqual({ ok: true });
  });

  it('logs structured error when inngest.send() fails', async () => {
    mocks.mockInngestSend.mockRejectedValueOnce(new Error('Connection refused'));
    const supabase = createMockSupabase(VALID_USER_ID);

    await confirmSessionImpl(supabase, SESSION_ID);

    expect(mocks.mockLoggerError).toHaveBeenCalledTimes(1);
    const [logPayload, logMessage] = mocks.mockLoggerError.mock.calls[0]! as [
      Record<string, unknown>,
      string,
    ];
    expect(logPayload.event).toBe('inngest_send_failed');
    expect(logPayload.eventName).toBe('agenda/session.confirmed');
    expect(logPayload.sessionId).toBe(SESSION_ID);
    expect(logPayload.error).toBe('Connection refused');
    expect(logMessage).toBe('failed to send agenda/session.confirmed event');
  });

  it('logs "unknown" when inngest.send() rejects with a non-Error value', async () => {
    mocks.mockInngestSend.mockRejectedValueOnce(42);
    const supabase = createMockSupabase(VALID_USER_ID);

    await confirmSessionImpl(supabase, SESSION_ID);

    const [logPayload] = mocks.mockLoggerError.mock.calls[0]! as [Record<string, unknown>, string];
    expect(logPayload.error).toBe('unknown');
  });

  // -----------------------------------------------------------------------
  // (c) Concurrent modification does not emit an event
  // -----------------------------------------------------------------------

  it('does not emit an event when the optimistic lock misses (concurrent modification)', async () => {
    // The status changed between the read and the conditional update, so the
    // update returns no row.
    mocks.setUpdateReturnRow(null);
    const supabase = createMockSupabase(VALID_USER_ID);

    const result = await confirmSessionImpl(supabase, SESSION_ID);

    expect(result).toEqual({
      ok: false,
      error: 'concurrent_modification',
      message: expect.any(String),
    });
    expect(mocks.mockInngestSend).not.toHaveBeenCalled();
  });
});
