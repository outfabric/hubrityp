import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { authLogs } from '@/shared/db/schema/auth/tables';

import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

// Tests for `public.purge_old_auth_logs()` — SECURITY DEFINER function that
// deletes auth_logs entries older than 6 months and returns the count of
// deleted rows. Not executable by `authenticated` or `anon` roles.

afterEach(async () => {
  await runAsService(async (db) => {
    await db.execute(dsql`DELETE FROM auth_logs`);
    await db.execute(dsql`DELETE FROM auth.users`);
  });
});

describe('purge_old_auth_logs() (integration)', () => {
  it('deletes logs older than 6 months, keeps recent ones, returns deleted count', async () => {
    const userId = randomUUID();

    await runAsService(async (db) => {
      // Create a user with an OAuth provider so the trigger skips profile
      // creation (we only need auth_logs rows for this test).
      await db.execute(
        dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
             VALUES (${userId}, 'purge-test@test.local', '{"provider":"google"}'::jsonb)`,
      );

      // Insert 10 logs older than 6 months
      for (let i = 0; i < 10; i++) {
        await db.insert(authLogs).values({
          userId,
          event: 'login_success',
          metadata: { index: i },
          createdAt: new Date('2024-01-01T00:00:00Z'), // well beyond 6 months ago
        });
      }

      // Insert 5 recent logs
      for (let i = 0; i < 5; i++) {
        await db.insert(authLogs).values({
          userId,
          event: 'login_success',
          metadata: { index: i, recent: true },
          // created_at defaults to now(), which is recent
        });
      }
    });

    // Call the function as service role (postgres superuser)
    const result = await runAsService(async (db) => {
      const rows = await db.execute(dsql`SELECT public.purge_old_auth_logs() AS count`);
      return rows;
    });

    expect(result[0]!.count).toBe(10);

    // Verify only recent logs remain
    const remaining = await runAsService(async (db) => db.select().from(authLogs));
    expect(remaining).toHaveLength(5);
    for (const row of remaining) {
      expect((row.metadata as { recent?: boolean }).recent).toBe(true);
    }
  });

  it('returns 0 when auth_logs table is empty', async () => {
    const result = await runAsService(async (db) => {
      const rows = await db.execute(dsql`SELECT public.purge_old_auth_logs() AS count`);
      return rows;
    });

    expect(result[0]!.count).toBe(0);
  });

  it('authenticated user cannot call purge_old_auth_logs() (no EXECUTE privilege)', async () => {
    const userId = randomUUID();

    await runAsService(async (db) => {
      // Create user with OAuth provider to skip trigger profile creation;
      // we only need the user_id for the JWT claims context.
      await db.execute(
        dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
             VALUES (${userId}, 'noexec@test.local', '{"provider":"google"}'::jsonb)`,
      );
    });

    // Attempt to call from authenticated user context. The REVOKE blocks
    // execution for `authenticated`. postgres-js may wrap the underlying
    // "permission denied" differently across versions, so we test the
    // behavioural outcome: an error is thrown.
    let caught: unknown = null;
    try {
      await runAsUser(userId, async (db) => {
        await db.execute(dsql`SELECT public.purge_old_auth_logs()`);
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    // The underlying PostgresError should mention "permission denied"
    const msg = (caught as Error).message + ((caught as { cause?: Error }).cause?.message ?? '');
    expect(msg.toLowerCase()).toContain('permission denied');
  });
});
