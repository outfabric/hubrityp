import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.hoisted() runs before vi.mock() factories, so the
// references are valid when the factory closures execute.
// ---------------------------------------------------------------------------

const { mockInngestSend, mockLoggerError } = vi.hoisted(() => ({
  mockInngestSend: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('@/modules/agenda/inngest/client', () => ({
  inngest: { send: mockInngestSend },
}));

vi.mock('@/shared/lib/logger', () => ({
  logger: { error: mockLoggerError, info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/modules/agenda/lib/date-helpers', () => ({
  calculateEndTime: (start: Date, mins: number) => new Date(start.getTime() + mins * 60_000),
  isInPast: () => false,
}));

vi.mock('@/modules/agenda/lib/detect-conflicts', () => ({
  detectConflicts: () => [],
}));

// ---------------------------------------------------------------------------
// DB mock
// ---------------------------------------------------------------------------

const INSERTED_SESSION_ID = '550e8400-e29b-41d4-a716-446655440000';

const { mockTransaction } = vi.hoisted(() => {
  const mockTxInsert = vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: '550e8400-e29b-41d4-a716-446655440000' }]),
    }),
  });

  const mockTransaction = vi
    .fn()
    .mockImplementation(async (fn: (tx: { insert: typeof mockTxInsert }) => Promise<unknown>) => {
      const tx = { insert: mockTxInsert };
      return fn(tx);
    });

  return { mockTransaction };
});

vi.mock('@/shared/db/client', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 'owned-entity-uuid' }]),
        }),
      }),
    }),
    transaction: mockTransaction,
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
import { createSessionImpl } from '@/modules/agenda/server/create-session';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_USER_ID = '660e8400-e29b-41d4-a716-446655440001';
const VALID_PATIENT_ID = '770e8400-e29b-41d4-a716-446655440002';

function futureIsoString(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(14, 0, 0, 0);
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

describe('createSessionImpl — Inngest event emission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInngestSend.mockResolvedValue({ ids: ['evt-1'] });
  });

  // -----------------------------------------------------------------------
  // (a) Successful create calls inngest.send() with correct event + payload
  // -----------------------------------------------------------------------

  it('calls inngest.send() with agenda/session.created and a Zod-valid payload', async () => {
    const supabase = createMockSupabase(VALID_USER_ID);
    const input = validInput();

    const result = await createSessionImpl(supabase, input);

    expect(result).toEqual({ ok: true, sessionId: INSERTED_SESSION_ID });

    expect(mockInngestSend).toHaveBeenCalledTimes(1);
    const sendArg = mockInngestSend.mock.calls[0]![0] as {
      name: string;
      data: Record<string, unknown>;
    };

    expect(sendArg.name).toBe('agenda/session.created');
    expect(sendArg.data.sessionId).toBe(INSERTED_SESSION_ID);
    expect(sendArg.data.userId).toBe(VALID_USER_ID);
    expect(sendArg.data.patientId).toBe(VALID_PATIENT_ID);
    expect(sendArg.data.modality).toBe('in_person');
    expect(sendArg.data.status).toBe('scheduled');
    expect(sendArg.data.startAt).toBeInstanceOf(Date);
    expect(sendArg.data.endAt).toBeInstanceOf(Date);
  });

  it('sends null patientId for blocking slots', async () => {
    const supabase = createMockSupabase(VALID_USER_ID);
    const input = validInput({
      patient_id: undefined,
      is_blocking: true,
      blocking_title: 'Lunch Break',
    });

    const result = await createSessionImpl(supabase, input);
    expect(result.ok).toBe(true);

    const sendArg = mockInngestSend.mock.calls[0]![0] as {
      name: string;
      data: Record<string, unknown>;
    };
    expect(sendArg.data.patientId).toBeNull();
  });

  // -----------------------------------------------------------------------
  // (b) inngest.send() failure does not cause the operation to fail
  // -----------------------------------------------------------------------

  it('returns { ok: true } even when inngest.send() throws', async () => {
    mockInngestSend.mockRejectedValueOnce(new Error('Inngest is down'));

    const supabase = createMockSupabase(VALID_USER_ID);
    const input = validInput();

    const result = await createSessionImpl(supabase, input);

    expect(result).toEqual({ ok: true, sessionId: INSERTED_SESSION_ID });
  });

  it('returns { ok: true } when inngest.send() rejects with a non-Error value', async () => {
    mockInngestSend.mockRejectedValueOnce('network timeout');

    const supabase = createMockSupabase(VALID_USER_ID);
    const input = validInput();

    const result = await createSessionImpl(supabase, input);

    expect(result).toEqual({ ok: true, sessionId: INSERTED_SESSION_ID });
  });

  // -----------------------------------------------------------------------
  // (c) Failure logs structured error via logger.error()
  // -----------------------------------------------------------------------

  it('logs structured error when inngest.send() fails with an Error', async () => {
    mockInngestSend.mockRejectedValueOnce(new Error('Connection refused'));

    const supabase = createMockSupabase(VALID_USER_ID);
    const input = validInput();

    await createSessionImpl(supabase, input);

    expect(mockLoggerError).toHaveBeenCalledTimes(1);

    const [logPayload, logMessage] = mockLoggerError.mock.calls[0]! as [
      Record<string, unknown>,
      string,
    ];
    expect(logPayload.event).toBe('inngest_send_failed');
    expect(logPayload.eventName).toBe('agenda/session.created');
    expect(logPayload.sessionId).toBe(INSERTED_SESSION_ID);
    expect(logPayload.error).toBe('Connection refused');
    expect(logMessage).toBe('failed to send agenda/session.created event');
  });

  it('logs "unknown" when inngest.send() rejects with a non-Error value', async () => {
    mockInngestSend.mockRejectedValueOnce(42);

    const supabase = createMockSupabase(VALID_USER_ID);
    const input = validInput();

    await createSessionImpl(supabase, input);

    expect(mockLoggerError).toHaveBeenCalledTimes(1);

    const [logPayload] = mockLoggerError.mock.calls[0]! as [Record<string, unknown>, string];
    expect(logPayload.error).toBe('unknown');
  });

  it('does not log when inngest.send() succeeds', async () => {
    const supabase = createMockSupabase(VALID_USER_ID);
    const input = validInput();

    await createSessionImpl(supabase, input);

    expect(mockLoggerError).not.toHaveBeenCalled();
  });
});
