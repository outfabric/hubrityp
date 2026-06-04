/**
 * Integration test for the notifications Realtime subscriber
 * (`useNotificationsRealtime`, mounted via `<NotificationBellBoundary>`).
 *
 * The client subscribes to `postgres_changes` (INSERT) on `public.notifications`
 * with the channel filter `user_id=eq.<owner>`. Supabase Realtime authorizes the
 * rows it streams through the table's RLS SELECT policy (`auth.uid() = user_id`)
 * AND the channel filter — both scope to the owner. So the owner-filter contract
 * the subscriber depends on is, at the database layer, exactly the RLS SELECT
 * policy: a row INSERTed for the owner is visible to the owner, and a row
 * INSERTed for another user is NOT visible to that other user.
 *
 * The Testcontainers setup (`postgres:15`) provides the database engine but NOT
 * the full Supabase stack (the Realtime WebSocket server, GoTrue). A faithful
 * end-to-end subscribe -> insert -> assert-event flow therefore cannot run here
 * (same constraint documented in
 * `src/__tests__/integration/ai-transcription/realtime-subscriber.int.test.ts`).
 * That WebSocket flow is captured below as a documented `describe.skip`, to be
 * unskipped if a full local Supabase stack (`supabase start`) becomes available
 * in CI.
 *
 * What we CAN and DO prove here against real Postgres with the real schema +
 * RLS applied: the owner-filter the Realtime channel relies on. This is the
 * load-bearing security property — that a client never receives another user's
 * rows — exercised at the layer that actually enforces it.
 *
 * The client hook itself (channel name `notifications:<userId>`, the
 * `postgres_changes` INSERT binding with `filter: user_id=eq.<userId>`, the
 * `onInsert` count-bump, and channel teardown on unmount) is covered by the
 * unit test
 * (`src/__tests__/unit/modules/notifications/hooks/use-notifications-realtime.test.ts`).
 */

import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { notifications } from '@/shared/db/schema/notifications/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

// ---------------------------------------------------------------------------
// Helpers (mirror notifications/read-actions.int.test.ts)
// ---------------------------------------------------------------------------

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

// Insert a notification the way a background job (Inngest `notify()`) does:
// service-role, bypassing RLS — this is the write that, in production, the
// Realtime server picks up from logical replication and fans out to subscribers.
async function insertNotificationForOwner(userId: string, title: string): Promise<string> {
  return runAsService(async (db) => {
    const [row] = await db
      .insert(notifications)
      .values({ userId, type: 'session_confirmed', title })
      .returning({ id: notifications.id });
    if (!row) throw new Error('insertNotificationForOwner: no row returned');
    return row.id;
  });
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
// Owner-filter proof (database layer that Realtime authorizes through)
// ---------------------------------------------------------------------------

describe('notifications realtime owner-filter — real Postgres + RLS', () => {
  it('a new notification INSERTed for the owner is visible to the owner (event would be delivered)', async () => {
    const owner = randomUUID();
    await seedAuthUser(owner);

    const id = await insertNotificationForOwner(owner, 'Sessão confirmada');

    // The owner, under the RLS SELECT policy that Realtime authorizes through,
    // can see the freshly INSERTed row — so a `postgres_changes` INSERT event on
    // the `user_id=eq.<owner>` channel would be delivered to this subscriber.
    const ownerRows = await runAsUser(owner, (db) =>
      db.execute(dsql`SELECT id FROM notifications WHERE user_id = ${owner}`),
    );
    expect(ownerRows.length).toBe(1);
    expect((ownerRows[0] as { id: string }).id).toBe(id);
  });

  it('a notification INSERTed for another user is NOT visible to that user (event NOT delivered)', async () => {
    const owner = randomUUID();
    const other = randomUUID();
    await seedAuthUser(owner);
    await seedAuthUser(other);

    await insertNotificationForOwner(owner, 'A-secret');

    // `other`, subscribing to its own owner-filtered channel, can never SELECT
    // the owner's row under RLS — so the Realtime server never streams it. This
    // is the "events for other psychologists are never delivered" guarantee at
    // the layer that actually enforces it.
    const otherRows = await runAsUser(other, (db) =>
      db.execute(dsql`SELECT id FROM notifications`),
    );
    expect(otherRows.length).toBe(0);

    // And the owner does see exactly their one row.
    const ownerRows = await runAsUser(owner, (db) =>
      db.execute(dsql`SELECT id FROM notifications`),
    );
    expect(ownerRows.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// True end-to-end WebSocket flow (requires full Supabase stack — skipped)
// ---------------------------------------------------------------------------

describe.skip('useNotificationsRealtime — end-to-end via Realtime (requires full Supabase stack)', () => {
  it('bumps the unread count when a real INSERT arrives on the owner channel', () => {
    // Render <NotificationBellBoundary userId={ownerId} initialUnreadCount={0} ...>
    //   with a real browser Supabase client pointed at the local Realtime server.
    // INSERT a notification row for ownerId (service-role).
    // Assert the bell badge transitions 0 -> 1 (the `onInsert` count-bump fires).
  });

  it('does NOT bump the count for an INSERT addressed to another user', () => {
    // Render the boundary for ownerId.
    // INSERT a notification row for a DIFFERENT user.
    // Wait a short timeout; assert the badge stays at its initial value
    //   (the `user_id=eq.<ownerId>` channel filter + RLS exclude the row).
  });
});
