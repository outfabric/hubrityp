import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { markOldNotificationsRead } from '@/modules/notifications/inngest/auto-read-old';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Insert an `auth.users` row so the FK + handle_new_user() trigger are satisfied.
// `crp_number` is sliced from the UUID to avoid colliding on the CRP unique
// constraint across seeded users.
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

// Insert a notification (service-role) with an explicit `created_at` and read
// state. `ageDays` shifts `created_at` into the past via a Postgres interval so
// the test does not depend on application-clock arithmetic. Returns the new id.
async function seedNotification(
  userId: string,
  options: { ageDays: number; read?: boolean; title?: string },
): Promise<string> {
  return runAsService(async (db) => {
    const rows = await db.execute<{ id: string }>(
      dsql`INSERT INTO notifications (user_id, type, title, read_at, created_at)
           VALUES (
             ${userId},
             'session_confirmed',
             ${options.title ?? 'Sessão confirmada'},
             ${options.read ? dsql`now()` : dsql`NULL`},
             now() - make_interval(days => ${options.ageDays})
           )
           RETURNING id`,
    );
    const id = rows[0]?.id;
    if (!id) throw new Error('seedNotification: no row returned');
    return id;
  });
}

async function readNotificationReadAt(id: string): Promise<Date | null> {
  const rows = await runAsService((db) =>
    db.execute(dsql`SELECT read_at FROM notifications WHERE id = ${id}`),
  );
  const value = (rows[0] as { read_at: string | null } | undefined)?.read_at;
  return value ? new Date(value) : null;
}

async function rowExists(id: string): Promise<boolean> {
  const rows = await runAsService((db) =>
    db.execute(dsql`SELECT 1 FROM notifications WHERE id = ${id}`),
  );
  return rows.length > 0;
}

async function countAllNotifications(): Promise<number> {
  const rows = await runAsService((db) =>
    db.execute<{ count: number }>(dsql`SELECT count(*)::int AS count FROM notifications`),
  );
  return rows[0]?.count ?? 0;
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

describe('auto-read-old notifications cron — real Postgres', () => {
  it('marks a 31-day-old unread notification as read', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const oldId = await seedNotification(userId, { ageDays: 31, read: false });

    const readCount = await runAsService((db) => markOldNotificationsRead({ db }));

    expect(readCount).toBe(1);
    expect(await readNotificationReadAt(oldId)).toBeInstanceOf(Date);
  });

  it('leaves a recent unread notification untouched', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const recentId = await seedNotification(userId, { ageDays: 3, read: false });

    const readCount = await runAsService((db) => markOldNotificationsRead({ db }));

    expect(readCount).toBe(0);
    expect(await readNotificationReadAt(recentId)).toBeNull();
  });

  it('does not re-touch an already-read old notification', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const alreadyReadOldId = await seedNotification(userId, { ageDays: 40, read: true });

    const readCount = await runAsService((db) => markOldNotificationsRead({ db }));

    // The row was already read, so the `read_at IS NULL` predicate excludes it.
    expect(readCount).toBe(0);
    expect(await readNotificationReadAt(alreadyReadOldId)).toBeInstanceOf(Date);
  });

  it('never deletes rows — every seeded notification still exists afterwards', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const oldUnread = await seedNotification(userId, { ageDays: 45, read: false });
    const recentUnread = await seedNotification(userId, { ageDays: 1, read: false });
    const oldRead = await seedNotification(userId, { ageDays: 50, read: true });

    const before = await countAllNotifications();
    await runAsService((db) => markOldNotificationsRead({ db }));
    const after = await countAllNotifications();

    expect(after).toBe(before);
    expect(await rowExists(oldUnread)).toBe(true);
    expect(await rowExists(recentUnread)).toBe(true);
    expect(await rowExists(oldRead)).toBe(true);
  });

  it('is multi-user / system-wide: auto-reads old unread rows across all users', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    const aOld = await seedNotification(userA, { ageDays: 31, read: false, title: 'A-old' });
    const bOld = await seedNotification(userB, { ageDays: 60, read: false, title: 'B-old' });
    const aRecent = await seedNotification(userA, { ageDays: 2, read: false, title: 'A-recent' });

    const readCount = await runAsService((db) => markOldNotificationsRead({ db }));

    expect(readCount).toBe(2);
    expect(await readNotificationReadAt(aOld)).toBeInstanceOf(Date);
    expect(await readNotificationReadAt(bOld)).toBeInstanceOf(Date);
    expect(await readNotificationReadAt(aRecent)).toBeNull();
  });
});
