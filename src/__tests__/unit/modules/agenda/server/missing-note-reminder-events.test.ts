import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.hoisted() runs before vi.mock() factories, so the
// references are valid when the factory closures execute.
// ---------------------------------------------------------------------------

const { mockInngestSend, mockLoggerError, mockSelectWhere } = vi.hoisted(() => ({
  mockInngestSend: vi.fn(),
  mockLoggerError: vi.fn(),
  mockSelectWhere: vi.fn(),
}));

vi.mock('@/modules/agenda/inngest/client', () => ({
  inngest: { send: mockInngestSend },
}));

vi.mock('@/shared/lib/logger', () => ({
  logger: { error: mockLoggerError, info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/shared/db/client', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: mockSelectWhere,
      }),
    }),
  },
}));

vi.mock('@/shared/db/schema/agenda/tables', () => ({
  sessions: {
    id: 'sessions.id',
    patientId: 'sessions.patientId',
    userId: 'sessions.userId',
    status: 'sessions.status',
    updatedAt: 'sessions.updatedAt',
    deletedAt: 'sessions.deletedAt',
  },
}));

// Import the module under test (after mocks are set up)
import { runMissingNoteReminder } from '@/modules/agenda/server/missing-note-reminder';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a DB row for a session that has been done for more than 7 days.
 * `runMissingNoteReminder` derives the event payload from these rows.
 */
function doneSessionRow(suffix: number) {
  // 10 days ago — comfortably past the 7-day threshold.
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  return {
    id: `00000000-0000-0000-0000-00000000000${suffix}`,
    patientId: `11111111-1111-1111-1111-11111111000${suffix}`,
    userId: `22222222-2222-2222-2222-22222222000${suffix}`,
    updatedAt: tenDaysAgo,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runMissingNoteReminder — batch Inngest event emission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInngestSend.mockResolvedValue({ ids: ['evt'] });
  });

  // -----------------------------------------------------------------------
  // Scenario: Three sessions missing notes
  // -----------------------------------------------------------------------

  it('emits one agenda/session.missing_note_reminder event per eligible session', async () => {
    mockSelectWhere.mockResolvedValue([doneSessionRow(1), doneSessionRow(2), doneSessionRow(3)]);

    const result = await runMissingNoteReminder();

    expect(result.sessionsNotified).toBe(3);
    expect(mockInngestSend).toHaveBeenCalledTimes(3);

    for (const call of mockInngestSend.mock.calls) {
      const arg = call[0] as { name: string; data: Record<string, unknown> };
      expect(arg.name).toBe('agenda/session.missing_note_reminder');
      expect(arg.data.sessionId).toBeDefined();
      expect(arg.data.patientId).toBeDefined();
      expect(arg.data.userId).toBeDefined();
    }

    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Scenario: One event fails in batch
  // -----------------------------------------------------------------------

  it('sends remaining events when one send throws, logs the failure, and returns normally', async () => {
    mockSelectWhere.mockResolvedValue([doneSessionRow(1), doneSessionRow(2), doneSessionRow(3)]);

    // Second send fails; first and third succeed.
    mockInngestSend
      .mockResolvedValueOnce({ ids: ['evt-1'] })
      .mockRejectedValueOnce(new Error('Inngest is down'))
      .mockResolvedValueOnce({ ids: ['evt-3'] });

    const result = await runMissingNoteReminder();

    // All three sends attempted; failure did not block the rest.
    expect(mockInngestSend).toHaveBeenCalledTimes(3);
    // Function returns normally with the full eligible count.
    expect(result.sessionsNotified).toBe(3);

    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    const [logPayload, logMessage] = mockLoggerError.mock.calls[0]! as [
      Record<string, unknown>,
      string,
    ];
    expect(logPayload.event).toBe('inngest_send_failed');
    expect(logPayload.eventName).toBe('agenda/session.missing_note_reminder');
    // The logged sessionId is the one whose send failed (the second event).
    expect(logPayload.sessionId).toBe(doneSessionRow(2).id);
    expect(logPayload.error).toBe('Inngest is down');
    expect(logMessage).toBe('failed to send agenda/session.missing_note_reminder event');
  });

  it('logs "unknown" when a send rejects with a non-Error value', async () => {
    mockSelectWhere.mockResolvedValue([doneSessionRow(1)]);
    mockInngestSend.mockRejectedValueOnce('network timeout');

    const result = await runMissingNoteReminder();

    expect(result.sessionsNotified).toBe(1);
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    const [logPayload] = mockLoggerError.mock.calls[0]! as [Record<string, unknown>, string];
    expect(logPayload.error).toBe('unknown');
  });

  // -----------------------------------------------------------------------
  // Scenario: No sessions missing notes
  // -----------------------------------------------------------------------

  it('emits no events and returns { sessionsNotified: 0 } when no sessions are eligible', async () => {
    mockSelectWhere.mockResolvedValue([]);

    const result = await runMissingNoteReminder();

    expect(result.sessionsNotified).toBe(0);
    expect(mockInngestSend).not.toHaveBeenCalled();
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it('skips sessions without a patient (blocking slots)', async () => {
    mockSelectWhere.mockResolvedValue([
      doneSessionRow(1),
      { ...doneSessionRow(2), patientId: null },
    ]);

    const result = await runMissingNoteReminder();

    // Only the row with a patient is eligible.
    expect(result.sessionsNotified).toBe(1);
    expect(mockInngestSend).toHaveBeenCalledTimes(1);
  });
});
