import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/modules/notifications';
import { notifications } from '@/shared/db/schema/notifications/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Insert an `auth.users` row. The `handle_new_user()` SECURITY DEFINER trigger
// materializes the matching `public.profiles` row from `raw_user_meta_data`, so
// the required metadata fields MUST be present. `crp_number` is sliced from the
// UUID so two seeded users never collide on the CRP unique constraint.
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

// Insert a notification (service-role, mirrors how `notify()` writes from jobs).
// Returns the new id.
async function seedNotification(
  userId: string,
  overrides: { type?: string; title?: string; read?: boolean } = {},
): Promise<string> {
  return runAsService(async (db) => {
    const [row] = await db
      .insert(notifications)
      .values({
        userId,
        type: overrides.type ?? 'session_confirmed',
        title: overrides.title ?? 'Sessão confirmada',
        readAt: overrides.read ? new Date() : null,
      })
      .returning({ id: notifications.id });
    if (!row) throw new Error('seedNotification: no row returned');
    return row.id;
  });
}

async function readNotificationReadAt(id: string): Promise<Date | null> {
  const rows = await runAsService((db) =>
    db.execute(dsql`SELECT read_at FROM notifications WHERE id = ${id}`),
  );
  const value = (rows[0] as { read_at: string | null } | undefined)?.read_at;
  return value ? new Date(value) : null;
}

function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- static fake
      getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
    },
  } as Parameters<typeof listNotifications>[0];
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await cleanTestData();
});

afterEach(async () => {
  await cleanTestData();
});

afterAll(async () => {
  await cleanTestData();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('notifications read actions — real Postgres', () => {
  describe('listNotifications', () => {
    it('returns UNAUTHORIZED when there is no session', async () => {
      const result = await listNotifications(fakeSupabaseClient(null));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('UNAUTHORIZED');
    });

    it('is owner-scoped: returns only the caller’s notifications', async () => {
      const userA = randomUUID();
      const userB = randomUUID();
      await seedAuthUser(userA);
      await seedAuthUser(userB);
      await seedNotification(userA, { title: 'A-1' });
      await seedNotification(userA, { title: 'A-2' });
      await seedNotification(userB, { title: 'B-1' });

      const result = await listNotifications(fakeSupabaseClient(userA));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.notifications).toHaveLength(2);
      expect(result.notifications.every((n) => n.title.startsWith('A-'))).toBe(true);
    });
  });

  describe('getUnreadCount', () => {
    it('returns UNAUTHORIZED when there is no session', async () => {
      const result = await getUnreadCount(fakeSupabaseClient(null));
      expect(result.ok).toBe(false);
    });

    it('counts only the caller’s unread notifications', async () => {
      const userA = randomUUID();
      const userB = randomUUID();
      await seedAuthUser(userA);
      await seedAuthUser(userB);
      await seedNotification(userA, { read: false });
      await seedNotification(userA, { read: false });
      await seedNotification(userA, { read: true });
      await seedNotification(userB, { read: false });

      const result = await getUnreadCount(fakeSupabaseClient(userA));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.count).toBe(2);
    });
  });

  describe('markNotificationRead', () => {
    it('returns INVALID_INPUT for a non-UUID id (rejected at boundary)', async () => {
      const userA = randomUUID();
      await seedAuthUser(userA);

      const result = await markNotificationRead(fakeSupabaseClient(userA), { id: 'not-a-uuid' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('INVALID_INPUT');
    });

    it('returns UNAUTHORIZED before validating input when there is no session', async () => {
      const result = await markNotificationRead(fakeSupabaseClient(null), { id: 'not-a-uuid' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('UNAUTHORIZED');
    });

    it('marks the caller’s own notification as read', async () => {
      const userA = randomUUID();
      await seedAuthUser(userA);
      const id = await seedNotification(userA, { read: false });

      const result = await markNotificationRead(fakeSupabaseClient(userA), { id });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.updated).toBe(true);
      expect(await readNotificationReadAt(id)).toBeInstanceOf(Date);
    });

    it('IDOR proof: user B marking user A’s notification affects zero rows', async () => {
      const userA = randomUUID();
      const userB = randomUUID();
      await seedAuthUser(userA);
      await seedAuthUser(userB);
      const aNotificationId = await seedNotification(userA, { read: false });

      // B authenticates and tries to mark A's notification using A's id.
      const result = await markNotificationRead(fakeSupabaseClient(userB), {
        id: aNotificationId,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // No row matched the `id AND user_id = B` predicate.
      expect(result.updated).toBe(false);

      // A's notification is untouched — still unread.
      expect(await readNotificationReadAt(aNotificationId)).toBeNull();
    });
  });

  describe('markAllNotificationsRead', () => {
    it('returns UNAUTHORIZED when there is no session', async () => {
      const result = await markAllNotificationsRead(fakeSupabaseClient(null));
      expect(result.ok).toBe(false);
    });

    it('scopes to auth.uid(): marks only the caller’s unread rows', async () => {
      const userA = randomUUID();
      const userB = randomUUID();
      await seedAuthUser(userA);
      await seedAuthUser(userB);
      await seedNotification(userA, { read: false });
      await seedNotification(userA, { read: false });
      const bUnread = await seedNotification(userB, { read: false });

      const result = await markAllNotificationsRead(fakeSupabaseClient(userA));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.updated).toBe(2);

      // A has zero unread left; B's notification is untouched.
      const aLeft = await getUnreadCount(fakeSupabaseClient(userA));
      expect(aLeft.ok && aLeft.count).toBe(0);
      expect(await readNotificationReadAt(bUnread)).toBeNull();
    });
  });

  describe('RLS holds at the database layer', () => {
    it('a user cannot SELECT another user’s notifications even with a direct RLS-scoped query', async () => {
      const userA = randomUUID();
      const userB = randomUUID();
      await seedAuthUser(userA);
      await seedAuthUser(userB);
      await seedNotification(userA, { title: 'A-secret' });

      // B connects with their own JWT claims; the SELECT RLS policy
      // (`auth.uid() = user_id`) must filter A's row out entirely.
      const rows = await runAsUser(userB, (db) =>
        db.execute(dsql`SELECT id, user_id FROM notifications`),
      );
      expect(rows.length).toBe(0);

      // A sees their own row under the same policy.
      const aRows = await runAsUser(userA, (db) =>
        db.execute(dsql`SELECT id, user_id FROM notifications`),
      );
      expect(aRows.length).toBe(1);
    });

    it('a user cannot UPDATE another user’s notification under RLS', async () => {
      const userA = randomUUID();
      const userB = randomUUID();
      await seedAuthUser(userA);
      await seedAuthUser(userB);
      const id = await seedNotification(userA, { read: false });

      // B's UPDATE matches zero rows under the RLS UPDATE policy.
      await runAsUser(userB, (db) =>
        db.execute(dsql`UPDATE notifications SET read_at = now() WHERE id = ${id}`),
      );
      expect(await readNotificationReadAt(id)).toBeNull();
    });
  });
});
