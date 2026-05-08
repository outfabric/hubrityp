import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { addGuardianImpl } from '@/modules/patients/server/add-guardian';
import { listGuardiansImpl } from '@/modules/patients/server/list-guardians';
import { removeGuardianImpl } from '@/modules/patients/server/remove-guardian';
import { updateGuardianImpl } from '@/modules/patients/server/update-guardian';
import { patientGuardians, patients } from '@/shared/db/schema/patients/tables';

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
  } as Parameters<typeof addGuardianImpl>[0];
}

/** Seed a minor patient (child) for the given user. */
async function seedMinorPatient(userId: string, patientId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Criança Teste',
      patientType: 'child',
      status: 'active',
    });
  });
}

/** Seed an adult patient for the given user. */
async function seedAdultPatient(userId: string, patientId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Adulto Teste',
      patientType: 'individual',
      status: 'active',
    });
  });
}

const VALID_GUARDIAN_INPUT = {
  fullName: 'Maria Responsável',
  relationship: 'Mãe',
  phone: '+55 11 91234-5678',
};

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(patientGuardians);
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// addGuardianImpl
// ---------------------------------------------------------------------------

describe('addGuardianImpl', () => {
  it('creates a guardian successfully for a minor patient', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedMinorPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const result = await addGuardianImpl(client, patientId, VALID_GUARDIAN_INPUT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.guardianId).toBeDefined();
    expect(typeof result.guardianId).toBe('string');

    // Verify row in DB
    const rows = await runAsService(async (db) => {
      return db.select().from(patientGuardians).where(eq(patientGuardians.id, result.guardianId));
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fullName).toBe('Maria Responsável');
    expect(rows[0]!.relationship).toBe('Mãe');
    expect(rows[0]!.phone).toBe('+55 11 91234-5678');
    expect(rows[0]!.patientId).toBe(patientId);
  });

  it('auto-sets is_primary=true for the first guardian', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedMinorPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const result = await addGuardianImpl(client, patientId, {
      ...VALID_GUARDIAN_INPUT,
      isPrimary: false, // explicitly false, but should be overridden
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await runAsService(async (db) => {
      return db.select().from(patientGuardians).where(eq(patientGuardians.id, result.guardianId));
    });
    expect(rows[0]!.isPrimary).toBe(true);
  });

  it('allows a second guardian (not auto-primary)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedMinorPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);

    // First guardian
    const first = await addGuardianImpl(client, patientId, VALID_GUARDIAN_INPUT);
    expect(first.ok).toBe(true);

    // Second guardian
    const second = await addGuardianImpl(client, patientId, {
      fullName: 'João Pai',
      relationship: 'Pai',
      phone: '+55 21 99876-5432',
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const rows = await runAsService(async (db) => {
      return db.select().from(patientGuardians).where(eq(patientGuardians.id, second.guardianId));
    });
    // Second guardian should NOT be auto-primary
    expect(rows[0]!.isPrimary).toBe(false);
  });

  it('rejects a third guardian (limit of 2)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedMinorPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);

    // Add two guardians
    await addGuardianImpl(client, patientId, VALID_GUARDIAN_INPUT);
    await addGuardianImpl(client, patientId, {
      fullName: 'João Pai',
      relationship: 'Pai',
      phone: '+55 21 99876-5432',
    });

    // Third should be rejected
    const third = await addGuardianImpl(client, patientId, {
      fullName: 'Avó Teste',
      relationship: 'Avó',
      phone: '+55 31 98765-4321',
    });

    expect(third.ok).toBe(false);
    if (third.ok) return;
    expect(third.error).toBe('limit_reached');
  });

  it('rejects guardian for non-minor patient', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedAdultPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const result = await addGuardianImpl(client, patientId, VALID_GUARDIAN_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_minor_patient');
  });

  it('returns patient_not_found for non-existent patient', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const client = fakeSupabaseClient(userId);
    const result = await addGuardianImpl(client, randomUUID(), VALID_GUARDIAN_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('patient_not_found');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await addGuardianImpl(client, randomUUID(), VALID_GUARDIAN_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });

  it('returns validation_error for invalid input', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const client = fakeSupabaseClient(userId);
    const result = await addGuardianImpl(client, randomUUID(), {
      fullName: '', // too short
      relationship: '',
      phone: 'invalid',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('validation_error');
  });

  it('works with adolescent patient type', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);

    // Seed adolescent patient
    await runAsService(async (db) => {
      await db.insert(patients).values({
        id: patientId,
        userId,
        fullName: 'Adolescente Teste',
        patientType: 'adolescent',
        status: 'active',
      });
    });

    const client = fakeSupabaseClient(userId);
    const result = await addGuardianImpl(client, patientId, VALID_GUARDIAN_INPUT);

    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// updateGuardianImpl
// ---------------------------------------------------------------------------

describe('updateGuardianImpl', () => {
  it('updates guardian fields successfully', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedMinorPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const addResult = await addGuardianImpl(client, patientId, VALID_GUARDIAN_INPUT);
    expect(addResult.ok).toBe(true);
    if (!addResult.ok) return;

    const updateResult = await updateGuardianImpl(client, addResult.guardianId, {
      fullName: 'Maria Atualizada',
      relationship: 'Madrasta',
    });
    expect(updateResult.ok).toBe(true);

    // Verify DB
    const rows = await runAsService(async (db) => {
      return db
        .select()
        .from(patientGuardians)
        .where(eq(patientGuardians.id, addResult.guardianId));
    });
    expect(rows[0]!.fullName).toBe('Maria Atualizada');
    expect(rows[0]!.relationship).toBe('Madrasta');
    // Phone should remain unchanged
    expect(rows[0]!.phone).toBe('+55 11 91234-5678');
  });

  it('returns not_found for non-existent guardian', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const client = fakeSupabaseClient(userId);
    const result = await updateGuardianImpl(client, randomUUID(), {
      fullName: 'Ghost',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('returns not_found when guardian belongs to another user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedMinorPatient(userA, patientId);

    // Create guardian as user A
    const clientA = fakeSupabaseClient(userA);
    const addResult = await addGuardianImpl(clientA, patientId, VALID_GUARDIAN_INPUT);
    expect(addResult.ok).toBe(true);
    if (!addResult.ok) return;

    // User B tries to update
    const clientB = fakeSupabaseClient(userB);
    const updateResult = await updateGuardianImpl(clientB, addResult.guardianId, {
      fullName: 'Hijacked',
    });

    expect(updateResult.ok).toBe(false);
    if (updateResult.ok) return;
    expect(updateResult.error).toBe('not_found');

    // Verify original is unchanged
    const rows = await runAsService(async (db) => {
      return db
        .select()
        .from(patientGuardians)
        .where(eq(patientGuardians.id, addResult.guardianId));
    });
    expect(rows[0]!.fullName).toBe('Maria Responsável');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await updateGuardianImpl(client, randomUUID(), {
      fullName: 'Test',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });

  it('succeeds with empty payload (idempotent)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedMinorPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const addResult = await addGuardianImpl(client, patientId, VALID_GUARDIAN_INPUT);
    expect(addResult.ok).toBe(true);
    if (!addResult.ok) return;

    const updateResult = await updateGuardianImpl(client, addResult.guardianId, {});
    expect(updateResult.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// removeGuardianImpl
// ---------------------------------------------------------------------------

describe('removeGuardianImpl', () => {
  it('removes a guardian successfully', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedMinorPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const addResult = await addGuardianImpl(client, patientId, VALID_GUARDIAN_INPUT);
    expect(addResult.ok).toBe(true);
    if (!addResult.ok) return;

    const removeResult = await removeGuardianImpl(client, addResult.guardianId);
    expect(removeResult.ok).toBe(true);

    // Verify row is gone
    const rows = await runAsService(async (db) => {
      return db
        .select()
        .from(patientGuardians)
        .where(eq(patientGuardians.id, addResult.guardianId));
    });
    expect(rows).toHaveLength(0);
  });

  it('returns warning when removing the sole guardian', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedMinorPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const addResult = await addGuardianImpl(client, patientId, VALID_GUARDIAN_INPUT);
    expect(addResult.ok).toBe(true);
    if (!addResult.ok) return;

    const removeResult = await removeGuardianImpl(client, addResult.guardianId);
    expect(removeResult.ok).toBe(true);
    if (!removeResult.ok) return;
    expect(removeResult.warning).toBe('Este paciente menor está sem responsável cadastrado.');
  });

  it('promotes remaining guardian to primary when primary is removed', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedMinorPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);

    // Add two guardians — first one is auto-primary
    const first = await addGuardianImpl(client, patientId, VALID_GUARDIAN_INPUT);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await addGuardianImpl(client, patientId, {
      fullName: 'João Pai',
      relationship: 'Pai',
      phone: '+55 21 99876-5432',
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // Verify first is primary, second is not
    const beforeRows = await runAsService(async (db) => {
      return db.select().from(patientGuardians).where(eq(patientGuardians.patientId, patientId));
    });
    const firstBefore = beforeRows.find((r) => r.id === first.guardianId);
    const secondBefore = beforeRows.find((r) => r.id === second.guardianId);
    expect(firstBefore!.isPrimary).toBe(true);
    expect(secondBefore!.isPrimary).toBe(false);

    // Remove the primary guardian
    const removeResult = await removeGuardianImpl(client, first.guardianId);
    expect(removeResult.ok).toBe(true);
    if (!removeResult.ok) return;
    // No warning — one guardian still remains
    expect(removeResult.warning).toBeUndefined();

    // Verify the remaining guardian was promoted to primary
    const afterRows = await runAsService(async (db) => {
      return db.select().from(patientGuardians).where(eq(patientGuardians.id, second.guardianId));
    });
    expect(afterRows).toHaveLength(1);
    expect(afterRows[0]!.isPrimary).toBe(true);
  });

  it('does not promote when removing a non-primary guardian', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedMinorPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);

    const first = await addGuardianImpl(client, patientId, VALID_GUARDIAN_INPUT);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await addGuardianImpl(client, patientId, {
      fullName: 'João Pai',
      relationship: 'Pai',
      phone: '+55 21 99876-5432',
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // Remove the non-primary guardian (second)
    const removeResult = await removeGuardianImpl(client, second.guardianId);
    expect(removeResult.ok).toBe(true);

    // First guardian should still be primary and unchanged
    const rows = await runAsService(async (db) => {
      return db.select().from(patientGuardians).where(eq(patientGuardians.id, first.guardianId));
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.isPrimary).toBe(true);
  });

  it('returns not_found for non-existent guardian', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const client = fakeSupabaseClient(userId);
    const result = await removeGuardianImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await removeGuardianImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });
});

// ---------------------------------------------------------------------------
// listGuardiansImpl
// ---------------------------------------------------------------------------

describe('listGuardiansImpl', () => {
  it('lists all guardians for a patient', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedMinorPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);

    await addGuardianImpl(client, patientId, VALID_GUARDIAN_INPUT);
    await addGuardianImpl(client, patientId, {
      fullName: 'João Pai',
      relationship: 'Pai',
      phone: '+55 21 99876-5432',
    });

    const result = await listGuardiansImpl(client, patientId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.guardians).toHaveLength(2);
  });

  it('returns empty array when patient has no guardians', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedMinorPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const result = await listGuardiansImpl(client, patientId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.guardians).toHaveLength(0);
  });

  it('returns patient_not_found for non-existent patient', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const client = fakeSupabaseClient(userId);
    const result = await listGuardiansImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('patient_not_found');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await listGuardiansImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });
});

// ---------------------------------------------------------------------------
// RLS isolation (cross-user)
// ---------------------------------------------------------------------------

describe('RLS: cross-user isolation', () => {
  it('user B cannot see guardians of user A via listGuardiansImpl', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedMinorPatient(userA, patientId);

    // User A adds a guardian
    const clientA = fakeSupabaseClient(userA);
    await addGuardianImpl(clientA, patientId, VALID_GUARDIAN_INPUT);

    // User B tries to list
    const clientB = fakeSupabaseClient(userB);
    const result = await listGuardiansImpl(clientB, patientId);

    // Should not find the patient at all (ownership check on patient)
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('patient_not_found');
  });

  it('user B cannot add guardian to user A patient', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedMinorPatient(userA, patientId);

    const clientB = fakeSupabaseClient(userB);
    const result = await addGuardianImpl(clientB, patientId, VALID_GUARDIAN_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('patient_not_found');
  });

  it('user B cannot remove guardian from user A patient', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedMinorPatient(userA, patientId);

    // User A adds a guardian
    const clientA = fakeSupabaseClient(userA);
    const addResult = await addGuardianImpl(clientA, patientId, VALID_GUARDIAN_INPUT);
    expect(addResult.ok).toBe(true);
    if (!addResult.ok) return;

    // User B tries to remove
    const clientB = fakeSupabaseClient(userB);
    const removeResult = await removeGuardianImpl(clientB, addResult.guardianId);

    expect(removeResult.ok).toBe(false);
    if (removeResult.ok) return;
    expect(removeResult.error).toBe('not_found');

    // Verify guardian is still there
    const rows = await runAsService(async (db) => {
      return db
        .select()
        .from(patientGuardians)
        .where(eq(patientGuardians.id, addResult.guardianId));
    });
    expect(rows).toHaveLength(1);
  });

  it('user B cannot update guardian from user A patient', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedMinorPatient(userA, patientId);

    // User A adds a guardian
    const clientA = fakeSupabaseClient(userA);
    const addResult = await addGuardianImpl(clientA, patientId, VALID_GUARDIAN_INPUT);
    expect(addResult.ok).toBe(true);
    if (!addResult.ok) return;

    // User B tries to update
    const clientB = fakeSupabaseClient(userB);
    const updateResult = await updateGuardianImpl(clientB, addResult.guardianId, {
      fullName: 'Hijacked',
    });

    expect(updateResult.ok).toBe(false);
    if (updateResult.ok) return;
    expect(updateResult.error).toBe('not_found');

    // Verify guardian is unchanged
    const rows = await runAsService(async (db) => {
      return db
        .select()
        .from(patientGuardians)
        .where(eq(patientGuardians.id, addResult.guardianId));
    });
    expect(rows[0]!.fullName).toBe('Maria Responsável');
  });
});
