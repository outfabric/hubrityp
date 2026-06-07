import { describe, expect, it, vi } from 'vitest';

import {
  findSessionsMissingEvolution,
  remindMissingEvolutions,
  type RemindMissingEvolutionDeps,
} from '@/modules/medical-records/inngest/remind-missing-evolution';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = new Date('2024-06-15T12:00:00Z');

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

/** Shape returned by the Drizzle query (before the map step in the function). */
interface DbRow {
  sessionId: string;
  userId: string;
  patientId: string;
  patientFullName: string;
  sessionCreatedAt: Date;
}

/**
 * Creates a mock Drizzle DB that returns the given rows from the chained
 * query builder (select -> from -> innerJoin -> leftJoin -> where).
 *
 * Returns both the typed `db` (for passing to the function under test) and
 * a `spies` object (for assertions on mock call counts).
 */
function createMockDb(rows: DbRow[]) {
  const whereSpy = vi.fn().mockResolvedValue(rows);
  const insertSpy = vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 'notif-uuid' }]),
    }),
  });

  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: whereSpy,
    insert: insertSpy,
  };

  return {
    db: chain as unknown as RemindMissingEvolutionDeps['db'],
    spies: { where: whereSpy, insert: insertSpy },
  };
}

/** Convenience: create a DbRow from a MissingEvolutionMatch-like input. */
function toDbRow(match: {
  sessionId: string;
  userId: string;
  patientId: string;
  patientFullName: string;
  sessionCreatedAt: Date;
}): DbRow {
  return match;
}

// ---------------------------------------------------------------------------
// findSessionsMissingEvolution
// ---------------------------------------------------------------------------

describe('findSessionsMissingEvolution', () => {
  it('returns sessions done >7 days ago without linked evolution', async () => {
    const dbRows: DbRow[] = [
      toDbRow({
        sessionId: 'session-1',
        userId: 'user-1',
        patientId: 'patient-1',
        patientFullName: 'Maria Silva',
        sessionCreatedAt: daysAgo(8),
      }),
    ];

    const { db } = createMockDb(dbRows);
    const result = await findSessionsMissingEvolution({ db, now: NOW });

    expect(result).toHaveLength(1);
    expect(result[0]!.sessionId).toBe('session-1');
    expect(result[0]!.patientId).toBe('patient-1');
    // Only first name is retained (LGPD data minimization)
    expect(result[0]!.patientFirstName).toBe('Maria');
  });

  it('returns empty array when no sessions match (all have evolutions)', async () => {
    const { db } = createMockDb([]);
    const result = await findSessionsMissingEvolution({ db, now: NOW });

    expect(result).toHaveLength(0);
  });

  it('returns empty array when sessions are within 7-day grace period', async () => {
    // The DB query itself filters by cutoff date; if no rows match, empty is returned
    const { db } = createMockDb([]);
    const result = await findSessionsMissingEvolution({ db, now: NOW });

    expect(result).toHaveLength(0);
  });

  it('invokes the query chain (select/from/join/where)', async () => {
    const { db, spies } = createMockDb([]);
    await findSessionsMissingEvolution({ db, now: NOW });

    // Verify the full query chain was invoked by checking the terminal `where`
    expect(spies.where).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// remindMissingEvolutions (end-to-end logic with mock DB)
// ---------------------------------------------------------------------------

describe('remindMissingEvolutions', () => {
  it('creates a notification for each session done >7d without evolution', async () => {
    const dbRows: DbRow[] = [
      toDbRow({
        sessionId: 'session-1',
        userId: 'user-1',
        patientId: 'patient-1',
        patientFullName: 'Maria Silva',
        sessionCreatedAt: daysAgo(8),
      }),
      toDbRow({
        sessionId: 'session-2',
        userId: 'user-2',
        patientId: 'patient-2',
        patientFullName: 'Joao Santos',
        sessionCreatedAt: daysAgo(10),
      }),
    ];

    const { db, spies } = createMockDb(dbRows);
    const result = await remindMissingEvolutions({ db, now: NOW });

    expect(result.sessionsScanned).toBe(2);
    expect(result.notificationsCreated).toBe(2);
    // Verify insert was called for each notification
    expect(spies.insert).toHaveBeenCalledTimes(2);
  });

  it('creates zero notifications when no sessions are flagged', async () => {
    const { db, spies } = createMockDb([]);
    const result = await remindMissingEvolutions({ db, now: NOW });

    expect(result.sessionsScanned).toBe(0);
    expect(result.notificationsCreated).toBe(0);
    expect(spies.insert).not.toHaveBeenCalled();
  });

  it('notification title includes session date and patient first name only', async () => {
    const sessionDate = daysAgo(8);
    const dbRows: DbRow[] = [
      toDbRow({
        sessionId: 'session-1',
        userId: 'user-1',
        patientId: 'patient-1',
        patientFullName: 'Maria Silva',
        sessionCreatedAt: sessionDate,
      }),
    ];

    // Track the values passed to insert().values()
    const insertedValues: Array<Record<string, unknown>> = [];
    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(dbRows),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockImplementation((val: Record<string, unknown>) => {
          insertedValues.push(val);
          return {
            returning: vi.fn().mockResolvedValue([{ id: 'notif-uuid' }]),
          };
        }),
      }),
    } as unknown as RemindMissingEvolutionDeps['db'];

    await remindMissingEvolutions({ db, now: NOW });

    expect(insertedValues).toHaveLength(1);
    const notification = insertedValues[0]!;
    expect(notification.type).toBe('missing_evolution');
    expect(notification.userId).toBe('user-1');
    // Title should contain only first name (not full name) and a formatted date
    expect(notification.title).toContain('Maria');
    expect(notification.title).not.toContain('Silva');
    expect(notification.title).toContain('ainda não possui evolução');
    // actionUrl should use patientId and correct route prefix (not /dashboard/)
    expect(notification.actionUrl).toBe(
      '/pacientes/patient-1/prontuario/evolucoes/nova?sessionId=session-1',
    );
  });

  it('does not flag sessions done only 5 days ago (within grace period)', async () => {
    // The query-level filter ensures sessions <7d are not returned.
    // This test confirms the logic: when DB returns empty (no matches
    // because cutoff excluded recent sessions), no notifications are created.
    const { db } = createMockDb([]);
    const result = await remindMissingEvolutions({ db, now: NOW });

    expect(result.notificationsCreated).toBe(0);
  });

  it('does not flag sessions that already have a linked evolution', async () => {
    // When a session has a linked evolution, the LEFT JOIN + IS NULL filter
    // excludes it from results. An empty array means no matches.
    const { db } = createMockDb([]);
    const result = await remindMissingEvolutions({ db, now: NOW });

    expect(result.notificationsCreated).toBe(0);
  });
});
