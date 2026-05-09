import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { anamnesis } from '@/shared/db/schema/patients/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

// Helper: create a row in `auth.users` so FK constraints are satisfied.
async function seedAuthUser(userId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${userId}, ${`test-${userId}@example.com`}, '{"provider":"google"}'::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

// Helper: create a patient owned by `userId` and return its id.
async function seedPatient(userId: string, patientId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Test Patient',
    });
  });
}

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(anamnesis);
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

describe('anamnesis table — schema verification', () => {
  it('table anamnesis exists', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'anamnesis'`,
      );
    });

    expect(result).toHaveLength(1);
  });

  it('has all expected columns with correct types', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT column_name, data_type, is_nullable
             FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'anamnesis'
             ORDER BY ordinal_position`,
      );
    });

    const columns = result.map((r) => ({
      name: r.column_name as string,
      type: r.data_type as string,
      nullable: r.is_nullable as string,
    }));

    expect(columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'id', type: 'uuid', nullable: 'NO' }),
        expect.objectContaining({ name: 'patient_id', type: 'uuid', nullable: 'NO' }),
        expect.objectContaining({ name: 'chief_complaint', type: 'text', nullable: 'YES' }),
        expect.objectContaining({
          name: 'history_present_illness',
          type: 'text',
          nullable: 'YES',
        }),
        expect.objectContaining({ name: 'family_history', type: 'text', nullable: 'YES' }),
        expect.objectContaining({
          name: 'educational_professional',
          type: 'text',
          nullable: 'YES',
        }),
        expect.objectContaining({ name: 'physical_health', type: 'text', nullable: 'YES' }),
        expect.objectContaining({ name: 'prior_therapy', type: 'text', nullable: 'YES' }),
        expect.objectContaining({ name: 'initial_hypothesis', type: 'text', nullable: 'YES' }),
        expect.objectContaining({ name: 'treatment_plan', type: 'text', nullable: 'YES' }),
        expect.objectContaining({ name: 'custom_sections', type: 'jsonb', nullable: 'YES' }),
        expect.objectContaining({
          name: 'created_at',
          type: 'timestamp with time zone',
          nullable: 'NO',
        }),
        expect.objectContaining({
          name: 'updated_at',
          type: 'timestamp with time zone',
          nullable: 'NO',
        }),
      ]),
    );

    expect(columns).toHaveLength(13);
  });

  it('accepts inserts via service role', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const anamnesisId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await runAsService(async (db) => {
      await db.insert(anamnesis).values({
        id: anamnesisId,
        patientId,
        chiefComplaint: 'Ansiedade generalizada',
        historyPresentIllness: 'Paciente relata sintomas há 6 meses',
        familyHistory: 'Histórico de depressão na família',
        educationalProfessional: 'Estudante universitário',
        physicalHealth: 'Sem queixas físicas relevantes',
        priorTherapy: 'Nunca realizou terapia anteriormente',
        initialHypothesis: 'TAG — Transtorno de Ansiedade Generalizada',
        treatmentPlan: 'TCC semanal, 12 sessões iniciais',
        customSections: [
          { title: 'Hábitos de sono', content: 'Insônia inicial' },
          { title: 'Rede de apoio', content: 'Família presente' },
        ],
      });
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(anamnesis).where(eq(anamnesis.id, anamnesisId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.chiefComplaint).toBe('Ansiedade generalizada');
    expect(rows[0]!.treatmentPlan).toBe('TCC semanal, 12 sessões iniciais');
    expect(rows[0]!.customSections).toEqual([
      { title: 'Hábitos de sono', content: 'Insônia inicial' },
      { title: 'Rede de apoio', content: 'Família presente' },
    ]);
    expect(rows[0]!.createdAt).toBeInstanceOf(Date);
    expect(rows[0]!.updatedAt).toBeInstanceOf(Date);
  });
});

