import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { psychologistProfileFactory } from '@/__tests__/integration/factories/psychologist-profiles';
import { runAsService } from '@/__tests__/integration/setup/run-as-service';
import { applyTransition } from '@/modules/account-lifecycle';
import { db as appDb } from '@/shared/db/client';
import { crpValidationQueue } from '@/shared/db/schema/auth/crp-validation-queue';
import { psychologistProfiles } from '@/shared/db/schema/auth/psychologist-profiles';

// Seed a row in the bootstrap-stub `auth.users` table so the FK from
// `psychologist_profiles.user_id` resolves. Mirrors the helper used by
// `auth/schema.int.test.ts`.
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

describe('applyTransition (integration)', () => {
  it('persists the new status and advances bookkeeping when the transition is valid', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(psychologistProfiles).values(
        psychologistProfileFactory.build({
          userId,
          status: 'pending_verification',
        }),
      );
    });

    const before = await runAsService(async (db) =>
      db.select().from(psychologistProfiles).where(eq(psychologistProfiles.userId, userId)),
    );
    expect(before).toHaveLength(1);
    const original = before[0]!;

    // Sleep so the timestamps the trigger writes are observably newer than
    // the row's original `created_at`/`status_changed_at`.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const result = await applyTransition(userId, 'email_verified');
    expect(result).toEqual({ ok: true, status: 'pending_crp_validation' });

    const after = await runAsService(async (db) =>
      db.select().from(psychologistProfiles).where(eq(psychologistProfiles.userId, userId)),
    );
    const updated = after[0]!;

    expect(updated.status).toBe('pending_crp_validation');
    expect(updated.statusChangedAt.getTime()).toBeGreaterThan(original.statusChangedAt.getTime());
    expect(updated.updatedAt.getTime()).toBeGreaterThan(original.updatedAt.getTime());

    // The AFTER UPDATE OF status trigger calls `set_app_metadata`, which
    // mirrors the new value into `auth.users.raw_app_meta_data`. The
    // middleware reads this field through the JWT.
    const meta = await runAsService(async (db) =>
      db.execute<{ account_status: string }>(
        sql`SELECT raw_app_meta_data->>'account_status' AS account_status
            FROM auth.users WHERE id = ${userId}`,
      ),
    );
    expect(meta[0]?.account_status).toBe('pending_crp_validation');
  });

  it('returns invalid_transition without writing when the (status, event) pair is illegal', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(psychologistProfiles).values(
        psychologistProfileFactory.build({
          userId,
          status: 'active',
        }),
      );
    });

    const before = await runAsService(async (db) =>
      db.select().from(psychologistProfiles).where(eq(psychologistProfiles.userId, userId)),
    );
    const original = before[0]!;

    // `email_verified` is only valid from `pending_verification`.
    const result = await applyTransition(userId, 'email_verified');
    expect(result).toEqual({ ok: false, error: 'invalid_transition' });

    const after = await runAsService(async (db) =>
      db.select().from(psychologistProfiles).where(eq(psychologistProfiles.userId, userId)),
    );
    const unchanged = after[0]!;

    expect(unchanged.status).toBe('active');
    // Both timestamps unchanged: no UPDATE was issued.
    expect(unchanged.statusChangedAt.getTime()).toBe(original.statusChangedAt.getTime());
    expect(unchanged.updatedAt.getTime()).toBe(original.updatedAt.getTime());
  });

  it('returns profile_not_found when the user has no profile row', async () => {
    const unknownUserId = randomUUID();

    const result = await applyTransition(unknownUserId, 'email_verified');
    expect(result).toEqual({ ok: false, error: 'profile_not_found' });

    // Defensive: confirm no row was created as a side effect.
    const rows = await runAsService(async (db) =>
      db.select().from(psychologistProfiles).where(eq(psychologistProfiles.userId, unknownUserId)),
    );
    expect(rows).toEqual([]);
  });

  // Regression test for the deadlock that broke the CRP approve/reject
  // integration tests: with `postgres({ max: 1 })`, opening a NEW
  // `db.transaction` inside an outer transaction (the caller's) blocks
  // forever — the inner call waits for a connection the outer holds, while
  // the outer holds a row lock on `psychologist_profiles`. The fix is for
  // `applyTransition` to accept an optional `tx` and reuse it. These tests
  // exercise that contract end-to-end.
  describe('caller-managed transaction', () => {
    it('reuses the outer tx when one is supplied (no deadlock) and commits both writes together', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId);

      await runAsService(async (db) => {
        await db.insert(psychologistProfiles).values(
          psychologistProfileFactory.build({
            userId,
            status: 'pending_verification',
            crpUf: 'SP',
          }),
        );
      });

      // Caller opens its own transaction, takes a row lock on the profile
      // (UPDATE), then asks `applyTransition` to advance the lifecycle.
      // Pre-fix: this call would hang on the row-lock until the test timed
      // out at 30s. Post-fix: the inner helper reuses the outer `tx` and
      // both writes commit together.
      const happyResult = await appDb.transaction(async (tx) => {
        await tx
          .update(psychologistProfiles)
          .set({ crpUf: 'RJ' })
          .where(eq(psychologistProfiles.userId, userId));
        return await applyTransition(userId, 'email_verified', tx);
      });
      expect(happyResult).toEqual({ ok: true, status: 'pending_crp_validation' });

      const profiles = await runAsService(async (db) =>
        db.select().from(psychologistProfiles).where(eq(psychologistProfiles.userId, userId)),
      );
      // Both the caller's UPDATE and the helper's status transition are
      // visible after commit.
      expect(profiles[0]!.status).toBe('pending_crp_validation');
      expect(profiles[0]!.crpUf).toBe('RJ');
    });

    it('rolls back the lifecycle write together with the outer write when the caller throws', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId);

      await runAsService(async (db) => {
        await db.insert(psychologistProfiles).values(
          psychologistProfileFactory.build({
            userId,
            status: 'pending_verification',
            crpUf: 'SP',
          }),
        );
      });

      class CallerSideRollback extends Error {}

      await expect(
        appDb.transaction(async (tx) => {
          // Caller writes BEFORE the lifecycle transition. If `applyTransition`
          // had opened its own transaction, this write would have been
          // committed independently and the rollback below would not undo it.
          await tx
            .update(psychologistProfiles)
            .set({ crpUf: 'MG' })
            .where(eq(psychologistProfiles.userId, userId));

          const stepResult = await applyTransition(userId, 'email_verified', tx);
          expect(stepResult).toEqual({ ok: true, status: 'pending_crp_validation' });

          // Caller decides the operation is invalid and throws — Drizzle
          // signals the postgres-js driver to ROLLBACK the outer
          // transaction, which MUST also undo the helper's UPDATE.
          throw new CallerSideRollback('caller decided to abort');
        }),
      ).rejects.toBeInstanceOf(CallerSideRollback);

      const afterRollback = await runAsService(async (db) =>
        db.select().from(psychologistProfiles).where(eq(psychologistProfiles.userId, userId)),
      );
      // Pristine: status is still `pending_verification`, crpUf still `SP`.
      // Both writes inside the rolled-back transaction are gone.
      expect(afterRollback[0]!.status).toBe('pending_verification');
      expect(afterRollback[0]!.crpUf).toBe('SP');
    });
  });
});
