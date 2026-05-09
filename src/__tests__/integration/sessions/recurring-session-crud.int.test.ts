import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { cancelRecurringSessionImpl } from '@/modules/sessions/server/cancel-recurring-session';
import { createRecurringSessionImpl } from '@/modules/sessions/server/create-recurring-session';
import { editRecurringSessionImpl } from '@/modules/sessions/server/edit-recurring-session';
import { sessions, sessionHistory, sessionRecurrences } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedAuthUser(userId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${userId}, ${`test-${userId}@example.com`}, '{"provider":"google"}'::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

async function seedPatient(userId: string, patientId: string, name: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: name,
      patientType: 'individual',
    });
  });
}

function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- fake implementation
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as Parameters<typeof createRecurringSessionImpl>[0];
}

/** Returns an ISO 8601 datetime string for a future date. */
function futureDate(hoursFromNow: number): string {
  const d = new Date();
  d.setHours(d.getHours() + hoursFromNow);
  return d.toISOString();
}

/** Returns an ISO 8601 datetime string for a date N days in the future. */
function futureDateDays(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString();
}

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(sessionHistory);
    await db.delete(sessions);
    await db.delete(sessionRecurrences);
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// =====================================================================
// createRecurringSessionImpl
// =====================================================================

describe('createRecurringSessionImpl', () => {
  it('creates weekly recurrence for 4 weeks producing 4 sessions with same recurrence_id', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Maria Silva');
    const client = fakeSupabaseClient(userId);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 1);
    const dayOfWeek = startDate.getDay();

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 4 * 7 - 1); // ~4 weeks

    const result = await createRecurringSessionImpl(client, {
      session: {
        patient_id: patientId,
        start_at: futureDate(24),
        duration_minutes: 50,
      },
      recurrence: {
        frequency: 'weekly',
        daysOfWeek: [dayOfWeek],
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sessionCount).toBe(4);
    expect(result.recurrenceId).toBeDefined();

    // Verify all sessions have the same recurrence_id
    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.recurrenceId, result.recurrenceId));
    });
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.recurrenceId).toBe(result.recurrenceId);
      expect(row.userId).toBe(userId);
      expect(row.patientId).toBe(patientId);
      expect(row.durationMinutes).toBe(50);
      expect(row.status).toBe('scheduled');
    }
  });

  it('creates biweekly recurrence for 6 occurrences producing 6 sessions', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Joao Souza');
    const client = fakeSupabaseClient(userId);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 1);

    const result = await createRecurringSessionImpl(client, {
      session: {
        patient_id: patientId,
        start_at: futureDate(24),
        duration_minutes: 50,
      },
      recurrence: {
        frequency: 'biweekly',
        startDate: startDate.toISOString(),
        occurrenceCount: 6,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sessionCount).toBe(6);

    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.recurrenceId, result.recurrenceId));
    });
    expect(rows).toHaveLength(6);
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await createRecurringSessionImpl(client, {
      session: {
        patient_id: randomUUID(),
        start_at: futureDate(24),
        duration_minutes: 50,
      },
      recurrence: {
        frequency: 'weekly',
        daysOfWeek: [1],
        startDate: futureDateDays(1),
        occurrenceCount: 4,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });

  it('creates history entries for each generated session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Ana Costa');
    const client = fakeSupabaseClient(userId);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 1);

    const result = await createRecurringSessionImpl(client, {
      session: {
        patient_id: patientId,
        start_at: futureDate(24),
        duration_minutes: 50,
      },
      recurrence: {
        frequency: 'biweekly',
        startDate: startDate.toISOString(),
        occurrenceCount: 3,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const historyRows = await runAsService(async (db) => {
      return db.select().from(sessionHistory);
    });
    expect(historyRows).toHaveLength(3);
    for (const row of historyRows) {
      expect(row.action).toBe('created');
    }
  });
});

// =====================================================================
// editRecurringSessionImpl
// =====================================================================

