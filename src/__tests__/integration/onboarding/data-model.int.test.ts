import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { notificationPreferences, onboardingChecklist } from '@/shared/db/schema/onboarding/tables';

import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

// ---------------------------------------------------------------------------
// Data-model verification for the onboarding-data-model change (section 3):
//   * new `profiles` columns + defaults + nps_score CHECK
//   * onboarding_checklist / notification_preferences tables exist
//   * RLS enabled with the expected per-operation policies (no DELETE policy)
//   * UNIQUE(user_id) enforced; user_id index present
//   * cross-tenant isolation (user B cannot read/modify user A's rows)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Insert an `auth.users` row. The `handle_new_user()` SECURITY DEFINER
// trigger (from migration 0001) fires on this INSERT and materializes the
// matching `public.profiles` row from `raw_user_meta_data`, so the metadata
// fields it requires (fullName/crpNumber/crpUf + the three consent timestamps)
// MUST be present or the whole INSERT rolls back. We make `crp_number` unique
// per user (slice of the UUID) so seeding two users does not collide on the
// `profiles_crp_number_crp_uf_unique` constraint.
async function seedAuthUser(userId: string): Promise<void> {
  const meta = JSON.stringify({
    fullName: 'Test Psychologist',
    crpNumber: userId.slice(0, 6),
    crpUf: 'SP',
    termsAcceptedAt: '2026-01-01T00:00:00Z',
    privacyAcceptedAt: '2026-01-01T00:00:00Z',
    sensitiveDataConsentAt: '2026-01-01T00:00:00Z',
  });
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
           VALUES (${userId}, ${`test-${userId}@example.com`},
                   '{"provider":"email"}'::jsonb, ${meta}::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

// Set the NPS score on the profile created by the `handle_new_user` trigger.
// Used to exercise the `nps_score` CHECK constraint (0..10). Raises on
// constraint violation.
async function setNpsScore(userId: string, score: number): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(dsql`UPDATE profiles SET nps_score = ${score} WHERE user_id = ${userId}`);
  });
}

