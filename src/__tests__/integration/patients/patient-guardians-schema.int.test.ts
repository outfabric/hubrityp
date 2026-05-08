import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { patientGuardians } from '@/shared/db/schema/patients/tables';
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
    await db.delete(patientGuardians);
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

describe('patient_guardians table — schema verification', () => {
  it('table patient_guardians exists', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'patient_guardians'`,
      );
    });

    expect(result).toHaveLength(1);
  });

  it('has all expected columns with correct types', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT column_name, data_type, is_nullable
             FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'patient_guardians'
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
        expect.objectContaining({ name: 'full_name', type: 'character varying', nullable: 'NO' }),
        expect.objectContaining({ name: 'relationship', type: 'text', nullable: 'NO' }),
        expect.objectContaining({ name: 'cpf', type: 'character varying', nullable: 'YES' }),
        expect.objectContaining({ name: 'phone', type: 'character varying', nullable: 'YES' }),
        expect.objectContaining({ name: 'email', type: 'character varying', nullable: 'YES' }),
        expect.objectContaining({ name: 'is_primary', type: 'boolean', nullable: 'NO' }),
        expect.objectContaining({
          name: 'created_at',
          type: 'timestamp with time zone',
          nullable: 'NO',
        }),
      ]),
    );

    expect(columns).toHaveLength(9);
  });

  it('accepts inserts via service role', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const guardianId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await runAsService(async (db) => {
      await db.insert(patientGuardians).values({
        id: guardianId,
        patientId,
        fullName: 'Ana Silva',
        relationship: 'mother',
        cpf: '123.456.789-00',
        phone: '+5511987654321',
        email: 'ana@example.com',
        isPrimary: true,
      });
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(patientGuardians).where(eq(patientGuardians.id, guardianId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.fullName).toBe('Ana Silva');
    expect(rows[0]!.relationship).toBe('mother');
    expect(rows[0]!.isPrimary).toBe(true);
    expect(rows[0]!.createdAt).toBeInstanceOf(Date);
  });
});

describe('patient_guardians table — FK cascade', () => {
  it('deleting a patient cascades to its guardians', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await runAsService(async (db) => {
      await db.insert(patientGuardians).values([
        { id: randomUUID(), patientId, fullName: 'Guardian 1', relationship: 'mother' },
        { id: randomUUID(), patientId, fullName: 'Guardian 2', relationship: 'father' },
      ]);
    });

    // Verify guardians exist before deletion
    const before = await runAsService(async (db) => {
      return db.select().from(patientGuardians).where(eq(patientGuardians.patientId, patientId));
    });
    expect(before).toHaveLength(2);

    // Delete the parent patient
    await runAsService(async (db) => {
      await db.delete(patients).where(eq(patients.id, patientId));
    });

    // Guardians should be gone
    const after = await runAsService(async (db) => {
      return db.select().from(patientGuardians).where(eq(patientGuardians.patientId, patientId));
    });
    expect(after).toHaveLength(0);
  });

  it('rejects insert with non-existent patient_id', async () => {
    const fakePatientId = randomUUID();

    await expect(
      runAsService(async (db) => {
        await db.insert(patientGuardians).values({
          id: randomUUID(),
          patientId: fakePatientId,
          fullName: 'Orphan Guardian',
          relationship: 'mother',
        });
      }),
    ).rejects.toThrow();
  });
});

describe('patient_guardians table — RLS policies', () => {
  it('RLS is enabled on patient_guardians table', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT relrowsecurity FROM pg_class WHERE relname = 'patient_guardians'`,
      );
    });

    expect(result[0]!.relrowsecurity).toBe(true);
  });

  it('has all four owner-scoped policies', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname, polcmd FROM pg_policy
             WHERE polrelid = 'patient_guardians'::regclass
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

  it('owner can read guardians of their own patients', async () => {
    const userA = randomUUID();
    const patientId = randomUUID();
    const guardianId = randomUUID();
    await seedAuthUser(userA);
    await seedPatient(userA, patientId);

    await runAsService(async (db) => {
      await db.insert(patientGuardians).values({
        id: guardianId,
        patientId,
        fullName: 'Guardian of A',
        relationship: 'mother',
      });
    });

    const rows = await runAsUser(userA, async (db) => {
      return db.select().from(patientGuardians);
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(guardianId);
  });

  it("non-owner cannot read guardians of another user's patients", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    await runAsService(async (db) => {
      await db.insert(patientGuardians).values({
        id: randomUUID(),
        patientId,
        fullName: 'Guardian of A',
        relationship: 'father',
      });
    });

    const rows = await runAsUser(userB, async (db) => {
      return db.select().from(patientGuardians);
    });

    expect(rows).toHaveLength(0);
  });

  it('owner can insert guardians for their own patients', async () => {
    const userA = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedPatient(userA, patientId);

    await runAsUser(userA, async (db) => {
      await db.insert(patientGuardians).values({
        id: randomUUID(),
        patientId,
        fullName: 'New Guardian',
        relationship: 'mother',
      });
    });

    const rows = await runAsUser(userA, async (db) => {
      return db.select().from(patientGuardians);
    });

    expect(rows).toHaveLength(1);
  });

  it("owner cannot insert guardians for another user's patients", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    await expect(
      runAsUser(userB, async (db) => {
        await db.insert(patientGuardians).values({
          id: randomUUID(),
          patientId,
          fullName: 'Hijack attempt',
          relationship: 'father',
        });
      }),
    ).rejects.toThrow();
  });

  it('owner can update guardians of their own patients', async () => {
    const userA = randomUUID();
    const patientId = randomUUID();
    const guardianId = randomUUID();
    await seedAuthUser(userA);
    await seedPatient(userA, patientId);

    await runAsService(async (db) => {
      await db.insert(patientGuardians).values({
        id: guardianId,
        patientId,
        fullName: 'Original Name',
        relationship: 'mother',
      });
    });

    await runAsUser(userA, async (db) => {
      await db
        .update(patientGuardians)
        .set({ fullName: 'Updated Name' })
        .where(eq(patientGuardians.id, guardianId));
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(patientGuardians).where(eq(patientGuardians.id, guardianId));
    });

    expect(rows[0]!.fullName).toBe('Updated Name');
  });

  it("non-owner cannot update guardians of another user's patients", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    const guardianId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    await runAsService(async (db) => {
      await db.insert(patientGuardians).values({
        id: guardianId,
        patientId,
        fullName: 'Original Name',
        relationship: 'mother',
      });
    });

    // Won't throw — RLS silently filters, no rows matched
    await runAsUser(userB, async (db) => {
      await db
        .update(patientGuardians)
        .set({ fullName: 'Hijacked Name' })
        .where(eq(patientGuardians.id, guardianId));
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(patientGuardians).where(eq(patientGuardians.id, guardianId));
    });

    expect(rows[0]!.fullName).toBe('Original Name');
  });

  it('owner can delete guardians of their own patients', async () => {
    const userA = randomUUID();
    const patientId = randomUUID();
    const guardianId = randomUUID();
    await seedAuthUser(userA);
    await seedPatient(userA, patientId);

    await runAsService(async (db) => {
      await db.insert(patientGuardians).values({
        id: guardianId,
        patientId,
        fullName: 'To be deleted',
        relationship: 'mother',
      });
    });

    await runAsUser(userA, async (db) => {
      await db.delete(patientGuardians).where(eq(patientGuardians.id, guardianId));
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(patientGuardians).where(eq(patientGuardians.id, guardianId));
    });

    expect(rows).toHaveLength(0);
  });

  it("non-owner cannot delete guardians of another user's patients", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    const guardianId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    await runAsService(async (db) => {
      await db.insert(patientGuardians).values({
        id: guardianId,
        patientId,
        fullName: 'Protected guardian',
        relationship: 'father',
      });
    });

    await runAsUser(userB, async (db) => {
      await db.delete(patientGuardians).where(eq(patientGuardians.id, guardianId));
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(patientGuardians).where(eq(patientGuardians.id, guardianId));
    });

    expect(rows).toHaveLength(1);
  });

  it('service-role connection bypasses RLS and sees all guardians', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientA = randomUUID();
    const patientB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientA);
    await seedPatient(userB, patientB);

    await runAsService(async (db) => {
      await db.insert(patientGuardians).values([
        { id: randomUUID(), patientId: patientA, fullName: 'Guardian A', relationship: 'mother' },
        { id: randomUUID(), patientId: patientB, fullName: 'Guardian B', relationship: 'father' },
      ]);
    });

    const rows = await runAsService(async (db) => db.select().from(patientGuardians));
    expect(rows).toHaveLength(2);
  });
});

describe('patient_guardians — policy coverage in migrations', () => {
  it('patient_guardians table has CREATE POLICY statements in migrations', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const fg = await import('fast-glob');

    const ROOT = path.resolve(__dirname, '../../../..');
    const files = await fg.default('src/shared/db/migrations/**/*.sql', {
      cwd: ROOT,
      absolute: true,
    });

    let hasGuardiansPolicy = false;
    const pattern = /CREATE\s+POLICY\b[^;]+\bON\s+["`]?patient_guardians["`]?/gi;

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      if (pattern.test(source)) {
        hasGuardiansPolicy = true;
        break;
      }
    }

    expect(hasGuardiansPolicy).toBe(true);
  });
});
