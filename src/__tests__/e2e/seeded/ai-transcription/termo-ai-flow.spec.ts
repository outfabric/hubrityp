import { expect, test } from '@playwright/test';
import pgModule from 'postgres';

import { readSeedState, SEED_AI_CONSENT_TERMS } from '../setup/seed-state';

/**
 * @ai-transcription -- AI consent term public signing E2E tests.
 *
 * Tests the full AI consent signing flow on the public `/termo/:token` page:
 *   1. Anonymous user opens AI consent link -> reads structured template
 *   2. Checks acceptance checkbox -> signs -> sees success
 *   3. Reloads link -> sees "already signed" message
 *   4. Invalid token -> sees "not found" message
 *   5. Already-signed token -> sees "already signed" message
 *
 * Prerequisites:
 *   - Seeded ai_recording consent_terms rows in global-setup.ts
 *   - No authentication required for the public page
 *   - Authenticated session required for the psychologist UI assertion
 */

// Serial: tests share the `unsigned` seed token — the signing test mutates
// its state and beforeEach resets it. Running in parallel would race.
test.describe.serial('@ai-transcription AI consent signing page', () => {
  // Reset the unsigned AI consent term before each test so retries and
  // downstream tests always start with a signable form.
  test.beforeEach(async () => {
    const seed = await readSeedState();
    const sql = pgModule(seed.databaseUrl, { max: 1, onnotice: () => {} });
    try {
      await sql`
        UPDATE public.consent_terms
        SET signed_at = NULL,
            signed_ip = NULL,
            signed_user_agent = NULL
        WHERE id = ${SEED_AI_CONSENT_TERMS.unsigned.id};
      `;
    } finally {
      await sql.end();
    }
  });

  test('signs an AI consent term successfully via the public page', async ({ page }) => {
    const token = SEED_AI_CONSENT_TERMS.unsigned.signatureToken;

    await page.goto(`/termo/${token}`);

    // Verify the AI consent view is rendered
    const consentView = page.getByTestId('ai-consent-view');
    await expect(consentView).toBeVisible();

    // Verify title
    await expect(
      page.getByText(
        'Termo de Consentimento para Gravacao e Transcricao por Inteligencia Artificial',
      ),
    ).toBeVisible();

    // Verify sections are rendered — check for "Bases legais" heading
    await expect(page.getByRole('heading', { name: 'Bases legais' })).toBeVisible();

    // Verify all 8 sections are present
    const sectionEls = page.getByTestId('ai-consent-section');
    await expect(sectionEls).toHaveCount(8);

    // Sign button should be disabled before accepting
    const signButton = page.getByTestId('ai-consent-sign-button');
    await expect(signButton).toBeDisabled();

    // Accept the terms
    const checkbox = page.getByTestId('ai-consent-checkbox');
    await checkbox.click();

    // Sign button should now be enabled
    await expect(signButton).toBeEnabled();

    // Click sign
    await signButton.click();

    // Verify success message
    const success = page.getByTestId('ai-consent-success');
    await expect(success).toBeVisible({ timeout: 10000 });
    await expect(success).toContainText('Termo assinado com sucesso');
  });

  test('shows not-found message for invalid token format', async ({ page }) => {
    // A token that is neither 64-char hex nor 43-char base64url
    await page.goto('/termo/invalid-token-too-short');

    const notFound = page.getByTestId('consent-not-found');
    await expect(notFound).toBeVisible();
    await expect(notFound).toContainText('Termo nao encontrado');
  });

  test('shows already-signed message for a signed AI token', async ({ page }) => {
    const token = SEED_AI_CONSENT_TERMS.alreadySigned.signatureToken;

    await page.goto(`/termo/${token}`);

    const alreadySigned = page.getByTestId('ai-consent-already-signed');
    await expect(alreadySigned).toBeVisible();
    await expect(alreadySigned).toContainText('Este termo ja foi assinado');
  });

  test('after signing, reloading shows the already-signed state', async ({ page }) => {
    const token = SEED_AI_CONSENT_TERMS.unsigned.signatureToken;

    // Sign the term
    await page.goto(`/termo/${token}`);

    const consentView = page.getByTestId('ai-consent-view');
    await expect(consentView).toBeVisible();

    const checkbox = page.getByTestId('ai-consent-checkbox');
    await checkbox.click();

    const signButton = page.getByTestId('ai-consent-sign-button');
    await signButton.click();

    const success = page.getByTestId('ai-consent-success');
    await expect(success).toBeVisible({ timeout: 10000 });

    // Reload the page — should now show "already signed"
    await page.reload();

    const alreadySigned = page.getByTestId('ai-consent-already-signed');
    await expect(alreadySigned).toBeVisible();
    await expect(alreadySigned).toContainText('Este termo ja foi assinado');
  });

  test('name confirmation input has patient name as placeholder', async ({ page }) => {
    const token = SEED_AI_CONSENT_TERMS.unsigned.signatureToken;
    await page.goto(`/termo/${token}`);

    const nameInput = page.getByTestId('ai-consent-name-input');
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toHaveAttribute('placeholder', 'Maria Silva');
  });

  test('AI consent signing records hashed IP and user-agent in the database', async ({ page }) => {
    const token = SEED_AI_CONSENT_TERMS.unsigned.signatureToken;

    await page.goto(`/termo/${token}`);

    const checkbox = page.getByTestId('ai-consent-checkbox');
    await checkbox.click();

    const signButton = page.getByTestId('ai-consent-sign-button');
    await signButton.click();

    const success = page.getByTestId('ai-consent-success');
    await expect(success).toBeVisible({ timeout: 10000 });

    // Verify database state directly
    const seed = await readSeedState();
    const sql = pgModule(seed.databaseUrl, { max: 1, onnotice: () => {} });
    try {
      const rows = await sql`
        SELECT signed_at, signed_ip, signed_user_agent
        FROM public.consent_terms
        WHERE id = ${SEED_AI_CONSENT_TERMS.unsigned.id};
      `;

      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.signed_at).not.toBeNull();
      // SHA-256 hex digests are 64 chars
      expect(row.signed_ip).toHaveLength(64);
      expect(row.signed_user_agent).toHaveLength(64);
      // Must be hex
      expect(row.signed_ip).toMatch(/^[0-9a-f]{64}$/);
      expect(row.signed_user_agent).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await sql.end();
    }
  });
});
