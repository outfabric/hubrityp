import { test as base } from '@playwright/test';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

import { nowInBrt } from '../_shared/brt-date';
import { test, expect } from '../setup/db-fixture';
import { buildFixedJwt, type MockGoTrueUser } from '../setup/mock-gotrue';
import {
  readSeedState,
  SEED_DASHBOARD_EMPTY_USER,
  SEED_PATIENTS,
  STORAGE_STATE_PATH,
} from '../setup/seed-state';

/**
 * @dashboard -- Operational home E2E coverage (section 4.4).
 *
 * Covers the four behaviours the dashboard page composes:
 *   1. A user WITH data sees the "Hoje" section: the next upcoming session and
 *      its "Abrir sessão" CTA.
 *   2. A user with an overdue (>7d) `done` session lacking an evolution sees a
 *      non-zero "Pendências" count.
 *   3. A genuinely empty account (no patients, no sessions) sees the
 *      first-steps slot instead of the four sections — exercised via a
 *      dedicated zero-data user so the shared seed user's data stays intact.
 *   4. An anonymous visit to /dashboard is redirected to /login (negative-auth).
 *   5. No post-MVP pendência strings (Receita Saúde, cobrança, WhatsApp) leak
 *      onto the page — the MVP allowlist is enforced end to end.
 *
 * The seed user already owns the three SEED_PATIENTS and a seeded `done`
 * session 8 days old with no evolution (SEED_SESSIONS.lockedDone), so cases 1,
 * 2 and 5 run against real data. Case 1 adds ONE dedicated online session today
 * (reserved UUID) so there is a deterministic upcoming session to open.
 */

// A reserved UUID that no other spec touches — a single online session today.
const TODAY_SESSION_ID = '00000000-0000-4000-8000-0000000000d1';

// A reserved UUID for an overdue (>7d) `done` session with no evolution, used
// by the Pendências assertion. No seeded session qualifies on its own (the
// `lockedDone` fixture is future-dated), so this spec creates one.
const OVERDUE_SESSION_ID = '00000000-0000-4000-8000-0000000000d2';

// Post-MVP pendência strings that must NEVER appear on the dashboard.
const FORBIDDEN_STRINGS = ['Receita Saúde', 'cobrança', 'cobranças', 'WhatsApp'];

// ---------------------------------------------------------------------------
// Authenticated (seed user) — cases 1, 2, 5
// ---------------------------------------------------------------------------

