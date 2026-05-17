import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { cancelSessionImpl } from '@/modules/agenda/server/cancel-session';
import { confirmSessionImpl } from '@/modules/agenda/server/confirm-session';
import { createSessionImpl } from '@/modules/agenda/server/create-session';
import { markSessionDoneImpl } from '@/modules/agenda/server/mark-session-done';
import { markSessionNoShowImpl } from '@/modules/agenda/server/mark-session-no-show';
import { reactivateSessionImpl } from '@/modules/agenda/server/reactivate-session';
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

/** Returns an ISO 8601 datetime string for a future date. */
function futureDate(hoursFromNow: number): string {
  const d = new Date();
  d.setHours(d.getHours() + hoursFromNow);
  return d.toISOString();
}

/** Creates a session and returns its ID (asserts creation success). */
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
// confirmSessionImpl
// =====================================================================

describe('confirmSessionImpl', () => {
  it('confirms a scheduled session (status changes, confirmed_at set, history created)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Maria Silva');
    const sessionId = await createTestSession(userId, patientId);
    const client = fakeSupabaseClient(userId);

    const result = await confirmSessionImpl(client, sessionId);
    expect(result.ok).toBe(true);

    // Verify status changed to confirmed
    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, sessionId));
    });
    expect(rows[0]!.status).toBe('confirmed');
    expect(rows[0]!.confirmedAt).toBeTruthy();

    // Verify history entry
    const historyRows = await runAsService(async (db) => {
      return db.select().from(sessionHistory).where(eq(sessionHistory.sessionId, sessionId));
    });
    const statusEntry = historyRows.find((h) => h.action === 'status_changed');
    expect(statusEntry).toBeDefined();
    const changes = statusEntry!.changes as { status: { old: string; new: string } };
    expect(changes.status.old).toBe('scheduled');
    expect(changes.status.new).toBe('confirmed');
  });

  it('rejects confirming an already confirmed session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Ana Costa');
    const sessionId = await createTestSession(userId, patientId);
    const client = fakeSupabaseClient(userId);

    await confirmSessionImpl(client, sessionId);
    const result = await confirmSessionImpl(client, sessionId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_transition');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await confirmSessionImpl(client, randomUUID());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
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
    const result = await confirmSessionImpl(clientB, sessionId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });
});

// =====================================================================
// cancelSessionImpl
// =====================================================================

describe('cancelSessionImpl', () => {
  it('cancels a scheduled session with all cancellation fields populated', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Pedro Alves');
    const sessionId = await createTestSession(userId, patientId);
    const client = fakeSupabaseClient(userId);

    const result = await cancelSessionImpl(client, {
      sessionId,
      reason: 'patient_cancelled',
      cancelledBy: 'patient',
      chargeCancellation: false,
    });

    expect(result.ok).toBe(true);

    // Verify all cancellation fields
    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, sessionId));
    });
    expect(rows[0]!.status).toBe('cancelled');
    expect(rows[0]!.cancellationReason).toBe('patient_cancelled');
    expect(rows[0]!.cancelledBy).toBe('patient');
    expect(rows[0]!.cancellationNotice).toBeTruthy();
    expect(rows[0]!.cancelledAt).toBeTruthy();
    expect(rows[0]!.chargeCancellation).toBe(false);

    // Verify history entry with cancellation metadata
    const historyRows = await runAsService(async (db) => {
      return db.select().from(sessionHistory).where(eq(sessionHistory.sessionId, sessionId));
    });
    const statusEntry = historyRows.find((h) => h.action === 'status_changed');
    expect(statusEntry).toBeDefined();
    const changes = statusEntry!.changes as {
      status: { old: string; new: string };
      cancellation: Record<string, unknown>;
    };
    expect(changes.status.old).toBe('scheduled');
    expect(changes.status.new).toBe('cancelled');
    expect(changes.cancellation).toBeDefined();
    expect(changes.cancellation.reason).toBe('patient_cancelled');
  });

  it('cancels a confirmed session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Lucia Mendes');
    const sessionId = await createTestSession(userId, patientId);
    const client = fakeSupabaseClient(userId);

    // First confirm, then cancel
    await confirmSessionImpl(client, sessionId);
    const result = await cancelSessionImpl(client, {
      sessionId,
      reason: 'therapist_cancelled',
      cancelledBy: 'therapist',
      chargeCancellation: false,
    });

    expect(result.ok).toBe(true);

    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, sessionId));
    });
    expect(rows[0]!.status).toBe('cancelled');
  });

  it('returns rescheduleData when isReschedule is true', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Fernando Gomes');
    const sessionId = await createTestSession(userId, patientId);
    const client = fakeSupabaseClient(userId);

    const result = await cancelSessionImpl(client, {
      sessionId,
      reason: 'therapist_cancelled',
      cancelledBy: 'therapist',
      chargeCancellation: false,
      isReschedule: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rescheduleData).toBeDefined();
    expect(result.rescheduleData!.patientId).toBe(patientId);
    expect(result.rescheduleData!.durationMinutes).toBe(50);
  });

  it('rejects cancelling a done session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Carlos Lima');
    const sessionId = await createTestSession(userId, patientId);
    const client = fakeSupabaseClient(userId);

    await markSessionDoneImpl(client, sessionId);

    const result = await cancelSessionImpl(client, {
      sessionId,
      reason: 'patient_cancelled',
      cancelledBy: 'patient',
      chargeCancellation: false,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_transition');
  });

  it('returns invalid_input for bad input', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await cancelSessionImpl(client, {
      sessionId: 'not-a-uuid',
      reason: 'invalid_reason',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_input');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await cancelSessionImpl(client, {
      sessionId: randomUUID(),
      reason: 'patient_cancelled',
      cancelledBy: 'patient',
      chargeCancellation: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });
});

