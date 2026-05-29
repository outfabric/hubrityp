import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — all mutable state and mock fns live in a single vi.hoisted
// block so vi.mock() factories can reference them before module evaluation.
// ---------------------------------------------------------------------------

const NEW_SESSION_ID = '880e8400-e29b-41d4-a716-446655440003';

const mocks = vi.hoisted(() => {
  const mockInngestSend = vi.fn();
  const mockLoggerError = vi.fn();

  // The "old session" returned by the ownership query.
  let currentOldSession: Record<string, unknown> | undefined = {};

  const mockSelectWhere = vi.fn().mockImplementation(() => {
    return Promise.resolve(currentOldSession ? [currentOldSession] : []);
  });

  // The transaction inserts the new session (returning its id), then cancels
  // the old one, then writes two history rows.
  const mockTransaction = vi
    .fn()
    .mockImplementation(
      async (
        fn: (tx: {
          insert: ReturnType<typeof vi.fn>;
          update: ReturnType<typeof vi.fn>;
        }) => Promise<unknown>,
      ) => {
        const tx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              // The first insert (new session) reads .returning(); history
              // inserts resolve the values() promise directly. We satisfy both
              // by returning a thenable that also exposes returning().
              returning: vi
                .fn()
                .mockResolvedValue([{ id: '880e8400-e29b-41d4-a716-446655440003' }]),
              then: (resolve: (v: unknown) => void) => resolve(undefined),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(undefined),
            }),
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
    setOldSession: (session: Record<string, unknown> | undefined) => {
      currentOldSession = session;
    },
  };
});

vi.mock('@/modules/agenda/inngest/client', () => ({
  inngest: { send: mocks.mockInngestSend },
}));

vi.mock('@/shared/lib/logger', () => ({
  logger: { error: mocks.mockLoggerError, info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/modules/agenda/lib/date-helpers', () => ({
  calculateEndTime: (start: Date, mins: number) => new Date(start.getTime() + mins * 60_000),
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
import { completeRescheduleImpl } from '@/modules/agenda/server/complete-reschedule';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OLD_SESSION_ID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_USER_ID = '660e8400-e29b-41d4-a716-446655440001';
const VALID_PATIENT_ID = '770e8400-e29b-41d4-a716-446655440002';

function farFutureStart(): Date {
  return new Date(Date.now() + 48 * 60 * 60 * 1000);
}

function futureIsoString(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(16, 0, 0, 0);
  return tomorrow.toISOString();
}

function buildOldSession(overrides: Record<string, unknown> = {}) {
  return {
    id: OLD_SESSION_ID,
    userId: VALID_USER_ID,
    patientId: VALID_PATIENT_ID,
    status: 'confirmed',
    startAt: farFutureStart(),
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

function validNewSessionInput(overrides: Record<string, unknown> = {}) {
  return {
    patient_id: VALID_PATIENT_ID,
    is_blocking: false,
    start_at: futureIsoString(),
    duration_minutes: 50,
    modality: 'in_person',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('completeRescheduleImpl — Inngest event emission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setOldSession(buildOldSession());
    mocks.mockInngestSend.mockResolvedValue({ ids: ['evt-1'] });
  });

  // -----------------------------------------------------------------------
  // (a) Successful reschedule emits both oldSessionId and newSessionId
  // -----------------------------------------------------------------------

  it('emits agenda/session.rescheduled with both old and new session ids', async () => {
    const supabase = createMockSupabase(VALID_USER_ID);

    const result = await completeRescheduleImpl(supabase, OLD_SESSION_ID, validNewSessionInput());

    expect(result).toEqual({ ok: true, newSessionId: NEW_SESSION_ID });
    expect(mocks.mockInngestSend).toHaveBeenCalledTimes(1);

    const sendArg = mocks.mockInngestSend.mock.calls[0]![0] as {
      name: string;
      data: Record<string, unknown>;
    };
    expect(sendArg.name).toBe('agenda/session.rescheduled');
    expect(sendArg.data.oldSessionId).toBe(OLD_SESSION_ID);
    expect(sendArg.data.newSessionId).toBe(NEW_SESSION_ID);
    expect(sendArg.data.userId).toBe(VALID_USER_ID);
    expect(sendArg.data.patientId).toBe(VALID_PATIENT_ID);
    expect(sendArg.data.rescheduledAt).toBeInstanceOf(Date);

    expect(mocks.mockLoggerError).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // (b) Fire-and-forget on failure
  // -----------------------------------------------------------------------

  it('returns { ok: true, newSessionId } even when inngest.send() throws', async () => {
    mocks.mockInngestSend.mockRejectedValueOnce(new Error('Inngest is down'));
    const supabase = createMockSupabase(VALID_USER_ID);

    const result = await completeRescheduleImpl(supabase, OLD_SESSION_ID, validNewSessionInput());

    expect(result).toEqual({ ok: true, newSessionId: NEW_SESSION_ID });
  });

  it('logs structured error when inngest.send() fails', async () => {
    mocks.mockInngestSend.mockRejectedValueOnce(new Error('Connection refused'));
    const supabase = createMockSupabase(VALID_USER_ID);

    await completeRescheduleImpl(supabase, OLD_SESSION_ID, validNewSessionInput());

    expect(mocks.mockLoggerError).toHaveBeenCalledTimes(1);
    const [logPayload, logMessage] = mocks.mockLoggerError.mock.calls[0]! as [
      Record<string, unknown>,
      string,
    ];
    expect(logPayload.event).toBe('inngest_send_failed');
    expect(logPayload.eventName).toBe('agenda/session.rescheduled');
    expect(logPayload.oldSessionId).toBe(OLD_SESSION_ID);
    expect(logPayload.newSessionId).toBe(NEW_SESSION_ID);
    expect(logPayload.error).toBe('Connection refused');
    expect(logMessage).toBe('failed to send agenda/session.rescheduled event');
  });

  it('logs "unknown" when inngest.send() rejects with a non-Error value', async () => {
    mocks.mockInngestSend.mockRejectedValueOnce('network timeout');
    const supabase = createMockSupabase(VALID_USER_ID);

    await completeRescheduleImpl(supabase, OLD_SESSION_ID, validNewSessionInput());

    const [logPayload] = mocks.mockLoggerError.mock.calls[0]! as [Record<string, unknown>, string];
    expect(logPayload.error).toBe('unknown');
  });
});
