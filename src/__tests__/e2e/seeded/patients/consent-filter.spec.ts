import { test as base, expect, type Page } from '@playwright/test';
import pgModule from 'postgres';

import { signInAsDedicatedUser } from '../_shared/dedicated-user-auth';
import { readSeedState, SEED_CONSENT_FILTER_USER } from '../setup/seed-state';

/**
 * @patients — "sem-consentimento" pendência filter flow (PRD §12, section 6).
 *
 * Drives the dedicated `SEED_CONSENT_FILTER_USER` (an active psychologist
 * touched by NOTHING else in the suite) end to end through the consent-filter
 * surface contract:
 *
 *   6.1 dashboard "Ver" → `/pacientes?filtro=sem-consentimento`; only the active,
 *       unconsented patients are listed; the chip count equals the dashboard's.
 *   6.2 copy link → "copiado" feedback; a single pending term exists (second
 *       click reuses the cached token, so no duplicate term is created).
 *   6.3 WhatsApp: adult → `wa.me/<patient digits>`; minor → `wa.me/<guardian
 *       digits>`; message carries `/termo/<token>`. No-phone row → button
 *       disabled + tooltip, copy-link still works.
 *   6.4 remove chip → URL drops `filtro`, full list returns; unknown `?filtro=xyz`
 *       renders the full list without error (RF-12.16).
 *   6.5 negative-auth: anonymous `/pacientes?filtro=sem-consentimento` → `/login`.
 *
 * Isolation: this user OWNS its patient/guardian/consent rows (seeded in
 * `global-setup.ts`), so the listing count is deterministic (4 active unconsented
 * rows; one signed + one archived as the negative cases). We sign in via the
 * shared `signInAsDedicatedUser` helper (NOT `storageState`, which is the global
 * seed user). The generate-consent action posts a fire-and-forget Server Action
 * on the current page, so copy/WhatsApp assertions wait for the action POST to
 * round-trip before reading the clipboard / opened URL or polling the DB.
 *
 * The copy-link/no-duplicate test (6.2) MUTATES `copyTarget`'s consent terms, so
 * the suite runs `serial` and resets that patient's terms in `beforeEach` to keep
 * the 0 → 1 → 1 assertion deterministic across reruns on the reused container.
 */

const USER = SEED_CONSENT_FILTER_USER;
const P = USER.patients;

/** Digits-only form of a phone, matching `extractPhoneDigits` in consent-share.ts. */
function digits(phone: string): string {
  return phone.replace(/\D/g, '');
}

async function openSql() {
  const seed = await readSeedState();
  return pgModule(seed.databaseUrl, { max: 1, onnotice: () => {} });
}