test.describe('@dashboard operational home (authenticated)', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  // These tests share the seed user; the today-session insert/cleanup is
  // additive (reserved UUID) and idempotent, but run serially so a parallel
  // worker cannot delete the row between insert and render.
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ db }) => {
    const seed = await readSeedState();
    // One ONLINE session that is BOTH upcoming and still within today's São
    // Paulo calendar day, so `getTodaySessions` returns it as the `next`
    // session. We aim for `now + 2h`, but clamp to 23:55 BRT today so a
    // late-evening run does not spill the session into tomorrow (which would
    // fall outside the Hoje day-window). `getTodaySessions` bounds the day in
    // BRT, so the clamp keeps the row inside it. Idempotent upsert.
    await db.sql`
      INSERT INTO public.sessions (
        id, user_id, patient_id,
        start_at, end_at, duration_minutes,
        status, modality, is_blocking
      )
      VALUES (
        ${TODAY_SESSION_ID},
        ${seed.userId},
        ${SEED_PATIENTS.activeWithPhone.id},
        LEAST(
          now() + interval '2 hours',
          (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')
            + interval '1 day' - interval '5 minutes') AT TIME ZONE 'America/Sao_Paulo'
        ),
        LEAST(
          now() + interval '2 hours',
          (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')
            + interval '1 day' - interval '5 minutes') AT TIME ZONE 'America/Sao_Paulo'
        ) + interval '50 minutes',
        50, 'scheduled', 'online', false
      )
      ON CONFLICT (id) DO UPDATE SET
        start_at         = EXCLUDED.start_at,
        end_at           = EXCLUDED.end_at,
        status           = EXCLUDED.status,
        modality         = EXCLUDED.modality,
        deleted_at       = NULL;
    `;

    // A `done` session 10 days in the past with NO evolution → counts as one
    // "overdue evolution" pendência. Insert with a reserved UUID; clean up
    // afterEach so the count stays deterministic for this spec.
    await db.sql`
      INSERT INTO public.sessions (
        id, user_id, patient_id,
        start_at, end_at, duration_minutes,
        status, is_blocking
      )
      VALUES (
        ${OVERDUE_SESSION_ID},
        ${seed.userId},
        ${SEED_PATIENTS.activeWithPhone.id},
        (now() - interval '10 days'),
        (now() - interval '10 days' + interval '50 minutes'),
        50, 'done', false
      )
      ON CONFLICT (id) DO UPDATE SET
        start_at         = EXCLUDED.start_at,
        end_at           = EXCLUDED.end_at,
        status           = EXCLUDED.status,
        deleted_at       = NULL;
    `;
    // Guarantee no evolution exists for this session (a prior run may have left
    // one), so the anti-join in getPendencias keeps counting it.
    await db.sql`DELETE FROM public.evolutions WHERE session_id = ${OVERDUE_SESSION_ID}`;
  });

  test.afterEach(async ({ db }) => {
    await db.sql`DELETE FROM public.sessions WHERE id IN (${TODAY_SESSION_ID}, ${OVERDUE_SESSION_ID})`;
  });

  test('shows the Hoje section with the next session and "Abrir sessão"', async ({ page }) => {
    await page.goto('/dashboard');

    // The Hoje section is always present for a user with data; the clamped
    // session is always within today's BRT day, so it appears in the list.
    await expect(page.getByTestId('dashboard-section-today')).toBeVisible();
    await expect(page.getByTestId('dashboard-today-list')).toContainText(
      SEED_PATIENTS.activeWithPhone.fullName,
    );

    // The session is the upcoming `next` (and thus shows "Abrir sessão") in
    // every BRT window except the final 5 minutes of the day, where the 23:55
    // clamp can land at or before `now`. Guard so the assertion stays
    // deterministic; the list assertion above already proves Hoje renders.
    if (nowInBrt().getHours() < 23) {
      const openCta = page.getByTestId('dashboard-today-open-session');
      await expect(openCta).toBeVisible();
      await expect(openCta).toHaveAttribute('href', `/sessao/${TODAY_SESSION_ID}/video`);
    }
  });

  test('shows a non-zero Pendências count for an overdue evolution', async ({ page }) => {
    await page.goto('/dashboard');

    const pendencias = page.getByTestId('dashboard-section-pendencias');
    await expect(pendencias).toBeVisible();

    // The session seeded in beforeEach is `done`, 10 days old, with no
    // evolution → counted as one overdue evolution. The row carries a count >= 1.
    const overdueRow = page.getByTestId('dashboard-pendencias-row-overdue-evolutions');
    await expect(overdueRow).toBeVisible();
    await expect(overdueRow).toContainText('evolução');
  });

  test('never renders post-MVP pendência strings', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('dashboard-section-today')).toBeVisible();

    // Scope the check to the dashboard's own content (main), not the shared
    // (app) shell: the sidebar / WhatsApp health banner can legitimately
    // mention "WhatsApp", and a parallel whatsapp spec may transiently raise
    // that banner. The MVP allowlist is a property of the dashboard SECTIONS.
    const body = await page.locator('main').innerText();
    for (const forbidden of FORBIDDEN_STRINGS) {
      expect(body).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// Anonymous — case 4 (negative-auth)
// ---------------------------------------------------------------------------

base.describe('@dashboard operational home (anonymous)', () => {
  // No storageState — a fully anonymous browser context.
  base('anonymous visit to /dashboard redirects to /login', async ({ page }) => {
    await page.goto('/dashboard');

    await page.waitForURL('**/login**', { timeout: 10_000 });
    const url = new URL(page.url());
    expect(url.pathname).toBe('/login');
    // The middleware preserves the original destination for post-login return.
    expect(url.searchParams.get('redirectTo')).toBe('/dashboard');
  });
});

// ---------------------------------------------------------------------------
// Zero-data user — case 3 (first-steps slot)
//
// A dedicated active psychologist owning no patients/sessions, seeded in
// global-setup. We register it with the mock GoTrue at runtime (so getUser()
// and the middleware's profile shim both resolve it) and sign the browser in
// by building its Supabase cookie ourselves — exactly the cookie shape
// auth.setup.ts writes for the seed user.
// ---------------------------------------------------------------------------

function buildEmptyUser(): MockGoTrueUser {
  const nowIso = new Date().toISOString();
  return {
    id: SEED_DASHBOARD_EMPTY_USER.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: SEED_DASHBOARD_EMPTY_USER.email,
    email_confirmed_at: nowIso,
    phone: '',
    confirmed_at: nowIso,
    last_sign_in_at: nowIso,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
    created_at: nowIso,
    updated_at: nowIso,
  };
}

function buildEmptyProfileRow(): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    user_id: SEED_DASHBOARD_EMPTY_USER.id,
    email: SEED_DASHBOARD_EMPTY_USER.email,
    full_name: SEED_DASHBOARD_EMPTY_USER.fullName,
    crp_number: '22222-V',
    crp_uf: 'SP',
    crp_validated_at: now,
    crp_validated_by: null,
    email_verified_at: now,
    status: 'active',
    terms_accepted_at: now,
    privacy_accepted_at: now,
    sensitive_data_consent_at: now,
    last_resend_at: null,
    // Onboarding-COMPLETE so the reworked soft gate lets this zero-data user
    // reach `/dashboard` (its first-steps empty state is the point of the test,
    // not the onboarding wizard).
    onboarding_step: 'done',
    onboarding_completed_at: now,
    created_at: now,
    updated_at: now,
  };
}

