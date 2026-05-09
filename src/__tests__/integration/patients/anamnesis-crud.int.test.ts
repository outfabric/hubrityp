import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { getAnamnesisImpl } from '@/modules/patients/server/get-anamnesis';
import { upsertAnamnesisImpl } from '@/modules/patients/server/upsert-anamnesis';
import { anamnesis, patients } from '@/shared/db/schema/patients/tables';

import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a row in `auth.users` so the FK constraint on `patients.user_id` is
 * satisfied. Same pattern as other integration tests.
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
 * Create a patient owned by `userId` and return its id.
 */
async function seedPatient(userId: string, patientId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Test Patient',
    });
  });
}

/**
 * Build a minimal fake Supabase client that returns a specific user for
 * `auth.getUser()`. Isolates the server action logic from GoTrue.
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
  } as Parameters<typeof getAnamnesisImpl>[0];
}

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(anamnesis);
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// getAnamnesisImpl
// ---------------------------------------------------------------------------

describe('getAnamnesisImpl', () => {
  it('returns null anamnesis when patient exists but has no anamnesis', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const result = await getAnamnesisImpl(client, patientId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.anamnesis).toBeNull();
  });

  it('returns anamnesis data when it exists', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const anamnesisId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Seed anamnesis directly
    await runAsService(async (db) => {
      await db.insert(anamnesis).values({
        id: anamnesisId,
        patientId,
        chiefComplaint: 'Ansiedade generalizada',
        historyPresentIllness: 'Sintomas há 6 meses',
        familyHistory: 'Depressão na família',
        treatmentPlan: 'TCC semanal',
        customSections: [{ title: 'Sono', content: 'Insônia' }],
      });
    });

    const client = fakeSupabaseClient(userId);
    const result = await getAnamnesisImpl(client, patientId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.anamnesis).not.toBeNull();
    expect(result.anamnesis!.id).toBe(anamnesisId);
    expect(result.anamnesis!.chiefComplaint).toBe('Ansiedade generalizada');
    expect(result.anamnesis!.historyPresentIllness).toBe('Sintomas há 6 meses');
    expect(result.anamnesis!.familyHistory).toBe('Depressão na família');
    expect(result.anamnesis!.treatmentPlan).toBe('TCC semanal');
    expect(result.anamnesis!.customSections).toEqual([{ title: 'Sono', content: 'Insônia' }]);
  });

  it('returns patient_not_found for non-existent patient', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const client = fakeSupabaseClient(userId);
    const result = await getAnamnesisImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('patient_not_found');
  });

  it('returns patient_not_found for patient owned by another user (RLS)', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    // Seed anamnesis for userA's patient
    await runAsService(async (db) => {
      await db.insert(anamnesis).values({
        id: randomUUID(),
        patientId,
        chiefComplaint: 'Private data',
      });
    });

    // User B tries to access User A's patient's anamnesis
    const client = fakeSupabaseClient(userB);
    const result = await getAnamnesisImpl(client, patientId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('patient_not_found');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await getAnamnesisImpl(client, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });
});

// ---------------------------------------------------------------------------
// upsertAnamnesisImpl — CREATE path
// ---------------------------------------------------------------------------

describe('upsertAnamnesisImpl — create', () => {
  it('creates anamnesis with all sections', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const result = await upsertAnamnesisImpl(client, {
      patientId,
      chiefComplaint: 'Ansiedade',
      historyPresentIllness: 'Início há 6 meses',
      familyHistory: 'Mãe com depressão',
      educationalProfessional: 'Estudante',
      physicalHealth: 'Sem queixas',
      priorTherapy: 'Nunca fez terapia',
      initialHypothesis: 'TAG',
      treatmentPlan: 'TCC semanal',
      customSections: [
        { title: 'Sono', content: 'Insônia inicial' },
        { title: 'Rede de apoio', content: 'Família presente' },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.anamnesisId).toBeDefined();

    // Verify row in DB
    const rows = await runAsService(async (db) => {
      return db.select().from(anamnesis).where(eq(anamnesis.patientId, patientId));
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.chiefComplaint).toBe('Ansiedade');
    expect(rows[0]!.historyPresentIllness).toBe('Início há 6 meses');
    expect(rows[0]!.familyHistory).toBe('Mãe com depressão');
    expect(rows[0]!.educationalProfessional).toBe('Estudante');
    expect(rows[0]!.physicalHealth).toBe('Sem queixas');
    expect(rows[0]!.priorTherapy).toBe('Nunca fez terapia');
    expect(rows[0]!.initialHypothesis).toBe('TAG');
    expect(rows[0]!.treatmentPlan).toBe('TCC semanal');
    expect(rows[0]!.customSections).toEqual([
      { title: 'Sono', content: 'Insônia inicial' },
      { title: 'Rede de apoio', content: 'Família presente' },
    ]);
  });

  it('creates anamnesis with minimal (empty) sections', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);
    const result = await upsertAnamnesisImpl(client, {
      patientId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await runAsService(async (db) => {
      return db.select().from(anamnesis).where(eq(anamnesis.patientId, patientId));
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.chiefComplaint).toBeNull();
    expect(rows[0]!.treatmentPlan).toBeNull();
    expect(rows[0]!.customSections).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// upsertAnamnesisImpl — UPDATE path
// ---------------------------------------------------------------------------

describe('upsertAnamnesisImpl — update', () => {
  it('updates existing anamnesis on second upsert for same patient', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);

    // First upsert (creates)
    const first = await upsertAnamnesisImpl(client, {
      patientId,
      chiefComplaint: 'Ansiedade',
      treatmentPlan: 'TCC semanal',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const firstId = first.anamnesisId;

    // Second upsert (updates)
    const second = await upsertAnamnesisImpl(client, {
      patientId,
      chiefComplaint: 'Ansiedade atualizada',
      treatmentPlan: 'TCC quinzenal',
      familyHistory: 'Pai com ansiedade',
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // Same anamnesis ID (upsert, not a new row)
    expect(second.anamnesisId).toBe(firstId);

    // Verify updated values
    const rows = await runAsService(async (db) => {
      return db.select().from(anamnesis).where(eq(anamnesis.patientId, patientId));
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.chiefComplaint).toBe('Ansiedade atualizada');
    expect(rows[0]!.treatmentPlan).toBe('TCC quinzenal');
    expect(rows[0]!.familyHistory).toBe('Pai com ansiedade');
  });

  it('sets updated_at to current time on update', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);

    // First upsert
    await upsertAnamnesisImpl(client, {
      patientId,
      chiefComplaint: 'Original',
    });

    const beforeUpdate = await runAsService(async (db) => {
      return db.select().from(anamnesis).where(eq(anamnesis.patientId, patientId));
    });
    const firstUpdatedAt = beforeUpdate[0]!.updatedAt;

    // Small delay to ensure timestamps differ
    await new Promise((r) => setTimeout(r, 50));

    // Second upsert (update)
    await upsertAnamnesisImpl(client, {
      patientId,
      chiefComplaint: 'Updated',
    });

    const afterUpdate = await runAsService(async (db) => {
      return db.select().from(anamnesis).where(eq(anamnesis.patientId, patientId));
    });
    const secondUpdatedAt = afterUpdate[0]!.updatedAt;

    expect(secondUpdatedAt.getTime()).toBeGreaterThan(firstUpdatedAt.getTime());
  });

  it('can clear sections by passing null', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);

    // Create with data
    await upsertAnamnesisImpl(client, {
      patientId,
      chiefComplaint: 'Ansiedade',
      treatmentPlan: 'TCC',
    });

    // Update clearing fields
    await upsertAnamnesisImpl(client, {
      patientId,
      chiefComplaint: null,
      treatmentPlan: null,
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(anamnesis).where(eq(anamnesis.patientId, patientId));
    });
    expect(rows[0]!.chiefComplaint).toBeNull();
    expect(rows[0]!.treatmentPlan).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// upsertAnamnesisImpl — authorization / RLS
// ---------------------------------------------------------------------------

describe('upsertAnamnesisImpl — authorization', () => {
  it('returns patient_not_found for patient owned by another user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    // User B tries to upsert anamnesis for User A's patient
    const client = fakeSupabaseClient(userB);
    const result = await upsertAnamnesisImpl(client, {
      patientId,
      chiefComplaint: 'Hijack attempt',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('patient_not_found');

    // Verify no anamnesis was created
    const rows = await runAsService(async (db) => {
      return db.select().from(anamnesis).where(eq(anamnesis.patientId, patientId));
    });
    expect(rows).toHaveLength(0);
  });

  it('returns patient_not_found for non-existent patient', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const client = fakeSupabaseClient(userId);
    const result = await upsertAnamnesisImpl(client, {
      patientId: randomUUID(),
      chiefComplaint: 'Orphan',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('patient_not_found');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await upsertAnamnesisImpl(client, {
      patientId: randomUUID(),
      chiefComplaint: 'Test',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });

  it('returns invalid_input for missing patientId', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const client = fakeSupabaseClient(userId);
    const result = await upsertAnamnesisImpl(client, {
      chiefComplaint: 'Missing patient',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_input');
    if (result.error !== 'invalid_input') return;
    expect(result.fieldErrors).toHaveProperty('patientId');
  });

  it('returns invalid_input for non-UUID patientId', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const client = fakeSupabaseClient(userId);
    const result = await upsertAnamnesisImpl(client, {
      patientId: 'not-a-uuid',
      chiefComplaint: 'Invalid ID',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_input');
    if (result.error !== 'invalid_input') return;
    expect(result.fieldErrors).toHaveProperty('patientId');
  });
});

// ---------------------------------------------------------------------------
// upsertAnamnesisImpl — data persistence correctness
// ---------------------------------------------------------------------------

describe('upsertAnamnesisImpl — data persistence', () => {
  it('persists customSections as JSONB correctly', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const customSections = [
      { title: 'Hábitos de sono', content: 'Dorme 5h por noite, insônia inicial' },
      { title: 'Rede de apoio', content: 'Família distante, amigos próximos' },
      { title: 'Uso de substâncias', content: 'Não faz uso' },
    ];

    const client = fakeSupabaseClient(userId);
    await upsertAnamnesisImpl(client, {
      patientId,
      customSections,
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(anamnesis).where(eq(anamnesis.patientId, patientId));
    });
    expect(rows[0]!.customSections).toEqual(customSections);
  });

  it('round-trips data through upsert then get', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const client = fakeSupabaseClient(userId);

    const inputData = {
      patientId,
      chiefComplaint: 'Depressão',
      historyPresentIllness: 'Início há 1 ano',
      familyHistory: 'Avó com bipolaridade',
      educationalProfessional: 'Professor',
      physicalHealth: 'Cefaleia frequente',
      priorTherapy: 'Psicanalítica por 2 anos',
      initialHypothesis: 'Episódio depressivo moderado',
      treatmentPlan: 'TCC + encaminhamento psiquiátrico',
      customSections: [{ title: 'Medicação', content: 'Fluoxetina 20mg' }],
    };

    await upsertAnamnesisImpl(client, inputData);

    const result = await getAnamnesisImpl(client, patientId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.anamnesis).not.toBeNull();
    const a = result.anamnesis!;
    expect(a.chiefComplaint).toBe(inputData.chiefComplaint);
    expect(a.historyPresentIllness).toBe(inputData.historyPresentIllness);
    expect(a.familyHistory).toBe(inputData.familyHistory);
    expect(a.educationalProfessional).toBe(inputData.educationalProfessional);
    expect(a.physicalHealth).toBe(inputData.physicalHealth);
    expect(a.priorTherapy).toBe(inputData.priorTherapy);
    expect(a.initialHypothesis).toBe(inputData.initialHypothesis);
    expect(a.treatmentPlan).toBe(inputData.treatmentPlan);
    expect(a.customSections).toEqual(inputData.customSections);
  });
});
