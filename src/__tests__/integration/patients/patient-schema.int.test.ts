import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { patients } from '@/shared/db/schema/patients/tables';

import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

// Helper: create a row in `auth.users` so the FK constraint is satisfied.
// The `auth.users` table is bootstrapped by the Testcontainers setup
// (see `src/__tests__/e2e/_shared/postgres-container.ts`).
// We set `raw_app_meta_data.provider = 'google'` to make the
// `handle_new_user()` trigger skip profile creation (OAuth path).
async function seedAuthUser(userId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${userId}, ${`test-${userId}@example.com`}, '{"provider":"google"}'::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

describe('patients table — schema verification', () => {
  it('table patients exists and accepts inserts via service role', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(patients).values({
        id: patientId,
        userId,
        fullName: 'Maria Silva',
        patientType: 'individual',
        status: 'active',
        tags: ['ansiedade', 'tcc'],
      });
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.id, patientId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.fullName).toBe('Maria Silva');
    expect(rows[0]!.tags).toEqual(['ansiedade', 'tcc']);
    expect(rows[0]!.status).toBe('active');
  });

  it('all expected columns are present', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const coupleId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(patients).values({
        id: patientId,
        userId,
        fullName: 'João Santos',
        patientType: 'couple',
        birthDate: new Date('1990-05-15'),
        approximateAge: '35 anos',
        gender: 'male',
        phone: '+5511987654321',
        email: 'joao@example.com',
        cpf: '123.456.789-00',
        address: 'Rua das Flores, 123',
        profession: 'Engenheiro',
        maritalStatus: 'married',
        source: 'referral',
        tags: ['depressao'],
        photoPath: `${userId}/photo.jpg`,
        notes: 'Paciente encaminhado pelo Dr. Silva',
        status: 'active',
        consentSignedAt: new Date(),
        consentRevokedAt: null,
        coupleId,
      });
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.userId, userId));
    });

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.fullName).toBe('João Santos');
    expect(row.patientType).toBe('couple');
    expect(row.birthDate).toBeInstanceOf(Date);
    expect(row.approximateAge).toBe('35 anos');
    expect(row.gender).toBe('male');
    expect(row.phone).toBe('+5511987654321');
    expect(row.email).toBe('joao@example.com');
    expect(row.cpf).toBe('123.456.789-00');
    expect(row.address).toBe('Rua das Flores, 123');
    expect(row.profession).toBe('Engenheiro');
    expect(row.maritalStatus).toBe('married');
    expect(row.source).toBe('referral');
    expect(row.tags).toEqual(['depressao']);
    expect(row.photoPath).toBe(`${userId}/photo.jpg`);
    expect(row.notes).toBe('Paciente encaminhado pelo Dr. Silva');
    expect(row.consentSignedAt).toBeInstanceOf(Date);
    expect(row.consentRevokedAt).toBeNull();
    expect(row.coupleId).toBe(coupleId);
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
    expect(row.archivedAt).toBeNull();
  });
});