// =====================================================================
// markSessionDoneImpl (updated with state machine validation)
// =====================================================================

describe('markSessionDoneImpl — state transitions', () => {
  it('marks a scheduled session as done', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Patricia Lima');
    const sessionId = await createTestSession(userId, patientId);
    const client = fakeSupabaseClient(userId);

    const result = await markSessionDoneImpl(client, sessionId);
    expect(result.ok).toBe(true);

    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, sessionId));
    });
    expect(rows[0]!.status).toBe('done');
  });

  it('marks a confirmed session as done', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Roberto Santos');
    const sessionId = await createTestSession(userId, patientId);
    const client = fakeSupabaseClient(userId);

    await confirmSessionImpl(client, sessionId);
    const result = await markSessionDoneImpl(client, sessionId);
    expect(result.ok).toBe(true);

    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, sessionId));
    });
    expect(rows[0]!.status).toBe('done');
  });

  it('rejects marking a cancelled session as done', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Carla Dias');
    const sessionId = await createTestSession(userId, patientId);
    const client = fakeSupabaseClient(userId);

    await cancelSessionImpl(client, {
      sessionId,
      reason: 'patient_cancelled',
      cancelledBy: 'patient',
      chargeCancellation: false,
    });

    const result = await markSessionDoneImpl(client, sessionId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_transition');
  });

  it('rejects 7-day locked done session edit', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Rita Souza');

    // Create session and mark done
    const sessionId = await createTestSession(userId, patientId);
    const client = fakeSupabaseClient(userId);
    await markSessionDoneImpl(client, sessionId);

    // Manually set updatedAt to 8 days ago to simulate lock
    await runAsService(async (db) => {
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      await db.update(sessions).set({ updatedAt: eightDaysAgo }).where(eq(sessions.id, sessionId));
    });

    // Attempting any edit on a locked done session should fail
    const result = await markSessionDoneImpl(client, sessionId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('session_locked');
  });
});

// =====================================================================
// markSessionNoShowImpl
// =====================================================================

describe('markSessionNoShowImpl', () => {
  it('marks a scheduled session as no_show (cancellation fields remain null)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Joao Souza');
    const sessionId = await createTestSession(userId, patientId);
    const client = fakeSupabaseClient(userId);

    const result = await markSessionNoShowImpl(client, sessionId);
    expect(result.ok).toBe(true);

    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, sessionId));
    });
    expect(rows[0]!.status).toBe('no_show');
    // Cancellation fields must remain null — no_show is distinct from cancellation
    expect(rows[0]!.cancellationReason).toBeNull();
    expect(rows[0]!.cancelledBy).toBeNull();
    expect(rows[0]!.cancellationNotice).toBeNull();
    expect(rows[0]!.cancelledAt).toBeNull();

    // Verify history entry
    const historyRows = await runAsService(async (db) => {
      return db.select().from(sessionHistory).where(eq(sessionHistory.sessionId, sessionId));
    });
    const statusEntry = historyRows.find((h) => h.action === 'status_changed');
    expect(statusEntry).toBeDefined();
    const changes = statusEntry!.changes as { status: { old: string; new: string } };
    expect(changes.status.old).toBe('scheduled');
    expect(changes.status.new).toBe('no_show');
  });

  it('marks a confirmed session as no_show', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Fernanda Costa');
    const sessionId = await createTestSession(userId, patientId);
    const client = fakeSupabaseClient(userId);

    await confirmSessionImpl(client, sessionId);
    const result = await markSessionNoShowImpl(client, sessionId);
    expect(result.ok).toBe(true);

    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, sessionId));
    });
    expect(rows[0]!.status).toBe('no_show');
  });

  it('rejects no_show on a done session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Marcos Ribeiro');
    const sessionId = await createTestSession(userId, patientId);
    const client = fakeSupabaseClient(userId);

    await markSessionDoneImpl(client, sessionId);
    const result = await markSessionNoShowImpl(client, sessionId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_transition');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await markSessionNoShowImpl(client, randomUUID());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
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
    const result = await markSessionNoShowImpl(clientB, sessionId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });
});

// =====================================================================
// reactivateSessionImpl
// =====================================================================

