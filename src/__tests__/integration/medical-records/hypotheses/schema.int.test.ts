import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { cleanTestData } from '@/__tests__/integration/setup/clean-test-data';
import { runAsService } from '@/__tests__/integration/setup/run-as-service';
import { runAsUser } from '@/__tests__/integration/setup/run-as-user';
import { diagnosticHypotheses } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';

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

describe('diagnostic_hypotheses — table existence', () => {
  it('diagnostic_hypotheses table exists', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'diagnostic_hypotheses'`,
      );
    });

    expect(result).toHaveLength(1);
  });
});

// =====================================================================
// RLS enabled
// =====================================================================

describe('diagnostic_hypotheses — RLS enabled', () => {
  it('RLS is enabled on diagnostic_hypotheses', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT relrowsecurity FROM pg_class WHERE relname = 'diagnostic_hypotheses'`,
      );
    });

    expect(result[0]!.relrowsecurity).toBe(true);
  });
});

// =====================================================================
// RLS policies — SELECT/INSERT/UPDATE only, no DELETE
// =====================================================================

describe('diagnostic_hypotheses — RLS policies', () => {
  it('has exactly 3 policies: SELECT, INSERT, UPDATE (no DELETE)', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname, polcmd FROM pg_policy
             WHERE polrelid = 'diagnostic_hypotheses'::regclass
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

  it('no DELETE policy exists (Lei 13.787/2018 retention mandate)', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname FROM pg_policy
             WHERE polrelid = 'diagnostic_hypotheses'::regclass AND polcmd = 'd'`,
      );
    });

    expect(result).toHaveLength(0);
  });

  it('owner can SELECT own hypotheses', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await runAsService(async (db) => {
      await db.insert(diagnosticHypotheses).values({
        id: randomUUID(),
        userId,
        patientId,
        description: 'Test hypothesis',
        status: 'investigating',
      });
    });

    const rows = await runAsUser(userId, async (db) => {
      return db.select().from(diagnosticHypotheses);
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.description).toBe('Test hypothesis');
  });

  it('non-owner cannot SELECT another user hypotheses (cross-tenant isolation)', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    await runAsService(async (db) => {
      await db.insert(diagnosticHypotheses).values({
        id: randomUUID(),
        userId: userA,
        patientId,
        description: 'Private hypothesis',
        status: 'investigating',
      });
    });

    const rows = await runAsUser(userB, async (db) => {
      return db.select().from(diagnosticHypotheses);
    });

    expect(rows).toHaveLength(0);
  });

  it('owner can INSERT with own user_id', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const insertedRows = await runAsUser(userId, async (db) => {
      return db
        .insert(diagnosticHypotheses)
        .values({
          id: randomUUID(),
          userId,
          patientId,
          cid10Code: 'F32.0',
          cid10Description: 'Episodio depressivo leve',
          status: 'investigating',
        })
        .returning();
    });

    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]!.cid10Code).toBe('F32.0');
  });

  it('INSERT with different user_id is rejected by RLS', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    await expect(
      runAsUser(userB, async (db) => {
        await db.insert(diagnosticHypotheses).values({
          id: randomUUID(),
          userId: userA, // attempting to insert as another user
          patientId,
          description: 'Malicious hypothesis',
          status: 'investigating',
        });
      }),
    ).rejects.toThrow();
  });

  it('owner can UPDATE own hypothesis', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const hypothesisId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await runAsService(async (db) => {
      await db.insert(diagnosticHypotheses).values({
        id: hypothesisId,
        userId,
        patientId,
        description: 'Original',
        status: 'investigating',
      });
    });

    const updated = await runAsUser(userId, async (db) => {
      return db
        .update(diagnosticHypotheses)
        .set({ description: 'Updated', updatedAt: new Date() })
        .returning();
    });

    expect(updated).toHaveLength(1);
    expect(updated[0]!.description).toBe('Updated');
  });

  it('non-owner cannot UPDATE another user hypothesis', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    const hypothesisId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    await runAsService(async (db) => {
      await db.insert(diagnosticHypotheses).values({
        id: hypothesisId,
        userId: userA,
        patientId,
        description: 'Private',
        status: 'investigating',
      });
    });

    // userB attempts to update userA's hypothesis — should affect 0 rows
    const updated = await runAsUser(userB, async (db) => {
      return db.update(diagnosticHypotheses).set({ description: 'Hacked' }).returning();
    });

    expect(updated).toHaveLength(0);
  });
});

// =====================================================================
// CHECK constraints
// =====================================================================

describe('diagnostic_hypotheses — CHECK constraints', () => {
  it('rejects row with both description AND cid10_code NULL (chk_hypothesis_has_descriptor)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await expect(
      runAsService(async (db) => {
        await db.insert(diagnosticHypotheses).values({
          id: randomUUID(),
          userId,
          patientId,
          description: null,
          cid10Code: null,
          status: 'investigating',
        });
      }),
    ).rejects.toThrow();
  });

  it('accepts row with only description (cid10_code NULL)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const rows = await runAsService(async (db) => {
      return db
        .insert(diagnosticHypotheses)
        .values({
          id: randomUUID(),
          userId,
          patientId,
          description: 'Free-text hypothesis',
          cid10Code: null,
          status: 'investigating',
        })
        .returning();
    });

    expect(rows).toHaveLength(1);
  });

  it('accepts row with only cid10_code (description NULL)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const rows = await runAsService(async (db) => {
      return db
        .insert(diagnosticHypotheses)
        .values({
          id: randomUUID(),
          userId,
          patientId,
          description: null,
          cid10Code: 'F41.1',
          cid10Description: 'Ansiedade generalizada',
          status: 'investigating',
        })
        .returning();
    });

    expect(rows).toHaveLength(1);
  });

  it('rejects invalid status value (chk_hypothesis_status)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await expect(
      runAsService(async (db) => {
        await db.insert(diagnosticHypotheses).values({
          id: randomUUID(),
          userId,
          patientId,
          description: 'Some hypothesis',
          status: 'invalid_status',
        });
      }),
    ).rejects.toThrow();
  });

  it('accepts valid status values: investigating, confirmed, discarded', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    for (const status of ['investigating', 'confirmed', 'discarded'] as const) {
      const rows = await runAsService(async (db) => {
        return db
          .insert(diagnosticHypotheses)
          .values({
            id: randomUUID(),
            userId,
            patientId,
            description: `Hypothesis with status ${status}`,
            status,
          })
          .returning();
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe(status);
    }
  });
});

// =====================================================================
// Index existence
// =====================================================================

describe('diagnostic_hypotheses — indexes', () => {
  it('composite index on (patient_id, status, created_at) exists', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname FROM pg_indexes
             WHERE tablename = 'diagnostic_hypotheses'
             AND indexname = 'idx_diagnostic_hypotheses_patient_status_created'`,
      );
    });

    expect(result).toHaveLength(1);
  });

  it('user_id index exists for RLS performance', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname FROM pg_indexes
             WHERE tablename = 'diagnostic_hypotheses'
             AND indexname = 'idx_diagnostic_hypotheses_user_id'`,
      );
    });

    expect(result).toHaveLength(1);
  });
});