describe('anamnesis table — UNIQUE constraint on patient_id', () => {
  it('enforces 1:1 relationship — second insert for same patient fails', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await runAsService(async (db) => {
      await db.insert(anamnesis).values({
        id: randomUUID(),
        patientId,
        chiefComplaint: 'First anamnesis',
      });
    });

    await expect(
      runAsService(async (db) => {
        await db.insert(anamnesis).values({
          id: randomUUID(),
          patientId,
          chiefComplaint: 'Duplicate anamnesis',
        });
      }),
    ).rejects.toThrow();
  });
});

describe('anamnesis table — FK cascade', () => {
  it('deleting a patient cascades to its anamnesis', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await runAsService(async (db) => {
      await db.insert(anamnesis).values({
        id: randomUUID(),
        patientId,
        chiefComplaint: 'Will be cascaded',
      });
    });

    // Verify anamnesis exists before deletion
    const before = await runAsService(async (db) => {
      return db.select().from(anamnesis).where(eq(anamnesis.patientId, patientId));
    });
    expect(before).toHaveLength(1);

    // Delete the parent patient
    await runAsService(async (db) => {
      await db.delete(patients).where(eq(patients.id, patientId));
    });

    // Anamnesis should be gone
    const after = await runAsService(async (db) => {
      return db.select().from(anamnesis).where(eq(anamnesis.patientId, patientId));
    });
    expect(after).toHaveLength(0);
  });

  it('rejects insert with non-existent patient_id', async () => {
    const fakePatientId = randomUUID();

    await expect(
      runAsService(async (db) => {
        await db.insert(anamnesis).values({
          id: randomUUID(),
          patientId: fakePatientId,
          chiefComplaint: 'Orphan anamnesis',
        });
      }),
    ).rejects.toThrow();
  });
});