describe('reactivateSessionImpl', () => {
  it('reactivates a cancelled session (fields cleared, history created)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Ana Costa');
    const sessionId = await createTestSession(userId, patientId);
    const client = fakeSupabaseClient(userId);

    // Cancel first
    await cancelSessionImpl(client, {
      sessionId,
      reason: 'patient_cancelled',
      cancelledBy: 'patient',
      chargeCancellation: true,
    });

    // Reactivate
    const result = await reactivateSessionImpl(client, sessionId);
    expect(result.ok).toBe(true);

    // Verify status and that cancellation fields are cleared
    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, sessionId));
    });
    expect(rows[0]!.status).toBe('scheduled');
    expect(rows[0]!.cancellationReason).toBeNull();
    expect(rows[0]!.cancelledBy).toBeNull();
    expect(rows[0]!.cancellationNotice).toBeNull();
    expect(rows[0]!.cancelledAt).toBeNull();
    expect(rows[0]!.chargeCancellation).toBe(false);
    expect(rows[0]!.rescheduledToSessionId).toBeNull();
    expect(rows[0]!.rescheduledFromSessionId).toBeNull();

    // Verify history entry
    const historyRows = await runAsService(async (db) => {
      return db.select().from(sessionHistory).where(eq(sessionHistory.sessionId, sessionId));
    });
    const reactivateEntry = historyRows.find(
      (h) =>
        h.action === 'status_changed' &&
        (h.changes as { status?: { new: string } }).status?.new === 'scheduled',
    );
    expect(reactivateEntry).toBeDefined();
    const changes = reactivateEntry!.changes as {
      status: { old: string; new: string };
      reactivated: boolean;
    };
    expect(changes.status.old).toBe('cancelled');
    expect(changes.status.new).toBe('scheduled');
    expect(changes.reactivated).toBe(true);
  });

  it('rejects reactivating a scheduled session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Pedro Alves');
    const sessionId = await createTestSession(userId, patientId);
    const client = fakeSupabaseClient(userId);

    const result = await reactivateSessionImpl(client, sessionId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_transition');
  });

  it('rejects reactivating a done session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Lucia Mendes');
    const sessionId = await createTestSession(userId, patientId);
    const client = fakeSupabaseClient(userId);

    await markSessionDoneImpl(client, sessionId);
    const result = await reactivateSessionImpl(client, sessionId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_transition');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await reactivateSessionImpl(client, randomUUID());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });
});

// =====================================================================
// Invalid transitions are rejected with typed error
// =====================================================================

describe('invalid transitions are rejected', () => {
  it.each([
    { from: 'done', action: 'confirm' },
    { from: 'no_show', action: 'confirm' },
    { from: 'no_show', action: 'cancel' },
    { from: 'no_show', action: 'reactivate' },
  ])('rejects transition from "$from" via "$action"', async ({ from, action }) => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Test Patient');
    const sessionId = await createTestSession(userId, patientId);
    const client = fakeSupabaseClient(userId);

    // Move to the desired "from" state
    if (from === 'done') {
      await markSessionDoneImpl(client, sessionId);
    } else if (from === 'no_show') {
      await markSessionNoShowImpl(client, sessionId);
    }

    // Attempt the invalid transition
    let result;
    if (action === 'confirm') {
      result = await confirmSessionImpl(client, sessionId);
    } else if (action === 'cancel') {
      result = await cancelSessionImpl(client, {
        sessionId,
        reason: 'patient_cancelled',
        cancelledBy: 'patient',
        chargeCancellation: false,
      });
    } else {
      result = await reactivateSessionImpl(client, sessionId);
    }

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_transition');
  });
});

// =====================================================================
// Cross-user access blocked by ownership check
// =====================================================================

describe('cross-user access blocked', () => {
  it('all status transition actions reject cross-user access', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId, 'Patient of A');

    const sessionId = await createTestSession(userA, patientId);
    const clientB = fakeSupabaseClient(userB);

    // Confirm
    const confirmResult = await confirmSessionImpl(clientB, sessionId);
    expect(confirmResult.ok).toBe(false);
    if (!confirmResult.ok) expect(confirmResult.error).toBe('not_found');

    // Mark done
    const doneResult = await markSessionDoneImpl(clientB, sessionId);
    expect(doneResult.ok).toBe(false);
    if (!doneResult.ok) expect(doneResult.error).toBe('not_found');

    // Mark no_show
    const noShowResult = await markSessionNoShowImpl(clientB, sessionId);
    expect(noShowResult.ok).toBe(false);
    if (!noShowResult.ok) expect(noShowResult.error).toBe('not_found');

    // Cancel
    const cancelResult = await cancelSessionImpl(clientB, {
      sessionId,
      reason: 'patient_cancelled',
      cancelledBy: 'patient',
      chargeCancellation: false,
    });
    expect(cancelResult.ok).toBe(false);
    if (!cancelResult.ok) expect(cancelResult.error).toBe('not_found');

    // Reactivate
    const reactivateResult = await reactivateSessionImpl(clientB, sessionId);
    expect(reactivateResult.ok).toBe(false);
    if (!reactivateResult.ok) expect(reactivateResult.error).toBe('not_found');
  });
});
