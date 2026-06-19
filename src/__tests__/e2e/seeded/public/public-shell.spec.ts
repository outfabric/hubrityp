import { expect, test, type Page } from '@playwright/test';

import { STORAGE_STATE_PATH } from '../setup/seed-state';

// Public marketing shell E2E (foundation flows).
// --------------------------------------------------------------------------
// These specs pin the public-site contract that the middleware classifies as
// `public` (no auth required, no redirect to /login):
//   1. anonymous shell — homepage 200, header CTAs, footer legal links, 404;
//   2. LGPD cookie consent — banner on first visit, "Aceitar" dismisses +
//      persists, no analytics request before consent;
//   3. authenticated visitor on a public page — CTA swaps to "Acessar
//      plataforma" and the user is NOT redirected.
//
// All three are anonymous except the last `describe`, which reuses the seeded
// session via storageState. The suite intentionally has no `@auth`-style tag
// because it covers the public shell, not an authenticated journey.

/** The page banner landmark — scopes header assertions away from the footer. */
function header(page: Page) {
  return page.getByRole('banner');
}

test.describe('public shell — anonymous visitor', () => {
  test('homepage returns 200, is not redirected to /login, and shows the anonymous header CTAs', async ({
    page,
  }) => {
    const response = await page.goto('/');

    // The homepage is public: middleware passes it through. The final response
    // is 200 and the URL stays on `/` (no redirect to /login).
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe('/');

    // The anonymous header renders the secondary "Entrar" + primary
    // "Começar grátis" pair. Scope to the banner so the (CSS-hidden) mobile
    // duplicate and any footer text never satisfy the assertion; at the default
    // desktop viewport only the desktop cluster is visible.
    await expect(header(page).getByRole('link', { name: 'Entrar' })).toBeVisible();
    await expect(header(page).getByRole('link', { name: 'Começar grátis' }).first()).toBeVisible();

    // And it must NOT offer the authenticated CTA.
    await expect(header(page).getByRole('link', { name: 'Acessar plataforma' })).toHaveCount(0);
  });

  test('footer legal links navigate to the privacy policy and terms pages (both 200)', async ({
    page,
  }) => {
    await page.goto('/');

    // "Política de Privacidade" → /politica-de-privacidade.
    await page
      .getByRole('contentinfo')
      .getByRole('link', { name: 'Política de Privacidade' })
      .click();
    await page.waitForURL('**/politica-de-privacidade');
    expect(new URL(page.url()).pathname).toBe('/politica-de-privacidade');
    // The page rendered (not a 404 / error) — the privacy page exposes an
    // `#lgpd` section anchor that the footer deep-links to.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Re-confirm the route returns 200 over the wire (the click followed a
    // soft navigation; this pins the HTTP status of a hard load).
    const privacyResponse = await page.goto('/politica-de-privacidade');
    expect(privacyResponse?.status()).toBe(200);

    // "Termos de Uso" → /termos-de-uso.
    await page.goto('/');
    await page.getByRole('contentinfo').getByRole('link', { name: 'Termos de Uso' }).click();
    await page.waitForURL('**/termos-de-uso');
    expect(new URL(page.url()).pathname).toBe('/termos-de-uso');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const termsResponse = await page.goto('/termos-de-uso');
    expect(termsResponse?.status()).toBe(200);
  });

  test('an unknown path renders the public 404 with both CTAs (no redirect to /login)', async ({
    page,
  }) => {
    const response = await page.goto('/rota-que-nao-existe-12345');

    // Unmatched paths are classified `public` by the middleware and pass
    // through to the Next 404 — never a redirect to /login.
    expect(response?.status()).toBe(404);
    expect(new URL(page.url()).pathname).toBe('/rota-que-nao-existe-12345');

    // The branded 404 renders both CTAs.
    await expect(page.getByRole('link', { name: 'Criar conta grátis' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Voltar para a homepage' })).toBeVisible();

    // The chrome is preserved (header + footer) — it is the public 404, not a
    // bare error page.
    await expect(page.getByRole('contentinfo')).toBeVisible();
  });
});

test.describe('public shell — LGPD cookie consent', () => {
  const BANNER = 'cookie-consent-banner';

  test('banner appears on first visit; "Aceitar" dismisses it, sets cookie_consent, and it does not reappear after navigation', async ({
    page,
    context,
  }) => {
    // First visit (no prior decision cookie) → the banner is shown.
    await page.goto('/');
    const banner = page.getByTestId(BANNER);
    await expect(banner).toBeVisible();

    // No analytics request before consent: in the e2e build no
    // NEXT_PUBLIC_ANALYTICS_HOST is configured, so the loader is a hard no-op
    // and never emits a <script>. Asserting the absence of the script element
    // pins "no analytics before consent" without coupling to a provider host.
    await expect(page.getByTestId('analytics-script')).toHaveCount(0);

    // Accept → the banner dismisses without a reload.
    await page.getByTestId('cookie-consent-accept').click();
    await expect(banner).toBeHidden();

    // The decision is persisted as `cookie_consent=accepted`.
    const cookies = await context.cookies();
    const consent = cookies.find((c) => c.name === 'cookie_consent');
    expect(consent?.value).toBe('accepted');

    // Navigating to another public page does NOT re-show the banner (the
    // cookie now exists, so the banner stays hidden).
    await page.goto('/termos-de-uso');
    await expect(page.getByTestId(BANNER)).toHaveCount(0);
  });
});

test.describe('public shell — authenticated visitor', () => {
  // Reuse the seeded active user's session. The header server wrapper resolves
  // `supabase.auth.getUser()` and swaps the CTA — it must NOT redirect.
  test.use({ storageState: STORAGE_STATE_PATH });

  test('an authenticated user sees "Acessar plataforma" on / and is not redirected', async ({
    page,
  }) => {
    const response = await page.goto('/');

    // Public page with a session: 200, stays on `/` (no redirect to /dashboard
    // or anywhere else).
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe('/');

    // The header collapses to the single "Acessar plataforma" → /dashboard CTA.
    const cta = header(page).getByRole('link', { name: 'Acessar plataforma' });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute('href', '/dashboard');

    // And the anonymous CTAs are gone.
    await expect(header(page).getByRole('link', { name: 'Entrar' })).toHaveCount(0);
    await expect(header(page).getByRole('link', { name: 'Começar grátis' })).toHaveCount(0);
  });
});