describe('anamnesis table — RLS policies', () => {
  it('RLS is enabled on anamnesis table', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(dsql`SELECT relrowsecurity FROM pg_class WHERE relname = 'anamnesis'`);
    });

    expect(result[0]!.relrowsecurity).toBe(true);
  });

  it('has all four owner-scoped policies', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname, polcmd FROM pg_policy
             WHERE polrelid = 'anamnesis'::regclass
             ORDER BY polname`,
      );
    });

    const policies = result.map((r) => ({
      name: r.polname as string,
      cmd: r.polcmd as string,
    }));

    expect(policies).toHaveLength(4);
    expect(policies.find((p) => p.cmd === 'r')).toBeDefined(); // SELECT
    expect(policies.find((p) => p.cmd === 'a')).toBeDefined(); // INSERT
    expect(policies.find((p) => p.cmd === 'w')).toBeDefined(); // UPDATE
    expect(policies.find((p) => p.cmd === 'd')).toBeDefined(); // DELETE
  });

  it('owner can read anamnesis of their own patients', async () => {
    const userA = randomUUID();
    const patientId = randomUUID();
    const anamnesisId = randomUUID();
    await seedAuthUser(userA);
    await seedPatient(userA, patientId);

    await runAsService(async (db) => {
      await db.insert(anamnesis).values({
        id: anamnesisId,
        patientId,
        chiefComplaint: 'Anamnesis of A',
      });
    });

    const rows = await runAsUser(userA, async (db) => {
      return db.select().from(anamnesis);
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(anamnesisId);
  });

  it("non-owner cannot read anamnesis of another user's patients", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    await runAsService(async (db) => {
      await db.insert(anamnesis).values({
        id: randomUUID(),
        patientId,
        chiefComplaint: 'Private anamnesis',
      });
    });

    const rows = await runAsUser(userB, async (db) => {
      return db.select().from(anamnesis);
    });

    expect(rows).toHaveLength(0);
  });

  it('owner can insert anamnesis for their own patients', async () => {
    const userA = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedPatient(userA, patientId);

    await runAsUser(userA, async (db) => {
      await db.insert(anamnesis).values({
        id: randomUUID(),
        patientId,
        chiefComplaint: 'New anamnesis',
      });
    });

    const rows = await runAsUser(userA, async (db) => {
      return db.select().from(anamnesis);
    });

    expect(rows).toHaveLength(1);
  });

  it("owner cannot insert anamnesis for another user's patients", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    await expect(
      runAsUser(userB, async (db) => {
        await db.insert(anamnesis).values({
          id: randomUUID(),
          patientId,
          chiefComplaint: 'Hijack attempt',
        });
      }),
    ).rejects.toThrow();
  });

  it('owner can update anamnesis of their own patients', async () => {
    const userA = randomUUID();
    const patientId = randomUUID();
    const anamnesisId = randomUUID();
    await seedAuthUser(userA);
    await seedPatient(userA, patientId);

    await runAsService(async (db) => {
      await db.insert(anamnesis).values({
        id: anamnesisId,
        patientId,
        chiefComplaint: 'Original complaint',
      });
    });

    await runAsUser(userA, async (db) => {
      await db
        .update(anamnesis)
        .set({ chiefComplaint: 'Updated complaint' })
        .where(eq(anamnesis.id, anamnesisId));
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(anamnesis).where(eq(anamnesis.id, anamnesisId));
    });

    expect(rows[0]!.chiefComplaint).toBe('Updated complaint');
  });

  it("non-owner cannot update anamnesis of another user's patients", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    const anamnesisId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    await runAsService(async (db) => {
      await db.insert(anamnesis).values({
        id: anamnesisId,
        patientId,
        chiefComplaint: 'Original complaint',
      });
    });

    // Won't throw — RLS silently filters, no rows matched
    await runAsUser(userB, async (db) => {
      await db
        .update(anamnesis)
        .set({ chiefComplaint: 'Hijacked complaint' })
        .where(eq(anamnesis.id, anamnesisId));
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(anamnesis).where(eq(anamnesis.id, anamnesisId));
    });

    expect(rows[0]!.chiefComplaint).toBe('Original complaint');
  });

  it('owner can delete anamnesis of their own patients', async () => {
    const userA = randomUUID();
    const patientId = randomUUID();
    const anamnesisId = randomUUID();
    await seedAuthUser(userA);
    await seedPatient(userA, patientId);

    await runAsService(async (db) => {
      await db.insert(anamnesis).values({
        id: anamnesisId,
        patientId,
        chiefComplaint: 'To be deleted',
      });
    });

    await runAsUser(userA, async (db) => {
      await db.delete(anamnesis).where(eq(anamnesis.id, anamnesisId));
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(anamnesis).where(eq(anamnesis.id, anamnesisId));
    });

    expect(rows).toHaveLength(0);
  });

  it("non-owner cannot delete anamnesis of another user's patients", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    const anamnesisId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    await runAsService(async (db) => {
      await db.insert(anamnesis).values({
        id: anamnesisId,
        patientId,
        chiefComplaint: 'Protected anamnesis',
      });
    });

    await runAsUser(userB, async (db) => {
      await db.delete(anamnesis).where(eq(anamnesis.id, anamnesisId));
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(anamnesis).where(eq(anamnesis.id, anamnesisId));
    });

    expect(rows).toHaveLength(1);
  });

  it('service-role connection bypasses RLS and sees all anamnesis records', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientA = randomUUID();
    const patientB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientA);
    await seedPatient(userB, patientB);

    await runAsService(async (db) => {
      await db.insert(anamnesis).values([
        { id: randomUUID(), patientId: patientA, chiefComplaint: 'Anamnesis A' },
        { id: randomUUID(), patientId: patientB, chiefComplaint: 'Anamnesis B' },
      ]);
    });

    const rows = await runAsService(async (db) => db.select().from(anamnesis));
    expect(rows).toHaveLength(2);
  });
});

describe('anamnesis — policy coverage in migrations', () => {
  it('anamnesis table has CREATE POLICY statements in migrations', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const fg = await import('fast-glob');

    const ROOT = path.resolve(__dirname, '../../../..');
    const files = await fg.default('src/shared/db/migrations/**/*.sql', {
      cwd: ROOT,
      absolute: true,
    });

    let hasAnamnesisPolicy = false;
    const pattern = /CREATE\s+POLICY\b[^;]+\bON\s+["`]?anamnesis["`]?/gi;

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      if (pattern.test(source)) {
        hasAnamnesisPolicy = true;
        break;
      }
    }

    expect(hasAnamnesisPolicy).toBe(true);
  });
});
