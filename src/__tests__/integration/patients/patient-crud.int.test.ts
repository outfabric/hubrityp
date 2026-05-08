import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { createPatientImpl } from '@/modules/patients/server/create-patient';
import { getPatientImpl } from '@/modules/patients/server/get-patient';
import { updatePatientImpl } from '@/modules/patients/server/update-patient';
import { patients } from '@/shared/db/schema/patients/tables';

import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a row in `auth.users` so the FK constraint on `patients.user_id` is
 * satisfied. Same pattern as `patient-schema.int.test.ts`.
 */
async function seedAuthUser(userId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${userId}, ${`test-${userId}@example.com`}, '{"provider":"google"}'::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

/**
 * Build a minimal fake Supabase client that returns a specific user for
 * `auth.getUser()`. This isolates the server action logic from the real
 * Supabase Auth service (which requires GoTrue running).
 */
function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- fake implementation returns a static value
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as Parameters<typeof createPatientImpl>[0];
}

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// createPatientImpl
// ---------------------------------------------------------------------------

describe('createPatientImpl', () => {
  it('creates a patient successfully with minimal fields', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await createPatientImpl(client, {
      fullName: 'Maria Silva',
      patientType: 'individual',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patientId).toBeDefined();
    expect(typeof result.patientId).toBe('string');

    // Verify row in DB
    const rows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.id, result.patientId));
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fullName).toBe('Maria Silva');
    expect(rows[0]!.patientType).toBe('individual');
    expect(rows[0]!.userId).toBe(userId);
    expect(rows[0]!.status).toBe('active');
  });

  it('creates a patient with all optional fields', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await createPatientImpl(client, {
      fullName: 'João Santos',
      patientType: 'couple',
      phone: '+55 11 91234-5678',
      email: 'joao@example.com',
      cpf: '529.982.247-25',
      gender: 'male',
      profession: 'Engenheiro',
      maritalStatus: 'married',
      source: 'indication',
      tags: ['ansiedade', 'tcc'],
      notes: 'Paciente encaminhado',
      partner: { fullName: 'Maria Santos' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.id, result.patientId));
    });
    expect(rows[0]!.phone).toBe('+55 11 91234-5678');
    expect(rows[0]!.email).toBe('joao@example.com');
    expect(rows[0]!.tags).toEqual(['ansiedade', 'tcc']);
  });

  it('returns duplicate_phone when phone already exists for same user', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    // Create first patient with a phone
    const first = await createPatientImpl(client, {
      fullName: 'Paciente 1',
      patientType: 'individual',
      phone: '+55 11 91234-5678',
    });
    expect(first.ok).toBe(true);

    // Attempt to create second patient with same phone
    const second = await createPatientImpl(client, {
      fullName: 'Paciente 2',
      patientType: 'individual',
      phone: '+55 11 91234-5678',
    });

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toBe('duplicate_phone');
    if (second.error !== 'duplicate_phone') return;
    expect(second.message).toBe('Já existe um paciente com este telefone.');
  });

  it('returns duplicate_email when email already exists for same user', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    // Create first patient with an email
    await createPatientImpl(client, {
      fullName: 'Paciente 1',
      patientType: 'individual',
      email: 'duplicate@example.com',
    });

    // Attempt to create second patient with same email
    const second = await createPatientImpl(client, {
      fullName: 'Paciente 2',
      patientType: 'individual',
      email: 'duplicate@example.com',
    });

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toBe('duplicate_email');
    if (second.error !== 'duplicate_email') return;
    expect(second.message).toBe('Já existe um paciente com este email.');
  });

  it('allows same phone for different users', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    const resultA = await createPatientImpl(fakeSupabaseClient(userA), {
      fullName: 'Paciente de A',
      patientType: 'individual',
      phone: '+55 11 91234-5678',
    });
    expect(resultA.ok).toBe(true);

    const resultB = await createPatientImpl(fakeSupabaseClient(userB), {
      fullName: 'Paciente de B',
      patientType: 'individual',
      phone: '+55 11 91234-5678',
    });
    expect(resultB.ok).toBe(true);
  });

  it('returns invalid_input for missing required fields', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await createPatientImpl(client, {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_input');
    if (result.error !== 'invalid_input') return;
    expect(result.fieldErrors).toHaveProperty('fullName');
    expect(result.fieldErrors).toHaveProperty('patientType');
  });

  it('returns invalid_input for invalid phone format', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await createPatientImpl(client, {
      fullName: 'Test',
      patientType: 'individual',
      phone: '123',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_input');
    if (result.error !== 'invalid_input') return;
    expect(result.fieldErrors).toHaveProperty('phone');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);

    const result = await createPatientImpl(client, {
      fullName: 'Test',
      patientType: 'individual',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });

  it('rejects non-canonical phone format via validation', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    // Non-canonical phone format is rejected by Zod schema before any DB check
    const result = await createPatientImpl(client, {
      fullName: 'Paciente 1',
      patientType: 'individual',
      phone: '5511912345678',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_input');
    if (result.error !== 'invalid_input') return;
    expect(result.fieldErrors).toHaveProperty('phone');
  });

  it('allows patients with empty/omitted phone (no false duplicate)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    // Create two patients without phone — no duplicate conflict
    const first = await createPatientImpl(client, {
      fullName: 'Paciente 1',
      patientType: 'individual',
    });
    expect(first.ok).toBe(true);

    const second = await createPatientImpl(client, {
      fullName: 'Paciente 2',
      patientType: 'individual',
    });
    expect(second.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getPatientImpl
// ---------------------------------------------------------------------------

describe('getPatientImpl', () => {
  it('returns patient data for owner', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);

    // Seed patient directly
    await runAsService(async (db) => {
      await db.insert(patients).values({
        id: patientId,
        userId,
        fullName: 'Maria Silva',
        patientType: 'individual',
        phone: '+55 11 91234-5678',
        status: 'active',
      });
    });

    const client = fakeSupabaseClient(userId);
    const result = await getPatientImpl(client, patientId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patient.id).toBe(patientId);
    expect(result.patient.fullName).toBe('Maria Silva');
    expect(result.patient.phone).toBe('+55 11 91234-5678');
  });

  it('returns not_found for patient owned by another user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    await runAsService(async (db) => {
      await db.insert(patients).values({
        id: patientId,
        userId: userA,
        fullName: 'Paciente de A',
      });
    });

    // User B tries to get User A's patient
    const client = fakeSupabaseClient(userB);
    const result = await getPatientImpl(client, patientId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('returns not_found for non-existent patient', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await getPatientImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await getPatientImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });
});

// ---------------------------------------------------------------------------
// updatePatientImpl
// ---------------------------------------------------------------------------

describe('updatePatientImpl', () => {
  it('updates patient fields successfully', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(patients).values({
        id: patientId,
        userId,
        fullName: 'Original Name',
        patientType: 'individual',
        status: 'active',
      });
    });

    const client = fakeSupabaseClient(userId);
    const result = await updatePatientImpl(client, patientId, {
      fullName: 'Updated Name',
      phone: '+55 11 99876-5432',
    });

    expect(result.ok).toBe(true);

    // Verify DB
    const rows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.id, patientId));
    });
    expect(rows[0]!.fullName).toBe('Updated Name');
    expect(rows[0]!.phone).toBe('+55 11 99876-5432');
  });

  it('sets updated_at to current time on update', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);

    const beforeInsert = new Date();
    await runAsService(async (db) => {
      await db.insert(patients).values({
        id: patientId,
        userId,
        fullName: 'Test',
        patientType: 'individual',
      });
    });

    // Small delay to ensure updated_at differs
    await new Promise((r) => setTimeout(r, 50));

    const client = fakeSupabaseClient(userId);
    await updatePatientImpl(client, patientId, { fullName: 'Updated' });

    const rows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.id, patientId));
    });
    const updatedAt = rows[0]!.updatedAt;
    expect(updatedAt.getTime()).toBeGreaterThan(beforeInsert.getTime());
  });

  it('returns duplicate_phone when updating to a phone already used by another patient of same user', async () => {
    const userId = randomUUID();
    const patientA = randomUUID();
    const patientB = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(patients).values([
        {
          id: patientA,
          userId,
          fullName: 'Patient A',
          phone: '+55 11 91234-5678',
        },
        {
          id: patientB,
          userId,
          fullName: 'Patient B',
          phone: '+55 11 99876-5432',
        },
      ]);
    });

    const client = fakeSupabaseClient(userId);
    const result = await updatePatientImpl(client, patientB, {
      phone: '+55 11 91234-5678',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('duplicate_phone');
    if (result.error !== 'duplicate_phone') return;
    expect(result.message).toBe('Já existe um paciente com este telefone.');
  });

  it('returns duplicate_email when updating to an email already used by another patient of same user', async () => {
    const userId = randomUUID();
    const patientA = randomUUID();
    const patientB = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(patients).values([
        {
          id: patientA,
          userId,
          fullName: 'Patient A',
          email: 'taken@example.com',
        },
        {
          id: patientB,
          userId,
          fullName: 'Patient B',
          email: 'free@example.com',
        },
      ]);
    });

    const client = fakeSupabaseClient(userId);
    const result = await updatePatientImpl(client, patientB, {
      email: 'taken@example.com',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('duplicate_email');
    if (result.error !== 'duplicate_email') return;
    expect(result.message).toBe('Já existe um paciente com este email.');
  });

  it('allows updating patient to keep its own phone (no false duplicate)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(patients).values({
        id: patientId,
        userId,
        fullName: 'Test',
        phone: '+55 11 91234-5678',
      });
    });

    const client = fakeSupabaseClient(userId);
    const result = await updatePatientImpl(client, patientId, {
      fullName: 'Updated Name',
      phone: '+55 11 91234-5678',
    });

    // Should succeed — keeping the same phone is not a duplicate
    expect(result.ok).toBe(true);
  });

  it('returns not_found for patient owned by another user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    await runAsService(async (db) => {
      await db.insert(patients).values({
        id: patientId,
        userId: userA,
        fullName: 'Patient of A',
      });
    });

    // User B tries to update User A's patient
    const client = fakeSupabaseClient(userB);
    const result = await updatePatientImpl(client, patientId, {
      fullName: 'Hijacked',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');

    // Verify original is unchanged
    const rows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.id, patientId));
    });
    expect(rows[0]!.fullName).toBe('Patient of A');
  });

  it('returns not_found for non-existent patient', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await updatePatientImpl(client, randomUUID(), {
      fullName: 'Ghost',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_found');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await updatePatientImpl(client, randomUUID(), {
      fullName: 'Test',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });

  it('returns invalid_input for invalid field values', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    // patientType must be one of the valid enum values
    const result = await updatePatientImpl(client, randomUUID(), {
      patientType: 'invalid_type' as never,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_input');
  });
});
