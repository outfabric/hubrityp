import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import {
  archivePatientImpl,
  unarchivePatientImpl,
} from '@/modules/patients/server/archive-patient';
import { deletePatientImpl } from '@/modules/patients/server/delete-patient';
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

function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- fake implementation returns a static value
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as Parameters<typeof archivePatientImpl>[0];
}

async function seedPatient(
  userId: string,
  patientId: string,
  overrides: Partial<{ status: string; archivedAt: Date }> = {},
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Test Patient',
      patientType: 'individual',
      status: overrides.status ?? 'active',
      archivedAt: overrides.archivedAt ?? null,
    });
  });
}

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// archivePatientImpl
// ---------------------------------------------------------------------------

describe('archivePatientImpl', () => {
  it('archives an active patient successfully', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const result = await archivePatientImpl(client, patientId);

    expect(result.ok).toBe(true);

    // Verify DB state
    const rows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.id, patientId));
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('archived');
    expect(rows[0]!.archivedAt).not.toBeNull();
  });

  it('preserves all patient data after archiving', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(patients).values({
        id: patientId,
        userId,
        fullName: 'Maria Silva',
        patientType: 'couple',
        phone: '+55 11 91234-5678',
        email: 'maria@example.com',
        tags: ['ansiedade', 'tcc'],
        notes: 'Important clinical notes',
        status: 'active',
      });
    });

    const client = fakeSupabaseClient(userId);
    await archivePatientImpl(client, patientId);

    const rows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.id, patientId));
    });
    expect(rows[0]!.fullName).toBe('Maria Silva');
    expect(rows[0]!.patientType).toBe('couple');
    expect(rows[0]!.phone).toBe('+55 11 91234-5678');
    expect(rows[0]!.email).toBe('maria@example.com');
    expect(rows[0]!.tags).toEqual(['ansiedade', 'tcc']);
    expect(rows[0]!.notes).toBe('Important clinical notes');
    expect(rows[0]!.status).toBe('archived');
  });

  it('returns already_archived when patient is already archived', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, { status: 'archived', archivedAt: new Date() });

    const client = fakeSupabaseClient(userId);
    const result = await archivePatientImpl(client, patientId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('already_archived');
  });

  it('returns not_found for patient owned by another user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    const client = fakeSupabaseClient(userB);
    const result = await archivePatientImpl(client, patientId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('returns not_found for non-existent patient', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const client = fakeSupabaseClient(userId);
    const result = await archivePatientImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await archivePatientImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });
});

// ---------------------------------------------------------------------------
// unarchivePatientImpl
// ---------------------------------------------------------------------------

describe('unarchivePatientImpl', () => {
  it('unarchives an archived patient successfully', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, { status: 'archived', archivedAt: new Date() });

    const client = fakeSupabaseClient(userId);
    const result = await unarchivePatientImpl(client, patientId);

    expect(result.ok).toBe(true);

    // Verify DB state
    const rows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.id, patientId));
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('active');
    expect(rows[0]!.archivedAt).toBeNull();
  });

  it('returns not_archived when patient is already active', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const result = await unarchivePatientImpl(client, patientId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_archived');
  });

  it('returns not_found for patient owned by another user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId, { status: 'archived', archivedAt: new Date() });

    const client = fakeSupabaseClient(userB);
    const result = await unarchivePatientImpl(client, patientId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('returns not_found for non-existent patient', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const client = fakeSupabaseClient(userId);
    const result = await unarchivePatientImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await unarchivePatientImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });
});

// ---------------------------------------------------------------------------
// deletePatientImpl
// ---------------------------------------------------------------------------

describe('deletePatientImpl', () => {
  it('deletes a patient with no related records', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const result = await deletePatientImpl(client, patientId);

    expect(result.ok).toBe(true);

    // Verify patient is gone from DB
    const rows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.id, patientId));
    });
    expect(rows).toHaveLength(0);
  });

  it('returns not_found for patient owned by another user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    const client = fakeSupabaseClient(userB);
    const result = await deletePatientImpl(client, patientId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');

    // Verify patient still exists
    const rows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.id, patientId));
    });
    expect(rows).toHaveLength(1);
  });

  it('returns not_found for non-existent patient', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const client = fakeSupabaseClient(userId);
    const result = await deletePatientImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await deletePatientImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });

  // NOTE: The `has_related_records` error case cannot be fully tested yet
  // because sessions, anamnesis, and consent_terms tables do not exist in the
  // current schema. The `hasRelatedRecords` function currently always returns
  // false. When those tables are added in future changes, add an integration
  // test that inserts related records and verifies deletion is blocked with
  // the `has_related_records` error code and a message suggesting archiving.
  it.todo(
    'returns has_related_records when patient has sessions/anamnesis/consent (future tables)',
  );
});
