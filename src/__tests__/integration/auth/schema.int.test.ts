import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { crpValidationQueue } from '@/shared/db/schema/auth/crp-validation-queue';
import { psychologistProfiles } from '@/shared/db/schema/auth/psychologist-profiles';

import { psychologistProfileFactory } from '../factories/psychologist-profiles';
import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

// Insert a row into the bootstrap-stub `auth.users` table so FKs to
// `auth.users(id)` are satisfiable in the integration container. The
// production Supabase Auth flow handles this; in tests we drive it manually
// via the service-role connection (which bypasses RLS).
async function seedAuthUser(userId: string, email = `${userId}@example.com`): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      sql`INSERT INTO auth.users (id, email, raw_app_meta_data)
          VALUES (${userId}, ${email}, '{}'::jsonb)
          ON CONFLICT (id) DO NOTHING`,
    );
  });
}

afterEach(async () => {
  // Clean up in dependency order. The trigger on `psychologist_profiles`
  // uses SECURITY DEFINER, so the service-role connection (which bypasses
  // RLS) is the right channel for teardown.
  await runAsService(async (db) => {
    await db.delete(crpValidationQueue);
    await db.delete(psychologistProfiles);
    await db.execute(sql`DELETE FROM auth.users`);
  });
});

describe('psychologist_profiles — schema constraints', () => {
  it('accepts a row with every required field', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const profile = psychologistProfileFactory.build({ userId });

    await runAsService(async (db) => {
      await db.insert(psychologistProfiles).values(profile);
    });

    const rows = await runAsService(async (db) =>
      db.select().from(psychologistProfiles).where(eq(psychologistProfiles.userId, userId)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('pending_verification');
  });

  it('rejects an unknown status via the CHECK constraint', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    // Drizzle wraps the underlying postgres error and exposes the original
    // driver error as `.cause`. We assert on the wrapped error's `.cause` to
    // pin the actual Postgres error code (`23514` is `check_violation`)
    // rather than the human message, which can vary across server versions.
    let caught: unknown;
    try {
      await runAsService(async (db) => {
        await db.execute(
          sql`INSERT INTO psychologist_profiles
              (user_id, full_name, crp_number, crp_uf, status,
               terms_accepted_at, privacy_accepted_at, sensitive_data_consent_at,
               terms_version, privacy_version, sensitive_data_consent_version)
              VALUES (${userId}, 'Dra. Banana', '123456', 'SP', 'banana',
                      now(), now(), now(),
                      '2026-05', '2026-05', '2026-05')`,
        );
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    const cause = (caught as Error & { cause?: { code?: string; constraint_name?: string } }).cause;
    expect(cause?.code).toBe('23514');
    expect(cause?.constraint_name).toBe('psychologist_profiles_status_check');
  });

  it('rejects a duplicate (crp_number, crp_uf) via the UNIQUE constraint', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    await runAsService(async (db) => {
      await db
        .insert(psychologistProfiles)
        .values(psychologistProfileFactory.build({ userId: userA, crpNumber: '06/123456' }));
    });

    let caught: unknown;
    try {
      await runAsService(async (db) => {
        await db
          .insert(psychologistProfiles)
          .values(psychologistProfileFactory.build({ userId: userB, crpNumber: '06/123456' }));
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    // 23505 is `unique_violation`; the constraint name is the one declared in
    // the Drizzle schema (`psychologist_profiles_crp_number_crp_uf_key`).
    const cause = (caught as Error & { cause?: { code?: string; constraint_name?: string } }).cause;
    expect(cause?.code).toBe('23505');
    expect(cause?.constraint_name).toBe('psychologist_profiles_crp_number_crp_uf_key');
  });

  it('allows the same crp_number with a different crp_uf', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    await runAsService(async (db) => {
      await db
        .insert(psychologistProfiles)
        .values([
          psychologistProfileFactory.build({ userId: userA, crpNumber: '123456', crpUf: 'SP' }),
          psychologistProfileFactory.build({ userId: userB, crpNumber: '123456', crpUf: 'RJ' }),
        ]);
    });

    const rows = await runAsService(async (db) => db.select().from(psychologistProfiles));
    expect(rows).toHaveLength(2);
  });
});

describe('psychologist_profiles — bookkeeping triggers', () => {
  it('advances updated_at on a non-status update without touching status_changed_at', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await runAsService(async (db) => {
      await db.insert(psychologistProfiles).values(psychologistProfileFactory.build({ userId }));
    });

    const before = await runAsService(async (db) =>
      db.select().from(psychologistProfiles).where(eq(psychologistProfiles.userId, userId)),
    );
    expect(before).toHaveLength(1);
    const original = before[0]!;

    // Sleep at least 5 ms so timestamp deltas are observable on fast hosts
    // (timestamptz has microsecond resolution but `now()` is called once per
    // statement, so two adjacent statements can return the same value).
    await new Promise((resolve) => setTimeout(resolve, 10));

    await runAsService(async (db) => {
      await db
        .update(psychologistProfiles)
        .set({ fullName: 'Dra. Atualizada' })
        .where(eq(psychologistProfiles.userId, userId));
    });

    const after = await runAsService(async (db) =>
      db.select().from(psychologistProfiles).where(eq(psychologistProfiles.userId, userId)),
    );
    const updated = after[0]!;

    expect(updated.fullName).toBe('Dra. Atualizada');
    expect(updated.updatedAt.getTime()).toBeGreaterThan(original.updatedAt.getTime());
    expect(updated.statusChangedAt.getTime()).toBe(original.statusChangedAt.getTime());
  });

  it('advances both updated_at and status_changed_at on a status transition, and mirrors status into auth.users.raw_app_meta_data', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await runAsService(async (db) => {
      await db.insert(psychologistProfiles).values(psychologistProfileFactory.build({ userId }));
    });

    const before = await runAsService(async (db) =>
      db.select().from(psychologistProfiles).where(eq(psychologistProfiles.userId, userId)),
    );
    const original = before[0]!;

    await new Promise((resolve) => setTimeout(resolve, 10));

    await runAsService(async (db) => {
      await db
        .update(psychologistProfiles)
        .set({ status: 'pending_crp_validation' })
        .where(eq(psychologistProfiles.userId, userId));
    });

    const after = await runAsService(async (db) =>
      db.select().from(psychologistProfiles).where(eq(psychologistProfiles.userId, userId)),
    );
    const updated = after[0]!;

    expect(updated.status).toBe('pending_crp_validation');
    expect(updated.updatedAt.getTime()).toBeGreaterThan(original.updatedAt.getTime());
    expect(updated.statusChangedAt.getTime()).toBeGreaterThan(original.statusChangedAt.getTime());

    // The AFTER UPDATE OF status trigger calls `set_app_metadata`, which
    // merges `account_status` into `auth.users.raw_app_meta_data`.
    const metaRows = await runAsService(async (db) =>
      db.execute<{ account_status: string }>(
        sql`SELECT raw_app_meta_data->>'account_status' AS account_status
            FROM auth.users WHERE id = ${userId}`,
      ),
    );
    expect(metaRows[0]?.account_status).toBe('pending_crp_validation');
  });
});

describe('psychologist_profiles — RLS', () => {
  it('returns only the caller’s own row when scoped to an authenticated JWT', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    await runAsService(async (db) => {
      await db
        .insert(psychologistProfiles)
        .values([
          psychologistProfileFactory.build({ userId: userA, crpUf: 'SP' }),
          psychologistProfileFactory.build({ userId: userB, crpUf: 'RJ' }),
        ]);
    });

    const visibleToA = await runAsUser(userA, async (db) => db.select().from(psychologistProfiles));
    expect(visibleToA).toHaveLength(1);
    expect(visibleToA[0]?.userId).toBe(userA);

    const visibleToB = await runAsUser(userB, async (db) => db.select().from(psychologistProfiles));
    expect(visibleToB).toHaveLength(1);
    expect(visibleToB[0]?.userId).toBe(userB);
  });
});

describe('crp_validation_queue — RLS (admin-only)', () => {
  it('hides queue rows from authenticated users even when the row is theirs', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(crpValidationQueue).values({
        userId,
        crpNumber: '123456',
        crpUf: 'SP',
      });
    });

    const visibleToUser = await runAsUser(userId, async (db) =>
      db.select().from(crpValidationQueue).where(eq(crpValidationQueue.userId, userId)),
    );
    expect(visibleToUser).toEqual([]);
  });

  it('lets the service-role connection see and update queue rows', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const queueRow = await runAsService(async (db) => {
      const inserted = await db
        .insert(crpValidationQueue)
        .values({ userId, crpNumber: '654321', crpUf: 'MG' })
        .returning();
      return inserted[0]!;
    });

    expect(queueRow.status).toBe('pending');

    await runAsService(async (db) => {
      await db
        .update(crpValidationQueue)
        .set({ status: 'approved', decidedAt: new Date(), decidedBy: userId })
        .where(
          and(eq(crpValidationQueue.id, queueRow.id), eq(crpValidationQueue.status, 'pending')),
        );
    });

    const after = await runAsService(async (db) =>
      db.select().from(crpValidationQueue).where(eq(crpValidationQueue.id, queueRow.id)),
    );
    expect(after[0]?.status).toBe('approved');
  });
});
