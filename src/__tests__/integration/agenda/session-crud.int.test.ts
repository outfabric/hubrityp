import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { createSessionImpl } from '@/modules/agenda/server/create-session';
import { deleteSessionImpl } from '@/modules/agenda/server/delete-session';
import { getSessionHistoryImpl } from '@/modules/agenda/server/get-session-history';
import { listSessionsImpl } from '@/modules/agenda/server/list-sessions';
import { markSessionDoneImpl } from '@/modules/agenda/server/mark-session-done';
import { updateSessionImpl } from '@/modules/agenda/server/update-session';
import { sessions, sessionHistory } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { runAsService } from '../setup/run-as-service';

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
      // eslint-disable-next-line @typescript-eslint/require-await -- fake implementation returns a static value
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as Parameters<typeof createSessionImpl>[0];
}

/** Returns an ISO 8601 datetime string for a future date. */
function futureDate(hoursFromNow: number): string {
  const d = new Date();
  d.setHours(d.getHours() + hoursFromNow);
  return d.toISOString();
}

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(sessionHistory);
    await db.delete(sessions);
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// createSessionImpl
// ---------------------------------------------------------------------------

describe('createSessionImpl', () => {
  it('creates a regular session successfully', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Maria Silva');
    const client = fakeSupabaseClient(userId);

    const result = await createSessionImpl(client, {
      patient_id: patientId,
      start_at: futureDate(24),
      duration_minutes: 50,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sessionId).toBeDefined();

    // Verify row in DB
    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, result.sessionId));
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(userId);
    expect(rows[0]!.patientId).toBe(patientId);
    expect(rows[0]!.durationMinutes).toBe(50);
    expect(rows[0]!.status).toBe('scheduled');
    expect(rows[0]!.isBlocking).toBe(false);

    // Verify end_at = start_at + duration
    const startMs = rows[0]!.startAt.getTime();
    const endMs = rows[0]!.endAt.getTime();
    expect(endMs - startMs).toBe(50 * 60 * 1000);

    // Verify history entry was created
    const historyRows = await runAsService(async (db) => {
      return db
        .select()
        .from(sessionHistory)
        .where(eq(sessionHistory.sessionId, result.sessionId));
    });
    expect(historyRows).toHaveLength(1);
    expect(historyRows[0]!.action).toBe('created');
  });

  it('creates a blocking slot (is_blocking=true) without patient_id', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await createSessionImpl(client, {
      is_blocking: true,
      blocking_title: 'Almoco',
      start_at: futureDate(48),
      duration_minutes: 60,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, result.sessionId));
    });
    expect(rows[0]!.isBlocking).toBe(true);
    expect(rows[0]!.blockingTitle).toBe('Almoco');
    expect(rows[0]!.patientId).toBeNull();
  });

  it('returns conflict_warning when sessions overlap', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Joao Souza');
    const client = fakeSupabaseClient(userId);

    const startTime = futureDate(72);

    // Create first session
    const first = await createSessionImpl(client, {
      patient_id: patientId,
      start_at: startTime,
      duration_minutes: 50,
    });
    expect(first.ok).toBe(true);

    // Try to create a second session at the same time
    const second = await createSessionImpl(client, {
      patient_id: patientId,
      start_at: startTime,
      duration_minutes: 50,
    });

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toBe('conflict_warning');
    if (second.error !== 'conflict_warning') return;
    expect(second.conflicts).toHaveLength(1);
  });

  it('creates session with force_conflict=true despite conflict', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Ana Costa');
    const client = fakeSupabaseClient(userId);

    const startTime = futureDate(96);

    // Create first session
    const first = await createSessionImpl(client, {
      patient_id: patientId,
      start_at: startTime,
      duration_minutes: 50,
    });
    expect(first.ok).toBe(true);

    // Create a second session with force_conflict
    const second = await createSessionImpl(client, {
      patient_id: patientId,
      start_at: startTime,
      duration_minutes: 50,
      force_conflict: true,
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.sessionId).toBeDefined();
  });

  it('rejects session in the past (RN-03.02)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Carlos Lima');
    const client = fakeSupabaseClient(userId);

    const pastDate = new Date();
    pastDate.setHours(pastDate.getHours() - 1);

    const result = await createSessionImpl(client, {
      patient_id: patientId,
      start_at: pastDate.toISOString(),
      duration_minutes: 50,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('past_date');
    if (result.error !== 'past_date') return;
    expect(result.message).toBe('Nao e possivel agendar sessoes no passado.');
  });

  it('returns invalid_input for missing required fields', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await createSessionImpl(client, {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_input');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);

    const result = await createSessionImpl(client, {
      patient_id: randomUUID(),
      start_at: futureDate(24),
      duration_minutes: 50,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });
});

// ---------------------------------------------------------------------------
// updateSessionImpl
// ---------------------------------------------------------------------------

describe('updateSessionImpl', () => {
  it('updates session fields and creates "updated" history entry', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Pedro Alves');
    const client = fakeSupabaseClient(userId);

    // Create session
    const createResult = await createSessionImpl(client, {
      patient_id: patientId,
      start_at: futureDate(24),
      duration_minutes: 50,
      notes: 'Initial note',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    // Update notes only (same time — should be "updated" not "rescheduled")
    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, createResult.sessionId));
    });
    const existingStartAt = rows[0]!.startAt.toISOString();

    const updateResult = await updateSessionImpl(client, createResult.sessionId, {
      patient_id: patientId,
      start_at: existingStartAt,
      duration_minutes: 50,
      notes: 'Updated note',
    });

    expect(updateResult.ok).toBe(true);

    // Verify DB update
    const updated = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, createResult.sessionId));
    });
    expect(updated[0]!.notes).toBe('Updated note');

    // Verify history entry is "updated" (not "rescheduled")
    const historyRows = await runAsService(async (db) => {
      return db
        .select()
        .from(sessionHistory)
        .where(eq(sessionHistory.sessionId, createResult.sessionId));
    });
    // Should have 2 entries: "created" + "updated"
    expect(historyRows).toHaveLength(2);
    const updateEntry = historyRows.find((h) => h.action === 'updated');
    expect(updateEntry).toBeDefined();
    const changes = updateEntry!.changes as Record<string, { old: unknown; new: unknown }>;
    expect(changes.notes).toBeDefined();
    expect(changes.notes!.old).toBe('Initial note');
    expect(changes.notes!.new).toBe('Updated note');
  });

  it('creates "rescheduled" history entry when start_at changes', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Lucia Mendes');
    const client = fakeSupabaseClient(userId);

    const createResult = await createSessionImpl(client, {
      patient_id: patientId,
      start_at: futureDate(24),
      duration_minutes: 50,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    // Reschedule to a different time
    const newStartAt = futureDate(48);
    const updateResult = await updateSessionImpl(client, createResult.sessionId, {
      patient_id: patientId,
      start_at: newStartAt,
      duration_minutes: 50,
    });

    expect(updateResult.ok).toBe(true);

    // Verify history has "rescheduled" action
    const historyRows = await runAsService(async (db) => {
      return db
        .select()
        .from(sessionHistory)
        .where(eq(sessionHistory.sessionId, createResult.sessionId));
    });
    const rescheduleEntry = historyRows.find((h) => h.action === 'rescheduled');
    expect(rescheduleEntry).toBeDefined();
    const changes = rescheduleEntry!.changes as Record<string, { old: unknown; new: unknown }>;
    expect(changes.startAt).toBeDefined();
  });

  it('returns not_found for session owned by another user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId, 'Test Patient');

    const clientA = fakeSupabaseClient(userA);
    const createResult = await createSessionImpl(clientA, {
      patient_id: patientId,
      start_at: futureDate(24),
      duration_minutes: 50,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    // User B tries to update User A's session
    const clientB = fakeSupabaseClient(userB);
    const updateResult = await updateSessionImpl(clientB, createResult.sessionId, {
      patient_id: patientId,
      start_at: futureDate(48),
      duration_minutes: 50,
    });

    expect(updateResult.ok).toBe(false);
    if (updateResult.ok) return;
    expect(updateResult.error).toBe('not_found');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await updateSessionImpl(client, randomUUID(), {
      patient_id: randomUUID(),
      start_at: futureDate(24),
      duration_minutes: 50,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });
});

// ---------------------------------------------------------------------------
// deleteSessionImpl
// ---------------------------------------------------------------------------

describe('deleteSessionImpl', () => {
  it('deletes a scheduled session and creates "deleted" history', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Fernando Gomes');
    const client = fakeSupabaseClient(userId);

    const createResult = await createSessionImpl(client, {
      patient_id: patientId,
      start_at: futureDate(24),
      duration_minutes: 50,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const deleteResult = await deleteSessionImpl(client, createResult.sessionId);
    expect(deleteResult.ok).toBe(true);

    // Verify session is gone
    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, createResult.sessionId));
    });
    expect(rows).toHaveLength(0);

    // History is also gone due to ON DELETE CASCADE — this is by design
    const historyRows = await runAsService(async (db) => {
      return db
        .select()
        .from(sessionHistory)
        .where(eq(sessionHistory.sessionId, createResult.sessionId));
    });
    expect(historyRows).toHaveLength(0);
  });

  it('rejects deletion of a session with status "done"', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Rita Souza');
    const client = fakeSupabaseClient(userId);

    const createResult = await createSessionImpl(client, {
      patient_id: patientId,
      start_at: futureDate(24),
      duration_minutes: 50,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    // Mark as done
    await markSessionDoneImpl(client, createResult.sessionId);

    // Try to delete
    const deleteResult = await deleteSessionImpl(client, createResult.sessionId);
    expect(deleteResult.ok).toBe(false);
    if (deleteResult.ok) return;
    expect(deleteResult.error).toBe('not_scheduled');
  });

  it('returns not_found for non-existent session', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await deleteSessionImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('returns not_found for session owned by another user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId, 'Test Patient');

    const clientA = fakeSupabaseClient(userA);
    const createResult = await createSessionImpl(clientA, {
      patient_id: patientId,
      start_at: futureDate(24),
      duration_minutes: 50,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const clientB = fakeSupabaseClient(userB);
    const result = await deleteSessionImpl(clientB, createResult.sessionId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await deleteSessionImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });
});

// ---------------------------------------------------------------------------
// markSessionDoneImpl
// ---------------------------------------------------------------------------

describe('markSessionDoneImpl', () => {
  it('marks a scheduled session as done', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Patricia Lima');
    const client = fakeSupabaseClient(userId);

    const createResult = await createSessionImpl(client, {
      patient_id: patientId,
      start_at: futureDate(24),
      duration_minutes: 50,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const markResult = await markSessionDoneImpl(client, createResult.sessionId);
    expect(markResult.ok).toBe(true);

    // Verify status changed
    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, createResult.sessionId));
    });
    expect(rows[0]!.status).toBe('done');

    // Verify history entry with status_changed
    const historyRows = await runAsService(async (db) => {
      return db
        .select()
        .from(sessionHistory)
        .where(eq(sessionHistory.sessionId, createResult.sessionId));
    });
    const statusEntry = historyRows.find((h) => h.action === 'status_changed');
    expect(statusEntry).toBeDefined();
    const changes = statusEntry!.changes as { status: { old: string; new: string } };
    expect(changes.status.old).toBe('scheduled');
    expect(changes.status.new).toBe('done');
  });

  it('rejects marking an already-done session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Marcos Ribeiro');
    const client = fakeSupabaseClient(userId);

    const createResult = await createSessionImpl(client, {
      patient_id: patientId,
      start_at: futureDate(24),
      duration_minutes: 50,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    // Mark done once
    await markSessionDoneImpl(client, createResult.sessionId);

    // Try again
    const secondMark = await markSessionDoneImpl(client, createResult.sessionId);
    expect(secondMark.ok).toBe(false);
    if (secondMark.ok) return;
    expect(secondMark.error).toBe('already_done');
  });

  it('returns not_found for non-existent session', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await markSessionDoneImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await markSessionDoneImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });
});