afterEach(async () => {
  // Clean rows owned by our test users so files sharing the container don't
  // interfere. onboarding_checklist / notification_preferences cascade on the
  // auth.users delete, but we delete explicitly first for clarity.
  await runAsService(async (db) => {
    await db.execute(
      dsql`DELETE FROM onboarding_checklist
           WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'test-%@example.com')`,
    );
    await db.execute(
      dsql`DELETE FROM notification_preferences
           WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'test-%@example.com')`,
    );
    await db.execute(
      dsql`DELETE FROM profiles
           WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'test-%@example.com')`,
    );
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// profiles — new columns, defaults, and nps_score CHECK
// ---------------------------------------------------------------------------

describe('profiles — onboarding/NPS columns', () => {
  it('new columns exist with correct defaults', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const rows = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT onboarding_step, onboarding_completed_at, tour_completed_at,
                    first_access_at, reactivated_at, nps_score, nps_feedback, nps_responded_at
             FROM profiles WHERE user_id = ${userId}`,
      );
    });

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    // NOT NULL with default 'welcome'.
    expect(row.onboarding_step).toBe('welcome');
    // Nullable, no value supplied.
    expect(row.onboarding_completed_at).toBeNull();
    expect(row.tour_completed_at).toBeNull();
    expect(row.first_access_at).toBeNull();
    expect(row.reactivated_at).toBeNull();
    expect(row.nps_score).toBeNull();
    expect(row.nps_feedback).toBeNull();
    expect(row.nps_responded_at).toBeNull();
  });

  it('accepts nps_score within 0..10', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await setNpsScore(userId, 10);

    const rows = await runAsService(async (db) => {
      return db.execute(dsql`SELECT nps_score FROM profiles WHERE user_id = ${userId}`);
    });
    expect(rows[0]!.nps_score).toBe(10);
  });

  it('rejects nps_score = 11 via CHECK constraint', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await expect(setNpsScore(userId, 11)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Table existence + RLS enabled
// ---------------------------------------------------------------------------

describe('onboarding tables — existence and RLS enabled', () => {
  it('onboarding_checklist exists with RLS enabled', async () => {
    const rows = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT relrowsecurity FROM pg_class WHERE relname = 'onboarding_checklist'`,
      );
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.relrowsecurity).toBe(true);
  });

  it('notification_preferences exists with RLS enabled', async () => {
    const rows = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT relrowsecurity FROM pg_class WHERE relname = 'notification_preferences'`,
      );
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.relrowsecurity).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Policy coverage — SELECT/INSERT/UPDATE present, NO DELETE; auth.uid() scoped
// ---------------------------------------------------------------------------

describe('onboarding tables — RLS policy shape', () => {
  it('onboarding_checklist has SELECT/INSERT/UPDATE policies and NO DELETE', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polcmd FROM pg_policy
             WHERE polrelid = 'onboarding_checklist'::regclass`,
      );
    });
    const cmds = result.map((r) => r.polcmd as string);
    expect(cmds).toHaveLength(3);
    expect(cmds).toContain('r'); // SELECT
    expect(cmds).toContain('a'); // INSERT
    expect(cmds).toContain('w'); // UPDATE
    expect(cmds).not.toContain('d'); // NO DELETE
  });

  it('notification_preferences has SELECT/INSERT/UPDATE policies and NO DELETE', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polcmd FROM pg_policy
             WHERE polrelid = 'notification_preferences'::regclass`,
      );
    });
    const cmds = result.map((r) => r.polcmd as string);
    expect(cmds).toHaveLength(3);
    expect(cmds).toContain('r');
    expect(cmds).toContain('a');
    expect(cmds).toContain('w');
    expect(cmds).not.toContain('d');
  });

  it('all onboarding policies reference auth.uid() (no USING (true))', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname, polrelid::regclass::text AS tablename,
                    pg_get_expr(polqual, polrelid) AS using_expr,
                    pg_get_expr(polwithcheck, polrelid) AS with_check_expr
             FROM pg_policy
             WHERE polrelid IN ('onboarding_checklist'::regclass,
                                'notification_preferences'::regclass)`,
      );
    });

    expect(result).toHaveLength(6);
    for (const row of result) {
      const usingExpr = (row.using_expr as string) || '';
      const withCheckExpr = (row.with_check_expr as string) || '';
      const combined = `${usingExpr} ${withCheckExpr}`;
      const polname = row.polname as string;
      const tablename = row.tablename as string;
      expect(combined, `policy "${polname}" on "${tablename}" must reference auth.uid()`).toMatch(
        /auth\.uid\(\)/,
      );
    }
  });

  it('no onboarding policy grants DELETE/ALL to the authenticated role', async () => {
    // Belt-and-suspenders: query the pg_policy catalog directly (the
    // Supabase-only `pg_policies` view does not exist in vanilla
    // Testcontainers Postgres). polcmd 'd' (DELETE) or '*' (ALL) granted to
    // the `authenticated` role would be a regression letting users remove
    // their own singleton rows. We assert no such policy exists.
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT pol.polcmd
             FROM pg_policy pol
             JOIN pg_roles r ON r.oid = ANY(pol.polroles)
             WHERE pol.polrelid IN ('onboarding_checklist'::regclass,
                                    'notification_preferences'::regclass)
               AND r.rolname = 'authenticated'`,
      );
    });
    const cmds = result.map((r) => r.polcmd as string);
    expect(cmds).not.toContain('d'); // DELETE
    expect(cmds).not.toContain('*'); // ALL
  });
});

// ---------------------------------------------------------------------------
// Index on user_id
// ---------------------------------------------------------------------------

describe('onboarding tables — user_id index', () => {
  it('onboarding_checklist has an index on user_id', async () => {
    const rows = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname FROM pg_indexes
             WHERE tablename = 'onboarding_checklist'
               AND indexname = 'idx_onboarding_checklist_user_id'`,
      );
    });
    expect(rows).toHaveLength(1);
  });

  it('notification_preferences has an index on user_id', async () => {
    const rows = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname FROM pg_indexes
             WHERE tablename = 'notification_preferences'
               AND indexname = 'idx_notification_preferences_user_id'`,
      );
    });
    expect(rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Booleans default correctly (FALSE for checklist, TRUE for preferences)
// ---------------------------------------------------------------------------

describe('onboarding tables — boolean defaults', () => {
  it('onboarding_checklist booleans all default to FALSE', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const rows = await runAsUser(userId, async (db) => {
      await db.insert(onboardingChecklist).values({ userId });
      return db.select().from(onboardingChecklist);
    });

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.profileCompleted).toBe(false);
    expect(row.firstPatientAdded).toBe(false);
    expect(row.firstSessionScheduled).toBe(false);
    expect(row.whatsappConnected).toBe(false);
    expect(row.firstEvolutionRecorded).toBe(false);
    expect(row.billingConfigured).toBe(false);
    expect(row.aiTranscriptionTried).toBe(false);
  });

  it('notification_preferences booleans all default to TRUE', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const rows = await runAsUser(userId, async (db) => {
      await db.insert(notificationPreferences).values({ userId });
      return db.select().from(notificationPreferences);
    });

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.emailDaily).toBe(true);
    expect(row.emailWeekly).toBe(true);
    expect(row.emailCritical).toBe(true);
    expect(row.inAppSound).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// UNIQUE(user_id) — duplicate insert rejected
// ---------------------------------------------------------------------------

describe('onboarding tables — UNIQUE(user_id)', () => {
  it('onboarding_checklist rejects a second row for the same user', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(onboardingChecklist).values({ userId });
    });

    await expect(
      runAsService(async (db) => {
        await db.insert(onboardingChecklist).values({ userId });
      }),
    ).rejects.toThrow();
  });

  it('notification_preferences rejects a second row for the same user', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(notificationPreferences).values({ userId });
    });

    await expect(
      runAsService(async (db) => {
        await db.insert(notificationPreferences).values({ userId });
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant RLS isolation — onboarding_checklist
// ---------------------------------------------------------------------------

describe('onboarding_checklist RLS — cross-tenant isolation', () => {
  it('user B cannot SELECT user A checklist', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    await runAsService(async (db) => {
      await db.insert(onboardingChecklist).values({ userId: userA });
    });

    const rows = await runAsUser(userB, async (db) => {
      return db.select().from(onboardingChecklist);
    });
    expect(rows).toHaveLength(0);
  });

  it('user B cannot INSERT a checklist forging user_id = A.id', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    await expect(
      runAsUser(userB, async (db) => {
        await db.insert(onboardingChecklist).values({ userId: userA });
      }),
    ).rejects.toThrow();
  });

  it('user B cannot UPDATE user A checklist', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    await runAsService(async (db) => {
      await db.insert(onboardingChecklist).values({ userId: userA });
    });

    // RLS silently filters — no rows matched for user B.
    await runAsUser(userB, async (db) => {
      await db
        .update(onboardingChecklist)
        .set({ profileCompleted: true })
        .where(eq(onboardingChecklist.userId, userA));
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(onboardingChecklist).where(eq(onboardingChecklist.userId, userA));
    });
    expect(rows[0]!.profileCompleted).toBe(false);
  });

  it('user A can SELECT and UPDATE only their own checklist', async () => {
    const userA = randomUUID();
    await seedAuthUser(userA);

    await runAsService(async (db) => {
      await db.insert(onboardingChecklist).values({ userId: userA });
    });

    await runAsUser(userA, async (db) => {
      await db
        .update(onboardingChecklist)
        .set({ profileCompleted: true })
        .where(eq(onboardingChecklist.userId, userA));
    });

    const rows = await runAsUser(userA, async (db) => {
      return db.select().from(onboardingChecklist);
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(userA);
    expect(rows[0]!.profileCompleted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant RLS isolation — notification_preferences
// ---------------------------------------------------------------------------

describe('notification_preferences RLS — cross-tenant isolation', () => {
  it('user B cannot SELECT user A preferences', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    await runAsService(async (db) => {
      await db.insert(notificationPreferences).values({ userId: userA });
    });

    const rows = await runAsUser(userB, async (db) => {
      return db.select().from(notificationPreferences);
    });
    expect(rows).toHaveLength(0);
  });

  it('user B cannot INSERT preferences forging user_id = A.id', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    await expect(
      runAsUser(userB, async (db) => {
        await db.insert(notificationPreferences).values({ userId: userA });
      }),
    ).rejects.toThrow();
  });

  it('user B cannot UPDATE user A preferences', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    await runAsService(async (db) => {
      await db.insert(notificationPreferences).values({ userId: userA });
    });

    await runAsUser(userB, async (db) => {
      await db
        .update(notificationPreferences)
        .set({ emailDaily: false })
        .where(eq(notificationPreferences.userId, userA));
    });

    const rows = await runAsService(async (db) => {
      return db
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, userA));
    });
    expect(rows[0]!.emailDaily).toBe(true);
  });

  it('user A can SELECT and UPDATE only their own preferences', async () => {
    const userA = randomUUID();
    await seedAuthUser(userA);

    await runAsService(async (db) => {
      await db.insert(notificationPreferences).values({ userId: userA });
    });

    await runAsUser(userA, async (db) => {
      await db
        .update(notificationPreferences)
        .set({ emailDaily: false })
        .where(eq(notificationPreferences.userId, userA));
    });

    const rows = await runAsUser(userA, async (db) => {
      return db.select().from(notificationPreferences);
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(userA);
    expect(rows[0]!.emailDaily).toBe(false);
  });
});
