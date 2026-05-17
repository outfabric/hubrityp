import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { sessions } from '@/shared/db/schema/agenda/tables';
import { evolutions, evolutionVersions, auditLog } from '@/shared/db/schema/medical-records/tables';
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

async function seedSession(userId: string, patientId: string, sessionId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(sessions).values({
      id: sessionId,
      userId,
      patientId,
      startAt: new Date(),
      endAt: new Date(Date.now() + 3600000),
      durationMinutes: 60,
      status: 'scheduled',
    });
  });
}

afterEach(async () => {
  await cleanTestData();
});

// =====================================================================
// Table existence
// =====================================================================

describe('medical-records — table existence', () => {
  it('evolutions table exists', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'evolutions'`,
      );
    });

    expect(result).toHaveLength(1);
  });

  it('evolution_versions table exists', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'evolution_versions'`,
      );
    });

    expect(result).toHaveLength(1);
  });

  it('audit_log table exists', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'audit_log'`,
      );
    });

    expect(result).toHaveLength(1);
  });
});

// =====================================================================
// RLS enabled
// =====================================================================

describe('medical-records — RLS enabled', () => {
  it('RLS is enabled on evolutions', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(dsql`SELECT relrowsecurity FROM pg_class WHERE relname = 'evolutions'`);
    });

    expect(result[0]!.relrowsecurity).toBe(true);
  });

  it('RLS is enabled on evolution_versions', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT relrowsecurity FROM pg_class WHERE relname = 'evolution_versions'`,
      );
    });

    expect(result[0]!.relrowsecurity).toBe(true);
  });

  it('RLS is enabled on audit_log', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(dsql`SELECT relrowsecurity FROM pg_class WHERE relname = 'audit_log'`);
    });

    expect(result[0]!.relrowsecurity).toBe(true);
  });
});

// =====================================================================
// RLS policies — evolutions (SELECT/INSERT/UPDATE only, no DELETE)
// =====================================================================

describe('medical-records — evolutions RLS policies', () => {
  it('has exactly 3 policies: SELECT, INSERT, UPDATE (no DELETE)', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname, polcmd FROM pg_policy
             WHERE polrelid = 'evolutions'::regclass
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

  it('owner can read their own evolutions', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await runAsService(async (db) => {
      await db.insert(evolutions).values({
        id: randomUUID(),
        userId,
        patientId,
        templateType: 'free_text',
        content: { text: 'Session notes' },
      });
    });

    const rows = await runAsUser(userId, async (db) => {
      return db.select().from(evolutions);
    });

    expect(rows).toHaveLength(1);
  });

  it('non-owner cannot read another user evolutions', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    await runAsService(async (db) => {
      await db.insert(evolutions).values({
        id: randomUUID(),
        userId: userA,
        patientId,
        templateType: 'free_text',
        content: { text: 'Private notes' },
      });
    });

    const rows = await runAsUser(userB, async (db) => {
      return db.select().from(evolutions);
    });

    expect(rows).toHaveLength(0);
  });
});

// =====================================================================
// RLS policies — evolution_versions (SELECT/INSERT/UPDATE only, no DELETE)
// =====================================================================

