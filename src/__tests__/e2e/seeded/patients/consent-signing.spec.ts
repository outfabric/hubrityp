import { expect, test } from '@playwright/test';
import pgModule from 'postgres';

import { readSeedState, SEED_CONSENT_TERMS } from '../setup/seed-state';

/**
 * @patients -- Consent term public signing page E2E tests.
 *
 * Tests the full consent signing flow on the public `/termo/:token` page:
 *   1. Valid token: read term, accept checkbox, sign, verify success
 *   2. Invalid token: verify "Termo nao encontrado" message
 *   3. Already signed token: verify "Este termo ja foi assinado" message
 *
 * Prerequisites:
 *   - Seeded consent_terms rows in global-setup.ts (unsigned + already-signed)
 *   - No authentication required (public page)
 */

// Serial: tests share the `unsigned` seed token — the signing test mutates
// its state and beforeEach resets it. Running in parallel would race.
test.describe.serial('@patients consent signing page', () => {
  // No storageState needed — this is a public page

  // Reset the unsigned consent term before each test so retries and
  // downstream tests (refuse, keyboard) always start with a signable form.
  // Without this, the "signs successfully" test mutates seed data and
  // retries see "already signed" instead of the form.
  test.beforeEach(async () => {
    const seed = await readSeedState();
    const sql = pgModule(seed.databaseUrl, { max: 1, onnotice: () => {} });
    try {
      await sql`
        UPDATE public.consent_terms
        SET signed_at = NULL,
            signed_ip = NULL,
            signed_user_agent = NULL
        WHERE id = ${SEED_CONSENT_TERMS.unsigned.id};
      `;
    } finally {
      await sql.end();
    }
  });

  test('signs a consent term successfully', async ({ page }) => {
    const token = SEED_CONSENT_TERMS.unsigned.signatureToken;

    await page.goto(`/termo/${token}`);

    // Verify term text is visible
    const termText = page.getByTestId('consent-term-text');
    await expect(termText).toBeVisible();
    await expect(termText).toContainText('autorizo o tratamento psicologico');

    // Verify form is visible
    const form = page.getByTestId('consent-sign-form');
    await expect(form).toBeVisible();

    // Sign button should be disabled before accepting
    const signButton = page.getByTestId('consent-sign-button');
    await expect(signButton).toBeDisabled();

    // Accept the terms
    const checkbox = page.getByTestId('consent-checkbox');
    await checkbox.click();

    // Sign button should now be enabled
    await expect(signButton).toBeEnabled();

    // Click sign
    await signButton.click();

    // Verify success message
    const success = page.getByTestId('consent-success');
    await expect(success).toBeVisible({ timeout: 10000 });
    await expect(success).toContainText('Termo assinado com sucesso');
    await expect(success).toContainText('Uma cópia será enviada por e-mail');
  });

  test('shows not-found message for invalid token', async ({ page }) => {
    // Use a token that doesn't exist in the DB
    const invalidToken = 'f'.repeat(64);

    await page.goto(`/termo/${invalidToken}`);

    const notFound = page.getByTestId('consent-not-found');
    await expect(notFound).toBeVisible();
    await expect(notFound).toContainText('Termo nao encontrado');
  });

  test('shows already-signed message for signed token', async ({ page }) => {
    const token = SEED_CONSENT_TERMS.alreadySigned.signatureToken;

    await page.goto(`/termo/${token}`);

    const alreadySigned = page.getByTestId('consent-already-signed');
    await expect(alreadySigned).toBeVisible();
    await expect(alreadySigned).toContainText('Este termo ja foi assinado');
  });

  test('refuse button shows refusal message', async ({ page }) => {
    const token = SEED_CONSENT_TERMS.unsigned.signatureToken;

    await page.goto(`/termo/${token}`);

    // The beforeEach hook resets the unsigned term, so the form should
    // always be visible here — no need to check for already-signed state.
    const form = page.getByTestId('consent-sign-form');
    await expect(form).toBeVisible();

    // Click refuse
    const refuseButton = page.getByTestId('consent-refuse-button');
    await refuseButton.click();

    const refused = page.getByTestId('consent-refused');
    await expect(refused).toBeVisible();
    await expect(refused).toContainText('Termo recusado');
  });

  test('checkbox is keyboard-accessible', async ({ page }) => {
    const token = SEED_CONSENT_TERMS.unsigned.signatureToken;

    await page.goto(`/termo/${token}`);

    // The beforeEach hook resets the unsigned term, so the form should
    // always be visible here.
    const form = page.getByTestId('consent-sign-form');
    await expect(form).toBeVisible();

    // Tab to the checkbox and toggle with Space
    const checkbox = page.getByTestId('consent-checkbox');
    await checkbox.focus();
    await page.keyboard.press('Space');

    // Verify the checkbox is now checked (data-state attribute)
    await expect(checkbox).toHaveAttribute('data-state', 'checked');
  });
});