// ---------------------------------------------------------------------------
// listSessionsImpl
// ---------------------------------------------------------------------------

describe('listSessionsImpl', () => {
  it('lists sessions within a time window with patient and location details', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Carla Dias');
    const client = fakeSupabaseClient(userId);

    const startTime = futureDate(24);

    const createResult = await createSessionImpl(client, {
      patient_id: patientId,
      start_at: startTime,
      duration_minutes: 50,
    });
    expect(createResult.ok).toBe(true);

    // Query window that includes the session
    const windowStart = new Date();
    const windowEnd = new Date();
    windowEnd.setHours(windowEnd.getHours() + 48);

    const result = await listSessionsImpl(client, windowStart, windowEnd);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]!.patientName).toBe('Carla Dias');
  });

  it('filters sessions outside the time window', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Fernanda Costa');
    const client = fakeSupabaseClient(userId);

    // Create session far in the future
    const createResult = await createSessionImpl(client, {
      patient_id: patientId,
      start_at: futureDate(240),
      duration_minutes: 50,
    });
    expect(createResult.ok).toBe(true);

    // Query a window that does NOT include the session
    const windowStart = new Date();
    const windowEnd = new Date();
    windowEnd.setHours(windowEnd.getHours() + 48);

    const result = await listSessionsImpl(client, windowStart, windowEnd);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sessions).toHaveLength(0);
  });

  it('returns empty array when user has no sessions', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await listSessionsImpl(client, new Date(), new Date());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sessions).toHaveLength(0);
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await listSessionsImpl(client, new Date(), new Date());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });
});

