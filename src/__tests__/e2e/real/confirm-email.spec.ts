import { expect, test, type Page } from '@playwright/test';

// Public email-confirmation flow against the local `supabase start` stack +
// the REAL GoTrue. Unlike the seeded `@auth` suite (mock GoTrue), these specs
// exercise the production code path end-to-end: signup hits the real GoTrue,
// GoTrue creates an UNCONFIRMED user row (no `email_confirm` shortcut), and the
// login path observes GoTrue's real `email_not_confirmed` (HTTP 422) response —
// which it only returns AFTER validating the password. That ordering is the
// whole point of the suite: it proves no account-enumeration leak (a wrong
// password yields the generic `invalid_credentials`, never the confirm state).
//
// Spec source: change `add-public-email-confirmation`, tasks 10.1–10.3.
//
// NOTE on user creation: these specs intentionally sign up FRESH random emails
// through the real form rather than seeding via the Admin API, because the
// behavior under test (the unconfirmed-account state) requires a user whose
// email has NOT been confirmed — the suite's `global-setup.ts` seed flips its
// user to confirmed/active, which is the wrong precondition here. Each spec
// uses a unique throwaway email so the local-only GoTrue rows never collide.

/**
 * Builds a unique, throwaway signup email. The local Supabase stack is reset
 * per CI run, so a timestamp + random suffix is enough to avoid collisions
 * with the seeded user and across parallel/retried runs.
 */
function freshEmail(label: string): string {
  const unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `confirm-email-${label}-${unique}@example.com`;
}

// A password that satisfies the signup strength rules (length + mixed
// character classes). Reused across specs — there is no security boundary;
// these are throwaway local-only accounts.
const STRONG_PASSWORD = 'Hubrity!Test-2026';

/**
 * Drives the public signup form to completion with the supplied credentials.
 *
 * Fills every required field (name, email, password + confirmation, CRP number
 * + UF via the Radix Select, and the three LGPD consent checkboxes) and submits.
 * Does NOT assert the post-submit destination — callers decide what to expect
 * next (`/verifique-email`, an inline error, etc.).
 */
async function completeSignup(page: Page, email: string): Promise<void> {
  await page.goto('/signup');

  await page.getByTestId('signup-form-name').fill('Fulano de Tal');
  await page.getByTestId('signup-form-email').fill(email);
  await page.getByTestId('signup-form-password').fill(STRONG_PASSWORD);
  await page.getByTestId('signup-form-password-confirm').fill(STRONG_PASSWORD);
  await page.getByTestId('signup-form-crp-number').fill('06/123456');

  // CRP UF is a Radix Select: open the trigger, then pick an option by its
  // accessible role/name. Radix renders options as `role="option"`.
  await page.getByTestId('signup-form-crp-uf').click();
  await page.getByRole('option', { name: 'SP' }).click();

  // The three LGPD consents are Radix Checkboxes (role="checkbox").
  await page.getByTestId('signup-form-terms').click();
  await page.getByTestId('signup-form-privacy').click();
  await page.getByTestId('signup-form-sensitive-data').click();

  await page.getByTestId('signup-form-submit').click();
}

test.describe('@auth-real public email confirmation', () => {
  // 10.1 — Signup of a fresh email lands on the public `/verifique-email`
  // page (NOT `/login`), the card is visible, and the URL carries no `?email=`
  // param (PII must never travel in the query string).
  test('signup lands on /verifique-email with no email in the URL', async ({ page }) => {
    const email = freshEmail('signup');

    await completeSignup(page, email);

    // The signup Server Action redirects to `/verifique-email` on success.
    await page.waitForURL('**/verifique-email');
    await expect(page).toHaveURL(/\/verifique-email$/);

    await expect(page.getByTestId('verifique-email-card')).toBeVisible();

    // Adversarial check: the redirect MUST NOT leak the address via the query
    // string (server logs, Referer headers, proxies all retain URLs). The
    // pending email is carried server-side in the signed `hp_pending_email`
    // cookie, never as `?email=`.
    const url = new URL(page.url());
    expect(url.search).toBe('');
    expect(url.searchParams.has('email')).toBe(false);
  });

  // 10.2 — Logging in on the unconfirmed account:
  //   • CORRECT password -> shows the `login-confirm-email` state and repeated
  //     attempts NEVER lock the account (GoTrue's `email_not_confirmed` path
  //     deliberately bypasses the lockout counter).
  //   • WRONG password -> generic `invalid_credentials` (`login-form-error`),
  //     proving GoTrue validates the password BEFORE surfacing the unconfirmed
  //     state, so the confirm state never leaks for a wrong password.
  test('unconfirmed login: correct password shows confirm-email and never locks out; wrong password is generic', async ({
    page,
  }) => {
    const email = freshEmail('login');

    // Create the unconfirmed account through the real signup flow.
    await completeSignup(page, email);
    await page.waitForURL('**/verifique-email');

    // ---- CORRECT password, repeated attempts: never locks out ----
    // We attempt more times than the lockout threshold (5) to prove the
    // `email_not_confirmed` branch never increments the failed-attempt
    // counter. If it did, a later attempt would flip to `locked_out`
    // (rendered inside `login-form-error`) instead of `login-confirm-email`.
    const ATTEMPTS = 6;
    for (let i = 0; i < ATTEMPTS; i += 1) {
      await page.goto('/login');
      await page.getByTestId('login-form-email').fill(email);
      await page.getByTestId('login-form-password').fill(STRONG_PASSWORD);
      await page.getByTestId('login-form-submit').click();

      // The unconfirmed-account state is informational, NOT an error. It must
      // appear, and the danger error region must NOT — otherwise the account
      // was locked out (or fell through to invalid_credentials).
      await expect(page.getByTestId('login-confirm-email')).toBeVisible();
      await expect(page.getByTestId('login-form-error')).toHaveCount(0);

      // Stays on /login (no session is ever issued for an unconfirmed user).
      await expect(page).toHaveURL(/\/login$/);
    }

    // ---- WRONG password: generic invalid_credentials, never the confirm
    // state. This proves there is no enumeration leak — an attacker guessing a
    // wrong password cannot distinguish an unconfirmed account from a
    // non-existent one.
    await page.goto('/login');
    await page.getByTestId('login-form-email').fill(email);
    await page.getByTestId('login-form-password').fill('wrong-password-entirely');
    await page.getByTestId('login-form-submit').click();

    await expect(page.getByTestId('login-form-error')).toBeVisible();
    await expect(page.getByTestId('login-confirm-email')).toHaveCount(0);
    await expect(page).toHaveURL(/\/login$/);
  });

  // 10.3 — Resending the confirmation link from `/verifique-email` while
  // anonymous succeeds and renders the generic, enumeration-safe
  // acknowledgement. The action derives the target email solely from the
  // signed `hp_pending_email` cookie (set by signup), never from client input.
  test('anonymous resend on /verifique-email shows the generic acknowledgement', async ({
    page,
  }) => {
    const email = freshEmail('resend');

    // Signing up sets the `hp_pending_email` cookie and lands us on the page.
    await completeSignup(page, email);
    await page.waitForURL('**/verifique-email');
    await expect(page.getByTestId('verifique-email-card')).toBeVisible();

    // Click resend. The feedback region starts empty and fills with the
    // generic acknowledgement after the Server Action resolves.
    await page.getByTestId('verifique-email-resend').click();

    await expect(page.getByTestId('verifique-email-feedback')).toHaveText(
      /reenviamos o link de confirmação/i,
    );
  });
});
