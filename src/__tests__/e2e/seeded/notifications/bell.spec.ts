import { test as base } from '@playwright/test';
import type { Sql } from 'postgres';

import { test, expect } from '../setup/db-fixture';
import { readSeedState, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @notifications -- End-to-end coverage for the app-header notification bell
 * and dropdown (Section 6.1), exercising the full notifications flow against the
 * seeded `active` psychologist.
 *
 * Covered scenarios (in-app-notifications/spec.md):
 *   1. Unread count reflects the owner's notifications only (correct badge).
 *   2. No unread = no badge.
 *   3. Dropdown lists notifications with a per-type icon + relative time.
 *   4. Clicking a notification marks it read and routes to its action target.
 *   5. "Marcar todas como lidas" clears the badge.
 *   6. A post-MVP type (e.g. payment) is rendered inert — no icon, no route,
 *      no payment/Receita/WhatsApp affordance.
 *   7. Anonymous access to /configuracoes/notificacoes redirects to /login
 *      (negative-auth).
 *
 * Isolation: the bell badge reflects the TOTAL unread count for the seed user,
 * so a deterministic assertion requires this spec to OWN the seed user's
 * notifications. No other e2e flow creates `notifications` rows (they are
 * written only by background Inngest jobs, which do not run in the seeded
 * suite), so `beforeEach` safely wipes the seed user's notifications and seeds a
 * known set with reserved UUIDs. The authenticated block runs serially so a
 * parallel worker cannot mutate the shared set mid-test.
 */

// Reserved UUIDs (the `e` space is untouched by any other seed/spec). Each row
// is owned by the seed user and tied to a real seed patient via its actionUrl
// only (the notification table itself has no patient FK).
const NOTIF = {
  unreadConfirmed: '00000000-0000-4000-8000-0000000000e0',
  unreadRisk: '00000000-0000-4000-8000-0000000000e1',
  alreadyRead: '00000000-0000-4000-8000-0000000000e2',
  postMvp: '00000000-0000-4000-8000-0000000000e3',
} as const;

// Deterministic titles so the dropdown rows are unambiguous to locate.
const TITLE = {
  unreadConfirmed: 'Sessão confirmada por Maria Silva',
  unreadRisk: 'Alerta de risco identificado',
  alreadyRead: 'Evolução pendente de João Santos',
  postMvp: 'Pagamento recebido (pós-MVP)',
} as const;

// The action target stored on the confirmed-session notification. A
// server-trusted, path-relative deep-link the click must route to. `/agenda`
// is a gated `(app)` route the active seed user can reach.
const CONFIRMED_ACTION_URL = '/agenda';

/** Wipe + seed the seed user's notifications to a known, deterministic set. */
async function seedNotifications(sql: Sql, userId: string): Promise<void> {
  // Own the seed user's entire notification set for the duration of this spec.
  await sql`DELETE FROM public.notifications WHERE user_id = ${userId}`;

  // 1 — unread, MVP type, with an explicit actionUrl. Newest so it is first.
  await sql`
    INSERT INTO public.notifications (id, user_id, type, title, action_url, read_at, created_at)
    VALUES (
      ${NOTIF.unreadConfirmed}, ${userId}, 'session_confirmed',
      ${TITLE.unreadConfirmed}, ${CONFIRMED_ACTION_URL}, NULL, now() - interval '2 minutes'
    );
  `;

  // 2 — unread, MVP type, no actionUrl (falls back to the per-type default route).
  await sql`
    INSERT INTO public.notifications (id, user_id, type, title, action_url, read_at, created_at)
    VALUES (
      ${NOTIF.unreadRisk}, ${userId}, 'ai_risk_alert',
      ${TITLE.unreadRisk}, NULL, NULL, now() - interval '10 minutes'
    );
  `;

  // 3 — already read, MVP type. Counts toward the list but NOT the unread badge.
  await sql`
    INSERT INTO public.notifications (id, user_id, type, title, action_url, read_at, created_at)
    VALUES (
      ${NOTIF.alreadyRead}, ${userId}, 'evolution_pending',
      ${TITLE.alreadyRead}, NULL, now() - interval '1 hour', now() - interval '1 hour'
    );
  `;

  // 4 — unread, POST-MVP type (not on the allowlist). Must render inert: no
  // icon, no route. Counts toward the unread badge (the badge is type-agnostic),
  // but never becomes a payment/Receita/WhatsApp affordance.
  await sql`
    INSERT INTO public.notifications (id, user_id, type, title, action_url, read_at, created_at)
    VALUES (
      ${NOTIF.postMvp}, ${userId}, 'payment_received',
      ${TITLE.postMvp}, '/cobrancas', NULL, now() - interval '20 minutes'
    );
  `;
}

// ---------------------------------------------------------------------------
// Authenticated (seed user)
// ---------------------------------------------------------------------------

test.describe('@notifications bell (authenticated)', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  // The bell badge is global to the seed user; serial mode keeps the shared
  // notification set stable across this block's tests under fullyParallel.
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ db }) => {
    const seed = await readSeedState();
    await seedNotifications(db.sql, seed.userId);
  });

  test.afterEach(async ({ db }) => {
    const seed = await readSeedState();
    // Leave the seed user with zero notifications so no badge leaks onto the
    // many sibling specs that render the same shell.
    await db.sql`DELETE FROM public.notifications WHERE user_id = ${seed.userId}`;
  });

  test('shows the unread badge with the correct count and opens the dropdown', async ({ page }) => {
    await page.goto('/dashboard');

    // 3 unread (two MVP + one post-MVP); the already-read row does not count.
    const trigger = page.getByRole('button', { name: 'Notificações, 3 não lidas' });
    await expect(trigger).toBeVisible({ timeout: 10_000 });

    // Open the dropdown and assert the rows + relative time render. The Radix
    // menu content mounts in a portal; locate rows by their unique titles.
    await trigger.click();

    // The confirmed-session row shows its title and a relative timestamp.
    const confirmedRow = page.locator('button', { hasText: TITLE.unreadConfirmed });
    await expect(confirmedRow).toBeVisible({ timeout: 10_000 });
    await expect(confirmedRow).toContainText('há 2 min');

    // The risk-alert row also renders (newest-first ordering puts it after).
    await expect(page.getByText(TITLE.unreadRisk)).toBeVisible();

    // The already-read row is present in the list too (read != hidden).
    await expect(page.getByText(TITLE.alreadyRead)).toBeVisible();
  });

  test('renders no badge when there are no unread notifications', async ({ page, db }) => {
    const seed = await readSeedState();
    // Replace the set with a single ALREADY-READ notification → zero unread.
    await db.sql`DELETE FROM public.notifications WHERE user_id = ${seed.userId}`;
    await db.sql`
      INSERT INTO public.notifications (id, user_id, type, title, read_at, created_at)
      VALUES (
        ${NOTIF.alreadyRead}, ${seed.userId}, 'evolution_pending',
        ${TITLE.alreadyRead}, now() - interval '1 hour', now() - interval '1 hour'
      );
    `;

    await page.goto('/dashboard');

    // The accessible name collapses to plain "Notificações" with no count, and
    // there is no "N não lidas" trigger.
    await expect(page.getByRole('button', { name: 'Notificações', exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('button', { name: /não lidas/ })).toHaveCount(0);
  });

  test('clicking a notification marks it read and routes to its action target', async ({
    page,
    db,
  }) => {
    const seed = await readSeedState();

    await page.goto('/dashboard');

    const trigger = page.getByRole('button', { name: 'Notificações, 3 não lidas' });
    await expect(trigger).toBeVisible({ timeout: 10_000 });
    await trigger.click();

    const confirmedRow = page.locator('button', { hasText: TITLE.unreadConfirmed });
    await expect(confirmedRow).toBeVisible({ timeout: 10_000 });

    // Click routes to the stored actionUrl (/agenda) AND fires the
    // fire-and-forget mark-read Server Action. Wait for the navigation, then
    // for the DB write to settle before asserting (the action is fired without
    // awaiting on the client, so we poll the row).
    await confirmedRow.click();
    await page.waitForURL('**/agenda', { timeout: 10_000 });
    expect(new URL(page.url()).pathname).toBe('/agenda');

    // The clicked notification transitioned to read server-side.
    await expect
      .poll(
        async () => {
          const rows = await db.sql`
            SELECT read_at FROM public.notifications WHERE id = ${NOTIF.unreadConfirmed};
          `;
          return rows[0]?.read_at != null;
        },
        { timeout: 10_000 },
      )
      .toBe(true);

    // The other unread rows are untouched — only the clicked one was marked.
    const stillUnread = await db.sql`
      SELECT count(*)::int AS n
      FROM public.notifications
      WHERE user_id = ${seed.userId} AND read_at IS NULL;
    `;
    expect(Number(stillUnread[0]?.n ?? -1)).toBe(2);
  });

  test('"Marcar todas como lidas" clears the badge', async ({ page, db }) => {
    const seed = await readSeedState();

    await page.goto('/dashboard');

    const trigger = page.getByRole('button', { name: 'Notificações, 3 não lidas' });
    await expect(trigger).toBeVisible({ timeout: 10_000 });
    await trigger.click();

    const markAll = page.getByRole('button', { name: 'Marcar todas como lidas' });
    await expect(markAll).toBeVisible({ timeout: 10_000 });
    await markAll.click();

    // Close the open menu so the header trigger leaves the portal's focus trap
    // (Radix marks the rest of the page `aria-hidden` while the menu is open,
    // which would hide the trigger from the accessibility tree).
    await page.keyboard.press('Escape');

    // Optimistic UI: the badge clears immediately — the trigger's accessible
    // name drops the count to plain "Notificações".
    await expect(page.getByRole('button', { name: 'Notificações', exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('button', { name: /não lidas/ })).toHaveCount(0);

    // Authoritative server state: every notification for the owner is now read.
    await expect
      .poll(
        async () => {
          const rows = await db.sql`
            SELECT count(*)::int AS n
            FROM public.notifications
            WHERE user_id = ${seed.userId} AND read_at IS NULL;
          `;
          return Number(rows[0]?.n ?? -1);
        },
        { timeout: 10_000 },
      )
      .toBe(0);
  });

  test('a post-MVP notification type is rendered inert (no icon, no route)', async ({ page }) => {
    await page.goto('/dashboard');

    const trigger = page.getByRole('button', { name: 'Notificações, 3 não lidas' });
    await expect(trigger).toBeVisible({ timeout: 10_000 });
    await trigger.click();

    // The post-MVP row is rendered as an inert <li> (text only), NOT a <button>:
    // it can never be clicked to navigate, so its `/cobrancas` actionUrl is
    // never a reachable affordance.
    const inertRow = page.locator('li[data-notification-type="payment_received"]');
    await expect(inertRow).toBeVisible({ timeout: 10_000 });
    await expect(inertRow).toContainText(TITLE.postMvp);

    // No clickable <button> carries the post-MVP type — the click sink only
    // exists for allowlisted MVP types.
    await expect(page.locator('button[data-notification-type="payment_received"]')).toHaveCount(0);

    // No payment/Receita/WhatsApp affordance text leaks via this row.
    await expect(inertRow).not.toContainText('Receita');
  });
});

// ---------------------------------------------------------------------------
// Anonymous — negative-auth on the preferences page
// ---------------------------------------------------------------------------

base.describe('@notifications preferences (anonymous)', () => {
  // No storageState — a fully anonymous browser context.
  base('anonymous visit to /configuracoes/notificacoes redirects to /login', async ({ page }) => {
    await page.goto('/configuracoes/notificacoes');

    await page.waitForURL('**/login**', { timeout: 10_000 });
    const url = new URL(page.url());
    expect(url.pathname).toBe('/login');
    // The middleware preserves the original destination for post-login return.
    expect(url.searchParams.get('redirectTo')).toBe('/configuracoes/notificacoes');
  });
});