// ---------------------------------------------------------------------------
// getSessionHistoryImpl
// ---------------------------------------------------------------------------

describe('getSessionHistoryImpl', () => {
  it('returns history entries ordered by created_at DESC', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Roberto Santos');
    const client = fakeSupabaseClient(userId);

    const createResult = await createSessionImpl(client, {
      patient_id: patientId,
      start_at: futureDate(24),
      duration_minutes: 50,
      notes: 'V1',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    // Get the current session data to use its start_at for update
    const sessionRows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, createResult.sessionId));
    });
    const existingStartAt = sessionRows[0]!.startAt.toISOString();

    // Update to add a second history entry
    await updateSessionImpl(client, createResult.sessionId, {
      patient_id: patientId,
      start_at: existingStartAt,
      duration_minutes: 50,
      notes: 'V2',
    });

    const result = await getSessionHistoryImpl(client, createResult.sessionId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.history).toHaveLength(2);
    // Most recent first
    expect(result.history[0]!.action).toBe('updated');
    expect(result.history[1]!.action).toBe('created');
  });

  it('returns not_found for session owned by another user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId, 'Test Patient');

    const clientA = fakeSupabaseClient(userA);
    const createResult = await createSessionImpl(clientA, {
      patient_id: patientId,
      start_at: futureDate(24),
      duration_minutes: 50,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const clientB = fakeSupabaseClient(userB);
    const result = await getSessionHistoryImpl(clientB, createResult.sessionId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await getSessionHistoryImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });
});

