import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { logProntuarioAccessImpl } from '@/modules/medical-records/server/log-prontuario-access';
import { auditLog, evolutions, evolutionVersions } from '@/shared/db/schema/medical-records/tables';

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

function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- fake implementation returns a static value
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as Parameters<typeof logProntuarioAccessImpl>[0];
}

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(auditLog);
    await db.delete(evolutionVersions);
    await db.delete(evolutions);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// logProntuarioAccessImpl
// ---------------------------------------------------------------------------

describe('logProntuarioAccessImpl', () => {
  it('writes an audit_log row for authenticated caller', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await logProntuarioAccessImpl(fakeSupabaseClient(userId), {
      action: 'prontuario.export',
      resourceType: 'patient',
      resourceId: randomUUID(),
      metadata: { format: 'pdf' },
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.userId, userId));
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('prontuario.export');
    expect(rows[0]!.resourceType).toBe('patient');
    expect(rows[0]!.metadata).toEqual({ format: 'pdf' });
  });

  it('rejects unauthenticated calls (throws)', async () => {
    await expect(
      logProntuarioAccessImpl(fakeSupabaseClient(null), {
        action: 'prontuario.read',
        resourceType: 'patient',
      }),
    ).rejects.toThrow('UNAUTHORIZED');
  });

  it('writes row even without optional resourceId', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await logProntuarioAccessImpl(fakeSupabaseClient(userId), {
      action: 'prontuario.list',
      resourceType: 'dashboard',
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.userId, userId));
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.resourceId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RLS: user can SELECT own audit rows
// ---------------------------------------------------------------------------

describe('audit_log RLS', () => {
  it('user can SELECT their own audit entries', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    // Write audit entries for both users via service-role (simulates server writes)
    await runAsService(async (db) => {
      await db.insert(auditLog).values([
        {
          userId: userA,
          action: 'prontuario.read',
          resourceType: 'patient',
          resourceId: randomUUID(),
        },
        {
          userId: userA,
          action: 'evolution.create',
          resourceType: 'evolution',
          resourceId: randomUUID(),
        },
        {
          userId: userB,
          action: 'prontuario.read',
          resourceType: 'patient',
          resourceId: randomUUID(),
        },
      ]);
    });

    // User A should only see their 2 entries
    const visibleToA = await runAsUser(userA, async (db) => {
      return db.select().from(auditLog);
    });
    expect(visibleToA).toHaveLength(2);
    expect(visibleToA.every((row) => row.userId === userA)).toBe(true);

    // User B should only see their 1 entry
    const visibleToB = await runAsUser(userB, async (db) => {
      return db.select().from(auditLog);
    });
    expect(visibleToB).toHaveLength(1);
    expect(visibleToB[0]!.userId).toBe(userB);
  });

  it('authenticated user cannot INSERT directly into audit_log (RLS blocks)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    // Attempt INSERT as authenticated user — should be blocked by RLS
    // (no INSERT policy exists for authenticated users)
    await expect(
      runAsUser(userId, async (db) => {
        await db.insert(auditLog).values({
          userId,
          action: 'forged.entry',
          resourceType: 'hack',
        });
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// evolution_versions JOIN-scoped RLS
// ---------------------------------------------------------------------------

describe('evolution_versions RLS', () => {
  it('user can only see versions of their own evolutions', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    const evolutionIdA = randomUUID();
    const evolutionIdB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    // Seed evolutions for both users (via service-role to bypass RLS)
    await runAsService(async (db) => {
      await db.execute(
        dsql`INSERT INTO patients (id, user_id, full_name) VALUES (${patientId}, ${userA}, 'Test')`,
      );
      const patientIdB = randomUUID();
      await db.execute(
        dsql`INSERT INTO patients (id, user_id, full_name) VALUES (${patientIdB}, ${userB}, 'Test B')`,
      );

      await db.insert(evolutions).values([
        {
          id: evolutionIdA,
          userId: userA,
          patientId,
          templateType: 'livre',
          content: { conteudo: 'A content' },
          currentVersion: 1,
        },
        {
          id: evolutionIdB,
          userId: userB,
          patientId: patientIdB,
          templateType: 'livre',
          content: { conteudo: 'B content' },
          currentVersion: 1,
        },
      ]);

      await db.insert(evolutionVersions).values([
        {
          evolutionId: evolutionIdA,
          versionNumber: 1,
          content: { conteudo: 'A v1' },
          isAddendum: false,
          modifiedBy: userA,
        },
        {
          evolutionId: evolutionIdB,
          versionNumber: 1,
          content: { conteudo: 'B v1' },
          isAddendum: false,
          modifiedBy: userB,
        },
      ]);
    });

    // User A should only see versions of their own evolution
    const visibleToA = await runAsUser(userA, async (db) => {
      return db.select().from(evolutionVersions);
    });
    expect(visibleToA).toHaveLength(1);
    expect(visibleToA[0]!.evolutionId).toBe(evolutionIdA);

    // User B should only see versions of their own evolution
    const visibleToB = await runAsUser(userB, async (db) => {
      return db.select().from(evolutionVersions);
    });
    expect(visibleToB).toHaveLength(1);
    expect(visibleToB[0]!.evolutionId).toBe(evolutionIdB);
  });
});
