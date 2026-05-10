import { randomUUID } from 'node:crypto';

import { and, eq, isNull, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { cancelSessionImpl } from '@/modules/agenda/server/cancel-session';
import { createSessionImpl } from '@/modules/agenda/server/create-session';
import { softDeleteSessionImpl } from '@/modules/agenda/server/soft-delete-session';
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

async function cancelTestSession(userId: string, sessionId: string): Promise<void> {
  const client = fakeSupabaseClient(userId);
  const result = await cancelSessionImpl(client, {
    sessionId,
    reason: 'patient_cancelled',
    cancelledBy: 'patient',
    chargeCancellation: false,
  });
  expect(result.ok).toBe(true);
}

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(sessionHistory);
    await db.delete(sessions);
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// =====================================================================
// softDeleteSessionImpl
// =====================================================================

describe('softDeleteSessionImpl', () => {
  it('soft-deletes a cancelled session (deleted_at set)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Maria Silva');
    const sessionId = await createTestSession(userId, patientId);
    await cancelTestSession(userId, sessionId);
    const client = fakeSupabaseClient(userId);

    const result = await softDeleteSessionImpl(client, sessionId, true);
    expect(result.ok).toBe(true);

    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, sessionId));
    });
    expect(rows[0]!.deletedAt).toBeTruthy();
  });

  it('soft-deleted session still exists in DB (not hard-deleted)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Pedro Alves');
    const sessionId = await createTestSession(userId, patientId);
    await cancelTestSession(userId, sessionId);
    const client = fakeSupabaseClient(userId);

    await softDeleteSessionImpl(client, sessionId, true);

    // Session still exists in the DB, just with deleted_at set
    const allRows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, sessionId));
    });
    expect(allRows).toHaveLength(1);
    expect(allRows[0]!.deletedAt).toBeTruthy();

    // Standard queries should filter by deleted_at IS NULL
    const activeRows = await runAsService(async (db) => {
      return db
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), isNull(sessions.deletedAt)));
    });
    expect(activeRows).toHaveLength(0);
  });

  it('rejects soft-delete for non-cancelled session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Ana Costa');
    const sessionId = await createTestSession(userId, patientId);
    const client = fakeSupabaseClient(userId);

    const result = await softDeleteSessionImpl(client, sessionId, true);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_cancelled');
  });

  it('rejects soft-delete for session with done history', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Fernando Gomes');
    const sessionId = await createTestSession(userId, patientId);
    const client = fakeSupabaseClient(userId);

    // Mark as done first, then cancel (via reactivate path to get back to scheduled,
    // but the history of "done" remains)
    // Lifecycle: scheduled → done → (we need to get to cancelled with done history)
    // Since done → cancelled is not a valid transition, we simulate the scenario
    // by directly inserting a history entry for "done" and then the session is cancelled
    await runAsService(async (db) => {
      // Insert a history entry that records a prior done transition
      await db.insert(sessionHistory).values({
        sessionId,
        userId,
        action: 'status_changed',
        changes: {
          status: { old: 'scheduled', new: 'done' },
        },
      });

      // Set session to cancelled directly (simulating an admin override scenario)
      await db.update(sessions).set({ status: 'cancelled' }).where(eq(sessions.id, sessionId));
    });

    const result = await softDeleteSessionImpl(client, sessionId, true);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('has_done_or_no_show_history');
  });

  it('rejects soft-delete for session with no_show history', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Carlos Lima');
    const sessionId = await createTestSession(userId, patientId);
    const client = fakeSupabaseClient(userId);

    // Insert a history entry that records a prior no_show transition
    await runAsService(async (db) => {
      await db.insert(sessionHistory).values({
        sessionId,
        userId,
        action: 'status_changed',
        changes: {
          status: { old: 'scheduled', new: 'no_show' },
        },
      });

      await db.update(sessions).set({ status: 'cancelled' }).where(eq(sessions.id, sessionId));
    });

    const result = await softDeleteSessionImpl(client, sessionId, true);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('has_done_or_no_show_history');
  });

  it('rejects soft-delete without confirmation flag', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Lucia Mendes');
    const sessionId = await createTestSession(userId, patientId);
    await cancelTestSession(userId, sessionId);
    const client = fakeSupabaseClient(userId);

    const result = await softDeleteSessionImpl(client, sessionId, false);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_confirmed');
  });

  it('returns not_found for session owned by another user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId, 'Test Patient');
    const sessionId = await createTestSession(userA, patientId);
    await cancelTestSession(userA, sessionId);

    const clientB = fakeSupabaseClient(userB);
    const result = await softDeleteSessionImpl(clientB, sessionId, true);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await softDeleteSessionImpl(client, randomUUID(), true);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });
});