// ---------------------------------------------------------------------------
// RLS cross-user isolation
// ---------------------------------------------------------------------------

describe('RLS cross-user isolation', () => {
  it('psychologist A does not see sessions of psychologist B', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientA = randomUUID();
    const patientB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientA, 'Patient of A');
    await seedPatient(userB, patientB, 'Patient of B');

    const clientA = fakeSupabaseClient(userA);
    const clientB = fakeSupabaseClient(userB);

    // Each user creates a session
    await createSessionImpl(clientA, {
      patient_id: patientA,
      start_at: futureDate(24),
      duration_minutes: 50,
    });
    await createSessionImpl(clientB, {
      patient_id: patientB,
      start_at: futureDate(24),
      duration_minutes: 50,
    });

    const windowStart = new Date();
    const windowEnd = new Date();
    windowEnd.setHours(windowEnd.getHours() + 48);

    // User A lists — should only see their own
    const resultA = await listSessionsImpl(clientA, windowStart, windowEnd);
    expect(resultA.ok).toBe(true);
    if (!resultA.ok) return;
    expect(resultA.sessions).toHaveLength(1);
    expect(resultA.sessions[0]!.patientName).toBe('Patient of A');

    // User B lists — should only see their own
    const resultB = await listSessionsImpl(clientB, windowStart, windowEnd);
    expect(resultB.ok).toBe(true);
    if (!resultB.ok) return;
    expect(resultB.sessions).toHaveLength(1);
    expect(resultB.sessions[0]!.patientName).toBe('Patient of B');
  });
});

// ---------------------------------------------------------------------------
// History entries created correctly in each mutation
// ---------------------------------------------------------------------------

describe('history entries lifecycle', () => {
  it('records correct actions through a full lifecycle', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Lifecycle Patient');
    const client = fakeSupabaseClient(userId);

    // 1. Create
    const createResult = await createSessionImpl(client, {
      patient_id: patientId,
      start_at: futureDate(24),
      duration_minutes: 50,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    // Get the current session data for updates
    const sessionRows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, createResult.sessionId));
    });
    const existingStartAt = sessionRows[0]!.startAt.toISOString();

    // 2. Update (notes only — "updated")
    await updateSessionImpl(client, createResult.sessionId, {
      patient_id: patientId,
      start_at: existingStartAt,
      duration_minutes: 50,
      notes: 'Added note',
    });

    // 3. Reschedule (change start_at — "rescheduled")
    await updateSessionImpl(client, createResult.sessionId, {
      patient_id: patientId,
      start_at: futureDate(48),
      duration_minutes: 50,
      notes: 'Added note',
      force_conflict: true,
    });

    // 4. Mark done ("status_changed")
    await markSessionDoneImpl(client, createResult.sessionId);

    // Verify all history entries
    const historyResult = await getSessionHistoryImpl(client, createResult.sessionId);
    expect(historyResult.ok).toBe(true);
    if (!historyResult.ok) return;

    expect(historyResult.history).toHaveLength(4);
    const actions = historyResult.history.map((h) => h.action);
    // Ordered DESC by created_at
    expect(actions).toEqual(['status_changed', 'rescheduled', 'updated', 'created']);
  });
});
