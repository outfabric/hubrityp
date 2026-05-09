import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { createCoupleSessionImpl } from '@/modules/sessions/server/create-couple-session';
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
  } as Parameters<typeof createCoupleSessionImpl>[0];
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
    await db.delete(sessionRecurrences);
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// =====================================================================
// createCoupleSessionImpl
// =====================================================================

describe('createCoupleSessionImpl', () => {
  it('creates couple session with 2 patient_ids — patient_id is set to first entry', async () => {
    const userId = randomUUID();
    const patient1 = randomUUID();
    const patient2 = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patient1, 'Ana Costa');
    await seedPatient(userId, patient2, 'Carlos Lima');
    const client = fakeSupabaseClient(userId);

    const result = await createCoupleSessionImpl(client, {
      session: {
        patient_id: patient1,
        start_at: futureDate(24),
        duration_minutes: 50,
      },
      couple: {
        patient_ids: [patient1, patient2],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sessionId).toBeDefined();

    // Verify patient_id = first entry
    const [session] = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, result.sessionId));
    });
    expect(session!.patientId).toBe(patient1);

    // Verify patient_ids contains both
    expect(session!.patientIds).toEqual([patient1, patient2]);
  });

  it('rejects >2 patient_ids', async () => {
    const userId = randomUUID();
    const p1 = randomUUID();
    const p2 = randomUUID();
    const p3 = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, p1, 'A');
    await seedPatient(userId, p2, 'B');
    await seedPatient(userId, p3, 'C');
    const client = fakeSupabaseClient(userId);

    const result = await createCoupleSessionImpl(client, {
      session: {
        patient_id: p1,
        start_at: futureDate(24),
        duration_minutes: 50,
      },
      couple: {
        patient_ids: [p1, p2, p3],
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_input');
  });

  it('rejects duplicate patient_ids', async () => {
    const userId = randomUUID();
    const p1 = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, p1, 'Duplicate Patient');
    const client = fakeSupabaseClient(userId);

    const result = await createCoupleSessionImpl(client, {
      session: {
        patient_id: p1,
        start_at: futureDate(24),
        duration_minutes: 50,
      },
      couple: {
        patient_ids: [p1, p1],
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_input');
  });

  it('creates history entry with couple session metadata', async () => {
    const userId = randomUUID();
    const patient1 = randomUUID();
    const patient2 = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patient1, 'Ana');
    await seedPatient(userId, patient2, 'Carlos');
    const client = fakeSupabaseClient(userId);

    const result = await createCoupleSessionImpl(client, {
      session: {
        patient_id: patient1,
        start_at: futureDate(48),
        duration_minutes: 50,
      },
      couple: {
        patient_ids: [patient1, patient2],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const historyRows = await runAsService(async (db) => {
      return db.select().from(sessionHistory).where(eq(sessionHistory.sessionId, result.sessionId));
    });
    expect(historyRows).toHaveLength(1);
    expect(historyRows[0]!.action).toBe('created');
    const changes = historyRows[0]!.changes as { coupleSession: boolean };
    expect(changes.coupleSession).toBe(true);
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await createCoupleSessionImpl(client, {
      session: {
        patient_id: randomUUID(),
        start_at: futureDate(24),
        duration_minutes: 50,
      },
      couple: {
        patient_ids: [randomUUID(), randomUUID()],
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });

  it('RLS blocks cross-psychologist access to couple sessions', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patient1 = randomUUID();
    const patient2 = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patient1, 'Patient A1');
    await seedPatient(userA, patient2, 'Patient A2');
    const clientA = fakeSupabaseClient(userA);

    const result = await createCoupleSessionImpl(clientA, {
      session: {
        patient_id: patient1,
        start_at: futureDate(24),
        duration_minutes: 50,
      },
      couple: {
        patient_ids: [patient1, patient2],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // User B should not see the session via RLS
    const rowsAsB = await runAsUser(userB, async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, result.sessionId));
    });
    expect(rowsAsB).toHaveLength(0);

    // User A should see it
    const rowsAsA = await runAsUser(userA, async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, result.sessionId));
    });
    expect(rowsAsA).toHaveLength(1);
  });
});