/** Counts non-revoked consent terms for a patient (the pending/active set). */
async function countPendingTerms(patientId: string): Promise<number> {
  const sql = await openSql();
  try {
    const rows = await sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n
      FROM public.consent_terms
      WHERE patient_id = ${patientId}
        AND user_id = ${USER.id}
        AND revoked_at IS NULL;
    `;
    return rows[0]?.n ?? 0;
  } finally {
    await sql.end();
  }
}

/** Removes any consent term for `copyTarget` so 6.2 starts from zero. */
async function resetCopyTargetTerms(): Promise<void> {
  const sql = await openSql();
  try {
    await sql`
      DELETE FROM public.consent_terms
      WHERE patient_id = ${P.copyTarget.id} AND user_id = ${USER.id};
    `;
  } finally {
    await sql.end();
  }
}

/** Navigates to the filtered listing and waits for the list/chip to render. */
async function gotoFilteredList(page: Page): Promise<void> {
  await page.goto('/pacientes?filtro=sem-consentimento');
  await expect(page.getByTestId('patient-list')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('patient-consent-filter-chip')).toBeVisible();
}

/** Returns the desktop table row whose cell text contains `name`. */
function rowFor(page: Page, name: string) {
  return page.getByTestId('patient-table').getByTestId('patient-row').filter({ hasText: name });
}

/**
 * Triggers a row consent action and waits for the generate-consent Server Action
 * POST to round-trip before the caller reads the clipboard / opened URL or polls
 * the DB. Mirrors the NPS spec's `actAndAwaitAction`: the action reference binds
 * only after the leaf hydrates, and the call is fired inside a `useTransition`, so
 * we (1) let the leaf settle and (2) arm `waitForResponse` BEFORE triggering.
 *
 * `waitForAction` is false on a SECOND copy click, where the component reuses its
 * cached token and never re-posts — arming `waitForResponse` there would hang.
 */
async function actOnRow(
  page: Page,
  trigger: () => Promise<void>,
  waitForAction = true,
): Promise<void> {
  await page.waitForTimeout(1_500);

  if (!waitForAction) {
    await trigger();
    return;
  }

  const actionResponse = page.waitForResponse(
    (res) =>
      res.request().method() === 'POST' &&
      res.request().headers()['next-action'] !== undefined &&
      new URL(res.url()).pathname === '/pacientes' &&
      res.status() === 200,
    { timeout: 15_000 },
  );
  await trigger();
  await actionResponse;
}

/**
 * Reads the last URL captured by the `window.open` init-script shim, polling
 * until it appears. `handleSendWhatsApp` calls `window.open` INSIDE the client
 * `startTransition` callback, AFTER `await generateConsentAction(...)` resolves —
 * a microtask beyond the HTTP response that `actOnRow` awaits. Reading
 * `__openedUrls` synchronously right after the action response therefore races
 * the client, so we poll instead.
 */
async function lastOpenedUrl(page: Page): Promise<string> {
  await expect
    .poll(
      () =>
        page.evaluate(() => (window as unknown as { __openedUrls: string[] }).__openedUrls.length),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);
  const opened = await page.evaluate(
    () => (window as unknown as { __openedUrls: string[] }).__openedUrls,
  );
  return opened[opened.length - 1]!;
}

base.describe('@patients consent-filter flow', () => {
  // 6.2 mutates `copyTarget`'s consent terms; serial keeps the reset → assert
  // cycle deterministic without a cross-worker lock.
  base.describe.configure({ mode: 'serial' });

  base.beforeEach(async ({ context, request }) => {
    await signInAsDedicatedUser(context, request, USER);
    await resetCopyTargetTerms();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  // 6.1 — dashboard "Ver" → filtered list; only unconsented active patients;
  //       chip count matches the dashboard count.
  base('dashboard "Ver" opens the filtered list with a matching count', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('dashboard-greeting')).toBeVisible({ timeout: 15_000 });

    // The missing-consent pendência row carries the dashboard count.
    const row = page.getByTestId('dashboard-pendencias-row-missing-consent');
    await expect(row).toBeVisible();
    await expect(row).toContainText('4');
    await expect(row).toContainText('pacientes sem consentimento');

    // "Ver" deep-links into the scoped listing.
    await page.getByTestId('dashboard-pendencias-link-missing-consent').click();
    await page.waitForURL('**/pacientes?filtro=sem-consentimento');

    await expect(page.getByTestId('patient-list')).toBeVisible({ timeout: 15_000 });

    // The chip is visible and its count equals the dashboard count (RF-12.18).
    const chip = page.getByTestId('patient-consent-filter-chip');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('Sem consentimento');
    await expect(chip).toContainText('4');

    // ONLY the four active unconsented patients are listed.
    const table = page.getByTestId('patient-table');
    await expect(table.getByTestId('patient-row')).toHaveCount(4);
    await expect(table).toContainText(P.adultWithPhone.fullName);
    await expect(table).toContainText(P.minorWithGuardian.fullName);
    await expect(table).toContainText(P.adultNoPhone.fullName);
    await expect(table).toContainText(P.copyTarget.fullName);

    // The signed and archived patients MUST NOT appear.
    await expect(table).not.toContainText(P.signedAdult.fullName);
    await expect(table).not.toContainText(P.archivedNoConsent.fullName);
  });

  // 6.2 — copy link → "copiado" feedback; a single pending term exists; a second
  //       click does NOT create a duplicate (the leaf caches the token).
  base('copy link shows feedback and does not duplicate the consent term', async ({ page }) => {
    await gotoFilteredList(page);

    // No consent term exists for `copyTarget` yet (reset in beforeEach).
    expect(await countPendingTerms(P.copyTarget.id)).toBe(0);

    const copyButton = rowFor(page, P.copyTarget.fullName).getByTestId('patient-consent-copy-link');
    await expect(copyButton).toBeVisible();

    // First click generates exactly one term and copies the link.
    await actOnRow(page, () => copyButton.click());
    await expect(page.getByText('Link copiado')).toBeVisible({ timeout: 5_000 });

    await expect.poll(async () => countPendingTerms(P.copyTarget.id), { timeout: 10_000 }).toBe(1);

    // The clipboard holds the token-gated `/termo/<token>` URL.
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain('/termo/');

    // Second click reuses the cached token — no second generate POST, no duplicate
    // term. (waitForAction=false: the component never re-posts on a cached click.)
    await actOnRow(page, () => copyButton.click(), false);
    await page.waitForTimeout(1_000);
    expect(await countPendingTerms(P.copyTarget.id)).toBe(1);
  });

  // 6.3a — adult with phone → `wa.me/<patient digits>` with `/termo/<token>`.
  base(
    'WhatsApp for an adult uses the patient phone and carries the term link',
    async ({ page }) => {
      // Capture window.open synchronously — `noopener` makes popup events unreliable.
      await page.addInitScript(() => {
        (window as unknown as { __openedUrls: string[] }).__openedUrls = [];
        const original = window.open.bind(window);
        window.open = (url?: string | URL, ...rest: unknown[]) => {
          (window as unknown as { __openedUrls: string[] }).__openedUrls.push(String(url ?? ''));
          // Do NOT actually navigate to wa.me in the test browser.
          return original('about:blank', ...(rest as []));
        };
      });

      await gotoFilteredList(page);

      const waButton = rowFor(page, P.adultWithPhone.fullName).getByTestId(
        'patient-consent-whatsapp',
      );
      await expect(waButton).toBeVisible();
      await expect(waButton).toBeEnabled();

      await actOnRow(page, () => waButton.click());

      const href = await lastOpenedUrl(page);
      expect(href).toContain(`wa.me/${digits(P.adultWithPhone.phone)}`);
      // The pre-filled message carries the token-gated consent URL (encoded).
      expect(decodeURIComponent(href)).toContain('/termo/');
    },
  );

  // 6.3b — minor → `wa.me/<guardian digits>` (NOT the patient's own number).
  base('WhatsApp for a minor uses the primary guardian phone', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __openedUrls: string[] }).__openedUrls = [];
      const original = window.open.bind(window);
      window.open = (url?: string | URL, ...rest: unknown[]) => {
        (window as unknown as { __openedUrls: string[] }).__openedUrls.push(String(url ?? ''));
        return original('about:blank', ...(rest as []));
      };
    });

    await gotoFilteredList(page);

    const waButton = rowFor(page, P.minorWithGuardian.fullName).getByTestId(
      'patient-consent-whatsapp',
    );
    await expect(waButton).toBeVisible();
    await expect(waButton).toBeEnabled();

    await actOnRow(page, () => waButton.click());

    const href = await lastOpenedUrl(page);
    expect(href).toContain(`wa.me/${digits(P.minorWithGuardian.guardianPhone)}`);
    expect(decodeURIComponent(href)).toContain('/termo/');
  });

  // 6.3c — no-phone row → WhatsApp button disabled + tooltip; copy-link still works.
  base(
    'no-phone row disables WhatsApp (with tooltip) but copy-link still works',
    async ({ page }) => {
      await gotoFilteredList(page);

      const noPhoneRow = rowFor(page, P.adultNoPhone.fullName);

      // The WhatsApp button is disabled for a row with no usable phone.
      const waButton = noPhoneRow.getByTestId('patient-consent-whatsapp');
      await expect(waButton).toBeVisible();
      await expect(waButton).toBeDisabled();

      // Focus the tooltip trigger (a keyboard-focusable span wrapping the disabled
      // button) to reveal the explanatory tooltip — focus is more deterministic
      // than hover for Radix tooltips. Radix renders the message twice (a
      // visually-hidden a11y copy + the visible portal), so we assert on the FIRST
      // match to avoid a strict-mode violation on the two elements.
      await noPhoneRow.getByTestId('patient-consent-whatsapp-tooltip-trigger').focus();
      await expect(
        page.getByText('Cadastre um telefone para enviar pelo WhatsApp').first(),
      ).toBeVisible({ timeout: 5_000 });

      // Copy-link is still available and functional for the no-phone row.
      const copyButton = noPhoneRow.getByTestId('patient-consent-copy-link');
      await expect(copyButton).toBeEnabled();
      await actOnRow(page, () => copyButton.click());
      await expect(page.getByText('Link copiado')).toBeVisible({ timeout: 5_000 });
    },
  );

  // 6.4 — remove chip drops `filtro` and returns the full list; an unknown
  //       `?filtro=xyz` renders the full list without error (RF-12.16).
  base(
    'remove-chip returns the full list and an unknown filtro renders the full list',
    async ({ page }) => {
      await gotoFilteredList(page);

      // Removing the chip drops ONLY the `filtro` param.
      await page.getByTestId('patient-consent-filter-remove').click();
      await page.waitForURL((url) => !url.search.includes('filtro'), { timeout: 10_000 });
      expect(new URL(page.url()).searchParams.has('filtro')).toBe(false);

      // The chip is gone and the full ACTIVE list is shown (the signed patient now
      // appears; the archived one stays out because the default status is active).
      await expect(page.getByTestId('patient-consent-filter-chip')).toHaveCount(0);
      const table = page.getByTestId('patient-table');
      await expect(table).toContainText(P.signedAdult.fullName);

      // An unknown `filtro` value degrades to NO filter — the full list renders and
      // no chip appears (RF-12.16: the allowlist parser ignores unknown values).
      await page.goto('/pacientes?filtro=xyz');
      await expect(page.getByTestId('patient-list')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('patient-consent-filter-chip')).toHaveCount(0);
      await expect(page.getByTestId('patient-table')).toContainText(P.signedAdult.fullName);
    },
  );
});

// ---------------------------------------------------------------------------
// 6.5 — negative-auth (anonymous): no signed-in user → redirect to /login.
// ---------------------------------------------------------------------------

base.describe('@patients consent-filter negative-auth', () => {
  // No `signInAsDedicatedUser` and no storageState: this context is fully
  // anonymous, so the request hits the middleware as an unauthenticated user.
  base('anonymous /pacientes?filtro=sem-consentimento redirects to /login', async ({ page }) => {
    const response = await page.goto('/pacientes?filtro=sem-consentimento');

    // Playwright follows the redirect; the final page is /login (200).
    expect(response?.status()).toBe(200);

    const url = new URL(page.url());
    expect(url.pathname).toBe('/login');
    // The middleware preserves the original path + query in `redirectTo`
    // (`requestPath = pathname + search`), so the deep-link survives login.
    expect(url.searchParams.get('redirectTo')).toBe('/pacientes?filtro=sem-consentimento');

    // The login form is rendered — not the patient list.
    await expect(page.getByTestId('login-form-email')).toBeVisible();
    await expect(page.getByTestId('patient-list')).toHaveCount(0);
  });
});