describe('medical-records — evolution_versions RLS policies', () => {
  it('has exactly 3 policies: SELECT, INSERT, UPDATE (no DELETE)', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname, polcmd FROM pg_policy
             WHERE polrelid = 'evolution_versions'::regclass
             ORDER BY polname`,
      );
    });

    const policies = result.map((r) => ({
      name: r.polname as string,
      cmd: r.polcmd as string,
    }));

    expect(policies).toHaveLength(3);
    expect(policies.find((p) => p.cmd === 'r')).toBeDefined(); // SELECT
    expect(policies.find((p) => p.cmd === 'a')).toBeDefined(); // INSERT
    expect(policies.find((p) => p.cmd === 'w')).toBeDefined(); // UPDATE
    expect(policies.find((p) => p.cmd === 'd')).toBeUndefined(); // NO DELETE
  });

  it('owner can read versions of their evolution', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const evoId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await runAsService(async (db) => {
      await db.insert(evolutions).values({
        id: evoId,
        userId,
        patientId,
        templateType: 'free_text',
        content: { text: 'v1' },
      });
      await db.insert(evolutionVersions).values({
        id: randomUUID(),
        evolutionId: evoId,
        versionNumber: 1,
        content: { text: 'v1' },
        modifiedBy: userId,
      });
    });

    const rows = await runAsUser(userId, async (db) => {
      return db.select().from(evolutionVersions);
    });

    expect(rows).toHaveLength(1);
  });

  it('non-owner cannot read versions of another user evolution', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    const evoId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    await runAsService(async (db) => {
      await db.insert(evolutions).values({
        id: evoId,
        userId: userA,
        patientId,
        templateType: 'free_text',
        content: { text: 'v1' },
      });
      await db.insert(evolutionVersions).values({
        id: randomUUID(),
        evolutionId: evoId,
        versionNumber: 1,
        content: { text: 'v1' },
        modifiedBy: userA,
      });
    });

    const rows = await runAsUser(userB, async (db) => {
      return db.select().from(evolutionVersions);
    });

    expect(rows).toHaveLength(0);
  });
});

// =====================================================================
// RLS policies — audit_log (SELECT only, no INSERT/UPDATE/DELETE)
// =====================================================================

describe('medical-records — audit_log RLS policies', () => {
  it('has exactly 1 policy: SELECT only (no INSERT, UPDATE, DELETE)', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname, polcmd FROM pg_policy
             WHERE polrelid = 'audit_log'::regclass
             ORDER BY polname`,
      );
    });

    const policies = result.map((r) => ({
      name: r.polname as string,
      cmd: r.polcmd as string,
    }));

    expect(policies).toHaveLength(1);
    expect(policies[0]!.cmd).toBe('r'); // SELECT only
  });

  it('user can read their own audit entries', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(auditLog).values({
        id: randomUUID(),
        userId,
        action: 'evolution.created',
        resourceType: 'evolution',
        resourceId: randomUUID(),
        metadata: {},
      });
    });

    const rows = await runAsUser(userId, async (db) => {
      return db.select().from(auditLog);
    });

    expect(rows).toHaveLength(1);
  });

  it('user cannot read another user audit entries', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    await runAsService(async (db) => {
      await db.insert(auditLog).values({
        id: randomUUID(),
        userId: userA,
        action: 'evolution.created',
        resourceType: 'evolution',
        resourceId: randomUUID(),
        metadata: {},
      });
    });

    const rows = await runAsUser(userB, async (db) => {
      return db.select().from(auditLog);
    });

    expect(rows).toHaveLength(0);
  });
});

// =====================================================================
// UNIQUE constraints
// =====================================================================

describe('medical-records — UNIQUE constraints', () => {
  it('evolutions.session_id has UNIQUE constraint (one evolution per session)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, patientId, sessionId);

    await runAsService(async (db) => {
      await db.insert(evolutions).values({
        id: randomUUID(),
        userId,
        patientId,
        sessionId,
        templateType: 'free_text',
        content: { text: 'First' },
      });
    });

    // Inserting a second evolution with the same session_id should fail
    await expect(
      runAsService(async (db) => {
        await db.insert(evolutions).values({
          id: randomUUID(),
          userId,
          patientId,
          sessionId,
          templateType: 'free_text',
          content: { text: 'Duplicate' },
        });
      }),
    ).rejects.toThrow();
  });

  it('evolution_versions (evolution_id, version_number) has UNIQUE constraint', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const evoId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await runAsService(async (db) => {
      await db.insert(evolutions).values({
        id: evoId,
        userId,
        patientId,
        templateType: 'free_text',
        content: { text: 'v1' },
      });
      await db.insert(evolutionVersions).values({
        id: randomUUID(),
        evolutionId: evoId,
        versionNumber: 1,
        content: { text: 'v1' },
        modifiedBy: userId,
      });
    });

    // Inserting a second version with the same (evolution_id, version_number) should fail
    await expect(
      runAsService(async (db) => {
        await db.insert(evolutionVersions).values({
          id: randomUUID(),
          evolutionId: evoId,
          versionNumber: 1,
          content: { text: 'v1 duplicate' },
          modifiedBy: userId,
        });
      }),
    ).rejects.toThrow();
  });
});

// =====================================================================
// No DELETE policy on any table
// =====================================================================

describe('medical-records — no DELETE policy (Lei 13.787/2018)', () => {
  it('evolutions has no DELETE policy', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname FROM pg_policy
             WHERE polrelid = 'evolutions'::regclass AND polcmd = 'd'`,
      );
    });

    expect(result).toHaveLength(0);
  });

  it('evolution_versions has no DELETE policy', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname FROM pg_policy
             WHERE polrelid = 'evolution_versions'::regclass AND polcmd = 'd'`,
      );
    });

    expect(result).toHaveLength(0);
  });

  it('audit_log has no DELETE policy', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname FROM pg_policy
             WHERE polrelid = 'audit_log'::regclass AND polcmd = 'd'`,
      );
    });

    expect(result).toHaveLength(0);
  });
});