describe('patients table — RLS policies', () => {
  it('RLS is enabled on patients table', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(dsql`SELECT relrowsecurity FROM pg_class WHERE relname = 'patients'`);
    });

    expect(result[0]!.relrowsecurity).toBe(true);
  });

  it('has all four owner-scoped policies', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname, polcmd FROM pg_policy
             WHERE polrelid = 'patients'::regclass
             ORDER BY polname`,
      );
    });

    const policies = result.map((r) => ({
      name: r.polname as string,
      cmd: r.polcmd as string,
    }));

    // Expected: select, insert, update, delete
    expect(policies).toHaveLength(4);
    expect(policies.find((p) => p.cmd === 'r')).toBeDefined(); // SELECT
    expect(policies.find((p) => p.cmd === 'a')).toBeDefined(); // INSERT
    expect(policies.find((p) => p.cmd === 'w')).toBeDefined(); // UPDATE
    expect(policies.find((p) => p.cmd === 'd')).toBeDefined(); // DELETE
  });

  it('owner can read their own patients', async () => {
    const userA = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);

    await runAsService(async (db) => {
      await db.insert(patients).values({
        id: patientId,
        userId: userA,
        fullName: 'Paciente A',
      });
    });

    const rows = await runAsUser(userA, async (db) => {
      return db.select().from(patients);
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(patientId);
  });

  it("non-owner cannot read another user's patients", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    await runAsService(async (db) => {
      await db.insert(patients).values({
        id: randomUUID(),
        userId: userA,
        fullName: 'Paciente de A',
      });
    });

    const rows = await runAsUser(userB, async (db) => {
      return db.select().from(patients);
    });

    expect(rows).toHaveLength(0);
  });

  it('owner can insert patients with their own user_id', async () => {
    const userA = randomUUID();
    await seedAuthUser(userA);

    await runAsUser(userA, async (db) => {
      await db.insert(patients).values({
        id: randomUUID(),
        userId: userA,
        fullName: 'Novo Paciente',
      });
    });

    const rows = await runAsUser(userA, async (db) => {
      return db.select().from(patients);
    });

    expect(rows).toHaveLength(1);
  });

  it('owner cannot insert patients with another user_id', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    await expect(
      runAsUser(userA, async (db) => {
        await db.insert(patients).values({
          id: randomUUID(),
          userId: userB,
          fullName: 'Hijack attempt',
        });
      }),
    ).rejects.toThrow();
  });

  it('owner can update their own patients', async () => {
    const userA = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);

    await runAsService(async (db) => {
      await db.insert(patients).values({
        id: patientId,
        userId: userA,
        fullName: 'Original Name',
      });
    });

    await runAsUser(userA, async (db) => {
      await db.update(patients).set({ fullName: 'Updated Name' }).where(eq(patients.id, patientId));
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.id, patientId));
    });

    expect(rows[0]!.fullName).toBe('Updated Name');
  });

  it("non-owner cannot update another user's patients", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    await runAsService(async (db) => {
      await db.insert(patients).values({
        id: patientId,
        userId: userA,
        fullName: 'Original Name',
      });
    });

    // This won't throw — it simply won't match any rows due to RLS
    await runAsUser(userB, async (db) => {
      await db
        .update(patients)
        .set({ fullName: 'Hijacked Name' })
        .where(eq(patients.id, patientId));
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.id, patientId));
    });

    expect(rows[0]!.fullName).toBe('Original Name');
  });

  it('owner can delete their own patients', async () => {
    const userA = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);

    await runAsService(async (db) => {
      await db.insert(patients).values({
        id: patientId,
        userId: userA,
        fullName: 'To be deleted',
      });
    });

    await runAsUser(userA, async (db) => {
      await db.delete(patients).where(eq(patients.id, patientId));
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.id, patientId));
    });

    expect(rows).toHaveLength(0);
  });

  it("non-owner cannot delete another user's patients", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    // RLS prevents deletion — no rows matched
    await runAsService(async (db) => {
      await db.insert(patients).values({
        id: patientId,
        userId: userA,
        fullName: 'Protected patient',
      });
    });

    await runAsUser(userB, async (db) => {
      await db.delete(patients).where(eq(patients.id, patientId));
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.id, patientId));
    });

    expect(rows).toHaveLength(1);
  });

  it('service-role connection bypasses RLS and sees all rows', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    await runAsService(async (db) => {
      await db.insert(patients).values([
        { id: randomUUID(), userId: userA, fullName: 'Patient A' },
        { id: randomUUID(), userId: userB, fullName: 'Patient B' },
      ]);
    });

    const rows = await runAsService(async (db) => db.select().from(patients));
    expect(rows).toHaveLength(2);
  });
});

describe('patients table — indexes', () => {
  it('has compound index on (user_id, status)', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname FROM pg_indexes
             WHERE tablename = 'patients' AND indexname = 'patients_user_id_status_idx'`,
      );
    });

    expect(result).toHaveLength(1);
  });

  it('has GIN index on full_name tsvector', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname FROM pg_indexes
             WHERE tablename = 'patients' AND indexname = 'patients_full_name_search_idx'`,
      );
    });

    expect(result).toHaveLength(1);
  });

  it('has partial unique index on (user_id, email) WHERE email IS NOT NULL', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname FROM pg_indexes
             WHERE tablename = 'patients' AND indexname = 'patients_user_id_email_unique'`,
      );
    });

    expect(result).toHaveLength(1);
  });

  it('partial unique index allows multiple NULL emails for same user', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(patients).values([
        { id: randomUUID(), userId, fullName: 'Patient 1', email: null },
        { id: randomUUID(), userId, fullName: 'Patient 2', email: null },
        { id: randomUUID(), userId, fullName: 'Patient 3', email: null },
      ]);
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.userId, userId));
    });

    expect(rows).toHaveLength(3);
  });

  it('partial unique index prevents duplicate emails for same user', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(patients).values({
        id: randomUUID(),
        userId,
        fullName: 'Patient 1',
        email: 'duplicate@example.com',
      });
    });

    await expect(
      runAsService(async (db) => {
        await db.insert(patients).values({
          id: randomUUID(),
          userId,
          fullName: 'Patient 2',
          email: 'duplicate@example.com',
        });
      }),
    ).rejects.toThrow();
  });
});

describe('RLS policy coverage — patients included', () => {
  // This test mirrors the project-wide policy-coverage test but specifically
  // verifies patients is covered, preventing regression if the migration is
  // accidentally edited to remove policies.
  it('patients table has CREATE POLICY statements in migrations', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const fg = await import('fast-glob');

    const ROOT = path.resolve(__dirname, '../../../..');
    const files = await fg.default('src/shared/db/migrations/**/*.sql', {
      cwd: ROOT,
      absolute: true,
    });

    let hasPatientsPolicy = false;
    const pattern = /CREATE\s+POLICY\b[^;]+\bON\s+["`]?patients["`]?/gi;

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      if (pattern.test(source)) {
        hasPatientsPolicy = true;
        break;
      }
    }

    expect(hasPatientsPolicy).toBe(true);
  });
});
