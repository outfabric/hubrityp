import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — all mutable state and mock fns live in a single vi.hoisted
// block so vi.mock() factories can reference them before module evaluation.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockInngestSend = vi.fn();
  const mockLoggerError = vi.fn();

  // Tracks which select() call we are on so each call site gets the
  // appropriate mock data.
  let selectCallCount = 0;

  // The "existing session" returned by the ownership query (call #1).
  let currentExistingSession: Record<string, unknown> = {};

  const mockSelectWhere = vi.fn().mockImplementation(() => {
    selectCallCount++;
    if (selectCallCount === 1) {
      return Promise.resolve([currentExistingSession]);
    }
    return {
      limit: vi.fn().mockResolvedValue([{ id: 'owned-entity-uuid' }]),
      then: (resolve: (v: unknown[]) => void) => resolve([]),
      map: vi.fn().mockReturnValue([]),
    };
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
              where: vi.fn().mockResolvedValue(undefined),
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
    setExistingSession: (session: Record<string, unknown>) => {
      currentExistingSession = session;
    },
    resetSelectCallCount: () => {
      selectCallCount = 0;
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

vi.mock('@/modules/agenda/lib/detect-conflicts', () => ({
  detectConflicts: () => [],
}));

vi.mock('@/shared/db/client', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: mocks.mockSelectWhere,
        }),
        where: mocks.mockSelectWhere,
      }),
    }),
    transaction: mocks.mockTransaction,
  },
}));

vi.mock('@/shared/db/schema/patients/tables', () => ({
  patients: {
    id: 'patients.id',
    userId: 'patients.userId',
    fullName: 'patients.fullName',
  },
}));

vi.mock('@/shared/db/schema/agenda/tables', () => ({
  sessions: {
    id: 'sessions.id',
    userId: 'sessions.userId',
    patientId: 'sessions.patientId',
    startAt: 'sessions.startAt',
    endAt: 'sessions.endAt',
    blockingTitle: 'sessions.blockingTitle',
    status: 'sessions.status',
    deletedAt: 'sessions.deletedAt',
  },
  sessionHistory: {
    sessionId: 'sessionHistory.sessionId',
    userId: 'sessionHistory.userId',
    action: 'sessionHistory.action',
    changes: 'sessionHistory.changes',
  },
  locations: {
    id: 'locations.id',
    userId: 'locations.userId',
  },
}));

// Import the module under test (after mocks are set up)
import { updateSessionImpl } from '@/modules/agenda/server/update-session';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_ID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_USER_ID = '660e8400-e29b-41d4-a716-446655440001';
const VALID_PATIENT_ID = '770e8400-e29b-41d4-a716-446655440002';

const EXISTING_SESSION_START = new Date('2026-06-20T14:00:00Z');
const EXISTING_SESSION_END = new Date('2026-06-20T14:50:00Z');

function buildExistingSession(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    userId: VALID_USER_ID,
    patientId: VALID_PATIENT_ID,
    recurrenceId: null,
    patientIds: null,
    isLateRecord: false,
    isBlocking: false,
    blockingTitle: null,
    startAt: EXISTING_SESSION_START,
    endAt: EXISTING_SESSION_END,
    durationMinutes: 50,
    locationId: null,
    modality: 'online',
    amount: null,
    notes: null,
    color: null,
    status: 'confirmed',
    cancellationReason: null,
    cancelledBy: null,
    cancellationNotice: null,
    cancelledAt: null,
    chargeCancellation: false,
    confirmationToken: null,
    confirmedAt: null,
    rescheduledToSessionId: null,
    rescheduledFromSessionId: null,
    remindersDisabled: false,
    deletedAt: null,
    createdAt: new Date('2026-06-10T10:00:00Z'),
    updatedAt: new Date('2026-06-10T10:00:00Z'),
    ...overrides,
  };
}