base.describe('@dashboard operational home (zero-data)', () => {
  base(
    'a brand-new account sees the first-steps slot, not the four sections',
    async ({ page, request }) => {
      const seed = await readSeedState();

      const nowSec = Math.floor(Date.now() / 1000);
      // The anon key in the e2e server is `e2e-anon-key`; supabase-js validates
      // the JWT HMAC locally against it before calling /auth/v1/user, so the
      // token must be signed with that same secret (buildFixedJwt's default).
      const accessToken = buildFixedJwt({
        sub: SEED_DASHBOARD_EMPTY_USER.id,
        email: SEED_DASHBOARD_EMPTY_USER.email,
        aud: 'authenticated',
        role: 'authenticated',
        exp: nowSec + 60 * 60 * 24 * 30,
        iat: nowSec,
      });

      // Register the user with the running server's mock GoTrue so getUser() and
      // the Edge middleware's PostgREST profile shim both resolve it as active.
      const registerRes = await request.post(`${seed.supabaseUrl}/_test/register-oauth-user`, {
        data: {
          user: buildEmptyUser(),
          jwt: accessToken,
          code: `dashboard-empty-${nowSec}`,
          profile: buildEmptyProfileRow(),
        },
      });
      expect(registerRes.ok()).toBeTruthy();

      // Build the Supabase auth cookie for this user (same approach as
      // auth.setup.ts) and inject it into the browser context.
      const captured: { name: string; value: string; options: CookieOptions }[] = [];
      const supabase = createServerClient(seed.supabaseUrl, 'e2e-anon-key', {
        cookies: {
          getAll: () => [],
          setAll: (cookiesToSet) => {
            captured.push(...cookiesToSet);
          },
        },
      });
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: 'mock-refresh-token',
      });
      expect(error).toBeNull();
      expect(captured.length).toBeGreaterThan(0);

      await page.context().addCookies(
        captured.map((c) => ({
          name: c.name,
          value: c.value,
          domain: 'localhost',
          path: c.options.path ?? '/',
          expires: Math.floor(Date.now() / 1000) + (c.options.maxAge ?? 60 * 60 * 24),
          httpOnly: c.options.httpOnly ?? false,
          secure: false,
          sameSite: 'Lax' as const,
        })),
      );

      await page.goto('/dashboard');

      // The empty state leads; none of the four operational sections render.
      await expect(page.getByTestId('dashboard-first-steps')).toBeVisible();
      await expect(page.getByTestId('dashboard-first-steps-new-patient')).toBeVisible();
      await expect(page.getByTestId('dashboard-section-today')).toHaveCount(0);
      await expect(page.getByTestId('dashboard-section-pendencias')).toHaveCount(0);
    },
  );
});
