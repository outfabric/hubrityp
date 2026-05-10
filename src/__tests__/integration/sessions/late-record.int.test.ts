import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { createLateRecordImpl } from '@/modules/sessions/server/create-late-record';
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
  } as Parameters<typeof createLateRecordImpl>[0];
}

/** Returns an ISO 8601 datetime string for a past date. */
function pastDate(hoursAgo: number): string {
  const d = new Date();
  d.setHours(d.getHours() - hoursAgo);
  return d.toISOString();
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
// createLateRecordImpl
// =====================================================================

describe('createLateRecordImpl', () => {
  it('creates late record with past date — status=done and is_late_record=true', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Maria Silva');
    const client = fakeSupabaseClient(userId);

    const pastDateStr = pastDate(48);

    const result = await createLateRecordImpl(client, {
      session: {
        patient_id: patientId,
        start_at: pastDateStr,
        duration_minutes: 50,
      },
      lateRecord: {
        is_late_record: true,
        date: pastDateStr,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [session] = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, result.sessionId));
    });

    expect(session!.status).toBe('done');
    expect(session!.isLateRecord).toBe(true);
    expect(session!.patientId).toBe(patientId);
  });

  it('rejects late record with future date', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Joao Souza');
    const client = fakeSupabaseClient(userId);

    const futureDateStr = futureDate(24);

    const result = await createLateRecordImpl(client, {
      session: {
        patient_id: patientId,
        start_at: futureDateStr,
        duration_minutes: 50,
      },
      lateRecord: {
        is_late_record: true,
        date: futureDateStr,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_input');
  });

  it('late record still detects conflicts with existing sessions', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Ana Costa');
    const client = fakeSupabaseClient(userId);

    const pastDateStr = pastDate(48);

    // Create a first late record at the same time
    const first = await createLateRecordImpl(client, {
      session: {
        patient_id: patientId,
        start_at: pastDateStr,
        duration_minutes: 50,
      },
      lateRecord: {
        is_late_record: true,
        date: pastDateStr,
      },
    });
    expect(first.ok).toBe(true);

    // Try to create another late record at the same time — should warn about conflict
    const second = await createLateRecordImpl(client, {
      session: {
        patient_id: patientId,
        start_at: pastDateStr,
        duration_minutes: 50,
      },
      lateRecord: {
        is_late_record: true,
        date: pastDateStr,
      },
    });

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toBe('conflict_warning');
  });

  it('late record with force_conflict=true creates despite conflict', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Pedro Alves');
    const client = fakeSupabaseClient(userId);

    const pastDateStr = pastDate(72);

    // Create first late record
    await createLateRecordImpl(client, {
      session: {
        patient_id: patientId,
        start_at: pastDateStr,
        duration_minutes: 50,
      },
      lateRecord: {
        is_late_record: true,
        date: pastDateStr,
      },
    });

    // Create second with force
    const second = await createLateRecordImpl(client, {
      session: {
        patient_id: patientId,
        start_at: pastDateStr,
        duration_minutes: 50,
      },
      lateRecord: {
        is_late_record: true,
        date: pastDateStr,
      },
      force_conflict: true,
    });

    expect(second.ok).toBe(true);
  });

  it('creates history entry with isLateRecord flag', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Lucia Mendes');
    const client = fakeSupabaseClient(userId);

    const pastDateStr = pastDate(24);

    const result = await createLateRecordImpl(client, {
      session: {
        patient_id: patientId,
        start_at: pastDateStr,
        duration_minutes: 50,
      },
      lateRecord: {
        is_late_record: true,
        date: pastDateStr,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const historyRows = await runAsService(async (db) => {
      return db.select().from(sessionHistory).where(eq(sessionHistory.sessionId, result.sessionId));
    });
    expect(historyRows).toHaveLength(1);
    expect(historyRows[0]!.action).toBe('created');
    const changes = historyRows[0]!.changes as { isLateRecord: boolean };
    expect(changes.isLateRecord).toBe(true);
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await createLateRecordImpl(client, {
      session: {
        patient_id: randomUUID(),
        start_at: pastDate(24),
        duration_minutes: 50,
      },
      lateRecord: {
        is_late_record: true,
        date: pastDate(24),
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });

  it('RLS blocks cross-psychologist access to late records', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId, 'Patient A');
    const clientA = fakeSupabaseClient(userA);

    const pastDateStr = pastDate(48);

    const result = await createLateRecordImpl(clientA, {
      session: {
        patient_id: patientId,
        start_at: pastDateStr,
        duration_minutes: 50,
      },
      lateRecord: {
        is_late_record: true,
        date: pastDateStr,
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