describe('editRecurringSessionImpl', () => {
  /** Helper: creates a 4-session weekly recurrence and returns the recurrence_id + session IDs. */
  async function createTestRecurrence(userId: string, patientId: string) {
    const client = fakeSupabaseClient(userId);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 1);
    const dayOfWeek = startDate.getDay();

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 4 * 7 - 1);

    const createResult = await createRecurringSessionImpl(client, {
      session: {
        patient_id: patientId,
        start_at: futureDate(24),
        duration_minutes: 50,
      },
      recurrence: {
        frequency: 'weekly',
        daysOfWeek: [dayOfWeek],
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
    });

    if (!createResult.ok) throw new Error('Failed to create test recurrence');

    const sessionRows = await runAsService(async (db) => {
      return db
        .select({ id: sessions.id, startAt: sessions.startAt })
        .from(sessions)
        .where(eq(sessions.recurrenceId, createResult.recurrenceId));
    });

    // Sort by startAt ascending
    sessionRows.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

    return {
      recurrenceId: createResult.recurrenceId,
      sessionIds: sessionRows.map((s) => s.id),
    };
  }

  it("edit 'this' detaches session from series", async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Pedro Alves');
    const client = fakeSupabaseClient(userId);

    const { recurrenceId, sessionIds } = await createTestRecurrence(userId, patientId);

    // Edit the second session with scope 'this'
    const result = await editRecurringSessionImpl(client, {
      sessionId: sessionIds[1]!,
      scope: 'this',
      updates: { notes: 'Edited individually' },
    });

    expect(result.ok).toBe(true);

    // Verify the edited session is detached (recurrence_id = NULL)
    const [editedSession] = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, sessionIds[1]!));
    });
    expect(editedSession!.recurrenceId).toBeNull();
    expect(editedSession!.notes).toBe('Edited individually');

    // Verify other sessions still belong to the recurrence
    const remaining = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.recurrenceId, recurrenceId));
    });
    expect(remaining).toHaveLength(3); // 4 - 1 detached
  });

  it("edit 'this_and_future' splits series correctly", async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Lucia Mendes');
    const client = fakeSupabaseClient(userId);

    const { recurrenceId, sessionIds } = await createTestRecurrence(userId, patientId);

    // Edit from session #2 onward
    const result = await editRecurringSessionImpl(client, {
      sessionId: sessionIds[1]!,
      scope: 'this_and_future',
      updates: { notes: 'Updated future' },
    });

    expect(result.ok).toBe(true);

    // Old recurrence should have updated end_date
    const [oldRecurrence] = await runAsService(async (db) => {
      return db.select().from(sessionRecurrences).where(eq(sessionRecurrences.id, recurrenceId));
    });
    expect(oldRecurrence!.endDate).toBeDefined();

    // Sessions from target onward should have a new recurrence_id
    const [editedSession] = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, sessionIds[1]!));
    });
    expect(editedSession!.recurrenceId).not.toBe(recurrenceId);
    expect(editedSession!.notes).toBe('Updated future');

    // First session should still belong to old recurrence
    const [firstSession] = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, sessionIds[0]!));
    });
    expect(firstSession!.recurrenceId).toBe(recurrenceId);

    // New recurrence should exist
    const newRecurrenceId = editedSession!.recurrenceId;
    expect(newRecurrenceId).toBeDefined();
    const newRecurrenceSessions = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.recurrenceId, newRecurrenceId!));
    });
    // Sessions 2, 3, 4 should be reassigned
    expect(newRecurrenceSessions).toHaveLength(3);
  });

  it("edit 'all' updates only future scheduled sessions", async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Carlos Lima');
    const client = fakeSupabaseClient(userId);

    const { sessionIds } = await createTestRecurrence(userId, patientId);

    // Edit all with notes
    const result = await editRecurringSessionImpl(client, {
      sessionId: sessionIds[0]!,
      scope: 'all',
      updates: { notes: 'Updated all' },
    });

    expect(result.ok).toBe(true);

    // All future scheduled sessions should be updated
    const allSessions = await runAsService(async (db) => {
      return db.select().from(sessions);
    });

    // All are future and scheduled, so all should be updated
    const updatedSessions = allSessions.filter((s) => s.notes === 'Updated all');
    expect(updatedSessions.length).toBeGreaterThan(0);
  });

  it('returns not_found for session owned by another user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId, 'Test Patient');

    const { sessionIds } = await createTestRecurrence(userA, patientId);

    const clientB = fakeSupabaseClient(userB);
    const result = await editRecurringSessionImpl(clientB, {
      sessionId: sessionIds[0]!,
      scope: 'this',
      updates: { notes: 'Hacked' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await editRecurringSessionImpl(client, {
      sessionId: randomUUID(),
      scope: 'this',
      updates: { notes: 'test' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });
});

// =====================================================================
// cancelRecurringSessionImpl
// =====================================================================

describe('cancelRecurringSessionImpl', () => {
  /** Helper: creates a 4-session weekly recurrence and returns the recurrence_id + session IDs. */
  async function createTestRecurrence(userId: string, patientId: string) {
    const client = fakeSupabaseClient(userId);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 1);
    const dayOfWeek = startDate.getDay();

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 4 * 7 - 1);

    const createResult = await createRecurringSessionImpl(client, {
      session: {
        patient_id: patientId,
        start_at: futureDate(24),
        duration_minutes: 50,
      },
      recurrence: {
        frequency: 'weekly',
        daysOfWeek: [dayOfWeek],
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
    });

    if (!createResult.ok) throw new Error('Failed to create test recurrence');

    const sessionRows = await runAsService(async (db) => {
      return db
        .select({ id: sessions.id, startAt: sessions.startAt })
        .from(sessions)
        .where(eq(sessions.recurrenceId, createResult.recurrenceId));
    });

    sessionRows.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

    return {
      recurrenceId: createResult.recurrenceId,
      sessionIds: sessionRows.map((s) => s.id),
    };
  }

  it("cancel 'this' cancels single session", async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Fernando Gomes');
    const client = fakeSupabaseClient(userId);

    const { sessionIds } = await createTestRecurrence(userId, patientId);

    const result = await cancelRecurringSessionImpl(client, {
      sessionId: sessionIds[1]!,
      scope: 'this',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cancelledCount).toBe(1);

    // Verify the cancelled session
    const [cancelled] = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, sessionIds[1]!));
    });
    expect(cancelled!.status).toBe('cancelled');

    // Other sessions should still be scheduled
    const [other] = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, sessionIds[0]!));
    });
    expect(other!.status).toBe('scheduled');
  });

  it("cancel 'this_and_future' cancels from target onward", async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Rita Souza');
    const client = fakeSupabaseClient(userId);

    const { recurrenceId, sessionIds } = await createTestRecurrence(userId, patientId);

    // Cancel from session #2 onward
    const result = await cancelRecurringSessionImpl(client, {
      sessionId: sessionIds[1]!,
      scope: 'this_and_future',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cancelledCount).toBe(3); // sessions 2, 3, 4

    // Session #1 should still be scheduled
    const [first] = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, sessionIds[0]!));
    });
    expect(first!.status).toBe('scheduled');

    // Sessions #2-4 should be cancelled
    for (let i = 1; i < sessionIds.length; i++) {
      const [s] = await runAsService(async (db) => {
        return db.select().from(sessions).where(eq(sessions.id, sessionIds[i]!));
      });
      expect(s!.status).toBe('cancelled');
    }

    // Recurrence end_date should be updated
    const [recurrence] = await runAsService(async (db) => {
      return db.select().from(sessionRecurrences).where(eq(sessionRecurrences.id, recurrenceId));
    });
    expect(recurrence!.endDate).toBeDefined();
  });

  it("cancel 'all' cancels all future non-completed sessions", async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Patricia Lima');
    const client = fakeSupabaseClient(userId);

    const { sessionIds } = await createTestRecurrence(userId, patientId);

    const result = await cancelRecurringSessionImpl(client, {
      sessionId: sessionIds[0]!,
      scope: 'all',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // All sessions are future and scheduled, so all should be cancelled
    expect(result.cancelledCount).toBeGreaterThan(0);

    const allSessions = await runAsService(async (db) => {
      return db.select().from(sessions);
    });

    const cancelledCount = allSessions.filter((s) => s.status === 'cancelled').length;
    expect(cancelledCount).toBe(result.cancelledCount);
  });

  it('returns not_found for session owned by another user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId, 'Test Patient');

    const { sessionIds } = await createTestRecurrence(userA, patientId);

    const clientB = fakeSupabaseClient(userB);
    const result = await cancelRecurringSessionImpl(clientB, {
      sessionId: sessionIds[0]!,
      scope: 'this',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await cancelRecurringSessionImpl(client, {
      sessionId: randomUUID(),
      scope: 'this',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });
});

// =====================================================================
// RLS cross-user isolation
// =====================================================================

describe('RLS cross-user isolation — recurrences', () => {
  it('psychologist A cannot access recurrences created by psychologist B', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientA = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientA, 'Patient A');

    const clientA = fakeSupabaseClient(userA);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 1);

    const result = await createRecurringSessionImpl(clientA, {
      session: {
        patient_id: patientA,
        start_at: futureDate(24),
        duration_minutes: 50,
      },
      recurrence: {
        frequency: 'biweekly',
        startDate: startDate.toISOString(),
        occurrenceCount: 3,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // User B should not see the recurrence via RLS
    const rowsAsB = await runAsUser(userB, async (db) => {
      return db
        .select()
        .from(sessionRecurrences)
        .where(eq(sessionRecurrences.id, result.recurrenceId));
    });
    expect(rowsAsB).toHaveLength(0);

    // User A should see it
    const rowsAsA = await runAsUser(userA, async (db) => {
      return db
        .select()
        .from(sessionRecurrences)
        .where(eq(sessionRecurrences.id, result.recurrenceId));
    });
    expect(rowsAsA).toHaveLength(1);
  });
});
