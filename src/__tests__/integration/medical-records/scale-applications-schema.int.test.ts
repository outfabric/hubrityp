import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { scaleApplications } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { cleanTestData } from '../setup/clean-test-data';
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
  await cleanTestData();
});

// =====================================================================
// Table existence
// =====================================================================

describe('scale-applications — table existence', () => {
  it('scale_applications table exists', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'scale_applications'`,
      );
    });

    expect(result).toHaveLength(1);
  });
});

// =====================================================================
// RLS enabled
// =====================================================================

describe('scale-applications — RLS enabled', () => {
  it('RLS is enabled on scale_applications', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT relrowsecurity FROM pg_class WHERE relname = 'scale_applications'`,
      );
    });

    expect(result[0]!.relrowsecurity).toBe(true);
  });
});

// =====================================================================
// RLS policies — scale_applications (SELECT/INSERT/UPDATE only, no DELETE)
// =====================================================================

describe('scale-applications — RLS policies', () => {
  it('has exactly 3 policies: SELECT, INSERT, UPDATE (no DELETE)', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname, polcmd FROM pg_policy
             WHERE polrelid = 'scale_applications'::regclass
             ORDER BY polname`,
      );
    });

    const policies = result.map((r) => ({
      name: r.polname as string,
      cmd: r.polcmd as string,
    }));

    // r=SELECT, a=INSERT, w=UPDATE, d=DELETE
    expect(policies).toHaveLength(3);
    expect(policies.find((p) => p.cmd === 'r')).toBeDefined(); // SELECT
    expect(policies.find((p) => p.cmd === 'a')).toBeDefined(); // INSERT
    expect(policies.find((p) => p.cmd === 'w')).toBeDefined(); // UPDATE
    expect(policies.find((p) => p.cmd === 'd')).toBeUndefined(); // NO DELETE
  });

  it('owner can read their own scale applications', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await runAsService(async (db) => {
      await db.insert(scaleApplications).values({
        id: randomUUID(),
        userId,
        patientId,
        scaleKey: 'phq9',
        responses: [{ q: 1, a: 2 }],
        totalScore: 10,
        classification: 'moderate',
      });
    });

    const rows = await runAsUser(userId, async (db) => {
      return db.select().from(scaleApplications);
    });

    expect(rows).toHaveLength(1);
  });

  it('non-owner cannot read another user scale applications', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    await runAsService(async (db) => {
      await db.insert(scaleApplications).values({
        id: randomUUID(),
        userId: userA,
        patientId,
        scaleKey: 'gad7',
        responses: [],
      });
    });

    const rows = await runAsUser(userB, async (db) => {
      return db.select().from(scaleApplications);
    });

    expect(rows).toHaveLength(0);
  });
});

// =====================================================================
// No DELETE policy (Lei 13.787/2018)
// =====================================================================

describe('scale-applications — no DELETE policy (Lei 13.787/2018)', () => {
  it('scale_applications has no DELETE policy', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname FROM pg_policy
             WHERE polrelid = 'scale_applications'::regclass AND polcmd = 'd'`,
      );
    });

    expect(result).toHaveLength(0);
  });
});

// =====================================================================
// UNIQUE constraint on remote_token
// =====================================================================

describe('scale-applications — UNIQUE constraints', () => {
  it('remote_token has UNIQUE constraint', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const token = 'unique-token-abc123';
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await runAsService(async (db) => {
      await db.insert(scaleApplications).values({
        id: randomUUID(),
        userId,
        patientId,
        scaleKey: 'phq9',
        responses: [],
        remoteToken: token,
        appliedRemotely: true,
      });
    });

    // Inserting a second row with the same remote_token should fail
    await expect(
      runAsService(async (db) => {
        await db.insert(scaleApplications).values({
          id: randomUUID(),
          userId,
          patientId,
          scaleKey: 'gad7',
          responses: [],
          remoteToken: token,
          appliedRemotely: true,
        });
      }),
    ).rejects.toThrow();
  });

  it('allows multiple NULL remote_token values (partial uniqueness)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Both rows have NULL remote_token — should not conflict
    await runAsService(async (db) => {
      await db.insert(scaleApplications).values({
        id: randomUUID(),
        userId,
        patientId,
        scaleKey: 'phq9',
        responses: [],
      });
      await db.insert(scaleApplications).values({
        id: randomUUID(),
        userId,
        patientId,
        scaleKey: 'gad7',
        responses: [],
      });
    });

    const count = await runAsService(async (db) => {
      const rows = await db
        .select()
        .from(scaleApplications)
        .where(eq(scaleApplications.patientId, patientId));
      return rows.length;
    });

    expect(count).toBe(2);
  });
});

// =====================================================================
// CHECK constraint on scale_key
// =====================================================================

describe('scale-applications — CHECK constraint on scale_key', () => {
  it('allows valid scale keys', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const validKeys = ['phq9', 'gad7', 'sdq', 'audit', 'whoqol-bref'] as const;

    for (const key of validKeys) {
      await runAsService(async (db) => {
        await db.insert(scaleApplications).values({
          id: randomUUID(),
          userId,
          patientId,
          scaleKey: key,
          responses: [],
        });
      });
    }

    const count = await runAsService(async (db) => {
      const rows = await db
        .select()
        .from(scaleApplications)
        .where(eq(scaleApplications.patientId, patientId));
      return rows.length;
    });

    expect(count).toBe(validKeys.length);
  });

  it('rejects invalid scale key', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await expect(
      runAsService(async (db) => {
        await db.insert(scaleApplications).values({
          id: randomUUID(),
          userId,
          patientId,
          scaleKey: 'invalid-scale',
          responses: [],
        });
      }),
    ).rejects.toThrow();
  });
});

// =====================================================================
// Index on (patient_id, scale_key, applied_at)
// =====================================================================

describe('scale-applications — composite index', () => {
  it('has index on (patient_id, scale_key, applied_at)', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname FROM pg_indexes
             WHERE tablename = 'scale_applications'
             AND indexname = 'idx_scale_apps_patient_scale_applied'`,
      );
    });

    expect(result).toHaveLength(1);
  });
});