function futureIsoString(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(15, 0, 0, 0);
  return tomorrow.toISOString();
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

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    patient_id: VALID_PATIENT_ID,
    is_blocking: false,
    start_at: futureIsoString(),
    duration_minutes: 50,
    modality: 'in_person',
    force_conflict: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('updateSessionImpl — Inngest event emission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetSelectCallCount();
    mocks.setExistingSession(buildExistingSession());
    mocks.mockInngestSend.mockResolvedValue({ ids: ['evt-1'] });
  });

  // -----------------------------------------------------------------------
  // (a) Successful update calls inngest.send() with correct event + payload
  // -----------------------------------------------------------------------

  it('calls inngest.send() with agenda/session.updated and correct payload', async () => {
    const supabase = createMockSupabase(VALID_USER_ID);
    const input = validInput();

    const result = await updateSessionImpl(supabase, SESSION_ID, input);

    expect(result).toEqual({ ok: true });

    expect(mocks.mockInngestSend).toHaveBeenCalledTimes(1);
    const sendArg = mocks.mockInngestSend.mock.calls[0]![0] as {
      name: string;
      data: Record<string, unknown>;
    };

    expect(sendArg.name).toBe('agenda/session.updated');
    expect(sendArg.data.sessionId).toBe(SESSION_ID);
    expect(sendArg.data.userId).toBe(VALID_USER_ID);
    expect(sendArg.data.patientId).toBe(VALID_PATIENT_ID);
    expect(sendArg.data.modality).toBe('in_person');
    expect(sendArg.data.startAt).toBeInstanceOf(Date);
    expect(sendArg.data.endAt).toBeInstanceOf(Date);
  });

  it('includes previousModality from the existing session record', async () => {
    mocks.setExistingSession(buildExistingSession({ modality: 'online' }));
    const supabase = createMockSupabase(VALID_USER_ID);
    const input = validInput({ modality: 'in_person' });

    await updateSessionImpl(supabase, SESSION_ID, input);

    const sendArg = mocks.mockInngestSend.mock.calls[0]![0] as {
      name: string;
      data: Record<string, unknown>;
    };
    expect(sendArg.data.previousModality).toBe('online');
  });

  // -----------------------------------------------------------------------
  // (b) Fire-and-forget: inngest.send() failure does not cause operation to fail
  // -----------------------------------------------------------------------

  it('returns { ok: true } even when inngest.send() throws', async () => {
    mocks.mockInngestSend.mockRejectedValueOnce(new Error('Inngest is down'));

    const supabase = createMockSupabase(VALID_USER_ID);
    const input = validInput();

    const result = await updateSessionImpl(supabase, SESSION_ID, input);

    expect(result).toEqual({ ok: true });
  });

  it('returns { ok: true } when inngest.send() rejects with a non-Error value', async () => {
    mocks.mockInngestSend.mockRejectedValueOnce('network timeout');

    const supabase = createMockSupabase(VALID_USER_ID);
    const input = validInput();

    const result = await updateSessionImpl(supabase, SESSION_ID, input);

    expect(result).toEqual({ ok: true });
  });

  // -----------------------------------------------------------------------
  // (c) previousModality reflects the value from the existing session, not input
  // -----------------------------------------------------------------------

  it('previousModality reflects existing session modality regardless of input modality', async () => {
    mocks.setExistingSession(buildExistingSession({ modality: 'in_person' }));
    const supabase = createMockSupabase(VALID_USER_ID);
    const input = validInput({ modality: 'online' });

    await updateSessionImpl(supabase, SESSION_ID, input);

    const sendArg = mocks.mockInngestSend.mock.calls[0]![0] as {
      name: string;
      data: Record<string, unknown>;
    };
    expect(sendArg.data.previousModality).toBe('in_person');
    expect(sendArg.data.modality).toBe('online');
  });

  it('previousModality is null when existing session had no modality', async () => {
    mocks.setExistingSession(buildExistingSession({ modality: null }));
    const supabase = createMockSupabase(VALID_USER_ID);
    const input = validInput({ modality: 'online' });

    await updateSessionImpl(supabase, SESSION_ID, input);

    const sendArg = mocks.mockInngestSend.mock.calls[0]![0] as {
      name: string;
      data: Record<string, unknown>;
    };
    expect(sendArg.data.previousModality).toBeNull();
  });

  // -----------------------------------------------------------------------
  // (d) status uses existing.status, not a hardcoded value
  // -----------------------------------------------------------------------

  it('status uses existing.status (confirmed) not a default value', async () => {
    mocks.setExistingSession(buildExistingSession({ status: 'confirmed' }));
    const supabase = createMockSupabase(VALID_USER_ID);
    const input = validInput();

    await updateSessionImpl(supabase, SESSION_ID, input);

    const sendArg = mocks.mockInngestSend.mock.calls[0]![0] as {
      name: string;
      data: Record<string, unknown>;
    };
    expect(sendArg.data.status).toBe('confirmed');
  });

  it('status uses existing.status (scheduled) when session is in scheduled state', async () => {
    mocks.setExistingSession(buildExistingSession({ status: 'scheduled' }));
    const supabase = createMockSupabase(VALID_USER_ID);
    const input = validInput();

    await updateSessionImpl(supabase, SESSION_ID, input);

    const sendArg = mocks.mockInngestSend.mock.calls[0]![0] as {
      name: string;
      data: Record<string, unknown>;
    };
    expect(sendArg.data.status).toBe('scheduled');
  });

  // -----------------------------------------------------------------------
  // Error logging
  // -----------------------------------------------------------------------

  it('logs structured error when inngest.send() fails', async () => {
    mocks.mockInngestSend.mockRejectedValueOnce(new Error('Connection refused'));

    const supabase = createMockSupabase(VALID_USER_ID);
    const input = validInput();

    await updateSessionImpl(supabase, SESSION_ID, input);

    expect(mocks.mockLoggerError).toHaveBeenCalledTimes(1);

    const [logPayload, logMessage] = mocks.mockLoggerError.mock.calls[0]! as [
      Record<string, unknown>,
      string,
    ];
    expect(logPayload.event).toBe('inngest_send_failed');
    expect(logPayload.eventName).toBe('agenda/session.updated');
    expect(logPayload.sessionId).toBe(SESSION_ID);
    expect(logPayload.error).toBe('Connection refused');
    expect(logMessage).toBe('failed to send agenda/session.updated event');
  });

  it('logs "unknown" when inngest.send() rejects with a non-Error value', async () => {
    mocks.mockInngestSend.mockRejectedValueOnce(42);

    const supabase = createMockSupabase(VALID_USER_ID);
    const input = validInput();

    await updateSessionImpl(supabase, SESSION_ID, input);

    expect(mocks.mockLoggerError).toHaveBeenCalledTimes(1);

    const [logPayload] = mocks.mockLoggerError.mock.calls[0]! as [Record<string, unknown>, string];
    expect(logPayload.error).toBe('unknown');
  });

  it('does not log when inngest.send() succeeds', async () => {
    const supabase = createMockSupabase(VALID_USER_ID);
    const input = validInput();

    await updateSessionImpl(supabase, SESSION_ID, input);

    expect(mocks.mockLoggerError).not.toHaveBeenCalled();
  });
});
