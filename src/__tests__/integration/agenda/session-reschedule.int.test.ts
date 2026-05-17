import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { completeRescheduleImpl } from '@/modules/agenda/server/complete-reschedule';
import { confirmSessionImpl } from '@/modules/agenda/server/confirm-session';
import { createSessionImpl } from '@/modules/agenda/server/create-session';
import { markSessionDoneImpl } from '@/modules/agenda/server/mark-session-done';
import { sessions, sessionHistory } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { cleanTestData } from '../setup/clean-test-data';
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

function futureDate(hoursFromNow: number): string {
  const d = new Date();
  d.setHours(d.getHours() + hoursFromNow);
  return d.toISOString();
}

async function createTestSession(
  userId: string,
  patientId: string,
  hoursFromNow = 48,
): Promise<string> {
  const client = fakeSupabaseClient(userId);
  const result = await createSessionImpl(client, {
    patient_id: patientId,
    start_at: futureDate(hoursFromNow),
    duration_minutes: 50,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Session creation failed in test helper');
  return result.sessionId;
}

afterEach(async () => {
  await cleanTestData();
});

// =====================================================================
// completeRescheduleImpl
// =====================================================================

describe('completeRescheduleImpl', () => {
  it('reschedule creates new session with bidirectional links', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Maria Silva');
    const oldSessionId = await createTestSession(userId, patientId, 48);
    const client = fakeSupabaseClient(userId);

    const result = await completeRescheduleImpl(client, oldSessionId, {
      patient_id: patientId,
      start_at: futureDate(72),
      duration_minutes: 50,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newSessionId).toBeDefined();

    // Verify bidirectional links
    const oldRows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, oldSessionId));
    });
    expect(oldRows[0]!.rescheduledToSessionId).toBe(result.newSessionId);
    expect(oldRows[0]!.status).toBe('cancelled');

    const newRows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, result.newSessionId));
    });
    expect(newRows[0]!.rescheduledFromSessionId).toBe(oldSessionId);
    expect(newRows[0]!.status).toBe('scheduled');
  });

  it('both sessions have history entries', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Pedro Alves');
    const oldSessionId = await createTestSession(userId, patientId, 48);
    const client = fakeSupabaseClient(userId);

    const result = await completeRescheduleImpl(client, oldSessionId, {
      patient_id: patientId,
      start_at: futureDate(72),
      duration_minutes: 50,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Old session history — should have "created" + "status_changed" (cancelled/rescheduled)
    const oldHistory = await runAsService(async (db) => {
      return db.select().from(sessionHistory).where(eq(sessionHistory.sessionId, oldSessionId));
    });
    expect(oldHistory.length).toBeGreaterThanOrEqual(2);
    const oldStatusChange = oldHistory.find((h) => h.action === 'status_changed');
    expect(oldStatusChange).toBeDefined();
    const oldChanges = oldStatusChange!.changes as {
      status: { old: string; new: string };
      reschedule: { type: string; newSessionId: string };
    };
    expect(oldChanges.status.new).toBe('cancelled');
    expect(oldChanges.reschedule.type).toBe('rescheduled_to');
    expect(oldChanges.reschedule.newSessionId).toBe(result.newSessionId);

    // New session history — should have "created" with reschedule info
    const newHistory = await runAsService(async (db) => {
      return db
        .select()
        .from(sessionHistory)
        .where(eq(sessionHistory.sessionId, result.newSessionId));
    });
    expect(newHistory).toHaveLength(1);
    expect(newHistory[0]!.action).toBe('created');
    const newChanges = newHistory[0]!.changes as {
      reschedule: { type: string; oldSessionId: string };
    };
    expect(newChanges.reschedule.type).toBe('rescheduled_from');
    expect(newChanges.reschedule.oldSessionId).toBe(oldSessionId);
  });

  it('old session is cancelled with cancellation fields', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Ana Costa');
    const oldSessionId = await createTestSession(userId, patientId, 48);
    const client = fakeSupabaseClient(userId);

    const result = await completeRescheduleImpl(client, oldSessionId, {
      patient_id: patientId,
      start_at: futureDate(72),
      duration_minutes: 50,
    });
    expect(result.ok).toBe(true);

    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, oldSessionId));
    });
    expect(rows[0]!.status).toBe('cancelled');
    expect(rows[0]!.cancellationReason).toBe('therapist_cancelled');
    expect(rows[0]!.cancelledBy).toBe('therapist');
    expect(rows[0]!.cancelledAt).toBeTruthy();
    expect(rows[0]!.cancellationNotice).toBeTruthy();
    expect(rows[0]!.chargeCancellation).toBe(false);
  });

  it('rejects rescheduling a done session (invalid transition)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Fernando Gomes');
    const sessionId = await createTestSession(userId, patientId, 48);
    const client = fakeSupabaseClient(userId);

    await markSessionDoneImpl(client, sessionId);

    const result = await completeRescheduleImpl(client, sessionId, {
      patient_id: patientId,
      start_at: futureDate(72),
      duration_minutes: 50,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_transition');
  });

  it('reschedules a confirmed session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Lucia Mendes');
    const sessionId = await createTestSession(userId, patientId, 48);
    const client = fakeSupabaseClient(userId);

    await confirmSessionImpl(client, sessionId);

    const result = await completeRescheduleImpl(client, sessionId, {
      patient_id: patientId,
      start_at: futureDate(72),
      duration_minutes: 50,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Old session should be cancelled
    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, sessionId));
    });
    expect(rows[0]!.status).toBe('cancelled');
    expect(rows[0]!.rescheduledToSessionId).toBe(result.newSessionId);
  });

  it('returns not_found for session owned by another user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId, 'Test Patient');
    const sessionId = await createTestSession(userA, patientId);

    const clientB = fakeSupabaseClient(userB);
    const result = await completeRescheduleImpl(clientB, sessionId, {
      patient_id: patientId,
      start_at: futureDate(72),
      duration_minutes: 50,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await completeRescheduleImpl(client, randomUUID(), {
      patient_id: randomUUID(),
      start_at: futureDate(72),
      duration_minutes: 50,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });

  it('returns invalid_input for bad new session data', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Carlos Lima');
    const sessionId = await createTestSession(userId, patientId);
    const client = fakeSupabaseClient(userId);

    const result = await completeRescheduleImpl(client, sessionId, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_input');
  });
});
