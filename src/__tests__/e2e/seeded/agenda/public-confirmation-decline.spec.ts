import { expect, test } from '@playwright/test';
import pgModule from 'postgres';

import { readSeedState, SEED_SESSIONS } from '../setup/seed-state';

/**
 * @agenda -- Public session confirmation E2E tests (decline flow).
 *
 * Tests the patient-facing public confirmation page at `/confirmar-sessao/:token`:
 *   1. Navigate to the page (no auth context)
 *   2. Click "Não posso comparecer"
 *   3. Enter optional reason in textarea
 *   4. Click "Confirmar cancelamento"
 *   5. Verify "Cancelamento registrado" message
 *   6. Revisit the same URL -> "Voce ja respondeu"
 *
 * Prerequisites:
 *   - Seeded session with confirmation_token in global-setup.ts
 *   - No authentication required (public page)
 */
test.describe.serial('@agenda public confirmation — decline', () => {
  // No storageState needed — this is a public page

  // Reset the session before each test so retries start with a declinable state.
  // We anchor start_at on the BRT date + fixed UTC hour (11:00 BRT = 14:00 UTC)
  // rather than `now() + interval '2 days'` because the latter preserves the
  // current time of day. This ensures consistency with the global seed pattern
  // and prevents the session from falling outside the calendar's visible slot
  // range if rendered by other tests.
  test.beforeEach(async () => {
    const seed = await readSeedState();
    const sql = pgModule(seed.databaseUrl, { max: 1, onnotice: () => {} });
    try {
      await sql`
        UPDATE public.sessions
        SET status             = 'scheduled',
            confirmed_at       = NULL,
            cancelled_at       = NULL,
            cancellation_reason = NULL,
            cancelled_by       = NULL,
            cancellation_notice = NULL,
            charge_cancellation = false,
            start_at           = (current_timestamp AT TIME ZONE 'America/Sao_Paulo')::date + interval '2 days' + interval '14 hours',
            end_at             = (current_timestamp AT TIME ZONE 'America/Sao_Paulo')::date + interval '2 days' + interval '14 hours 50 minutes'
        WHERE id = ${SEED_SESSIONS.declinable.id};
      `;
    } finally {
      await sql.end();
    }
  });

  test('declines a session with optional reason', async ({ page }) => {
    const token = SEED_SESSIONS.declinable.confirmationToken;

    await page.goto(`/confirmar-sessao/${token}`);

    // Verify the confirmation form is visible
    const form = page.getByTestId('confirmation-form');
    await expect(form).toBeVisible();

    // Click "Não posso comparecer" to expand decline form
    const declineButton = page.getByTestId('decline-button');
    await expect(declineButton).toBeVisible();
    await declineButton.click();

    // The decline form should appear with textarea and confirm button
    const declineForm = page.getByTestId('decline-form');
    await expect(declineForm).toBeVisible();

    // Enter optional reason
    const reasonTextarea = page.getByTestId('decline-reason');
    await expect(reasonTextarea).toBeVisible();
    await reasonTextarea.fill('Tenho um compromisso urgente');

    // Click "Confirmar cancelamento"
    const confirmDeclineButton = page.getByTestId('confirm-decline-button');
    await expect(confirmDeclineButton).toBeVisible();
    await confirmDeclineButton.click();

    // Verify decline success message
    const declined = page.getByTestId('confirmation-declined');
    await expect(declined).toBeVisible({ timeout: 10000 });
    await expect(declined).toContainText('Cancelamento registrado');
    await expect(declined).toContainText('Sua psicóloga foi notificada sobre o cancelamento');
  });

  test('revisiting after decline shows already-responded', async ({ page }) => {
    const token = SEED_SESSIONS.declinable.confirmationToken;

    // First, decline the session
    await page.goto(`/confirmar-sessao/${token}`);
    const declineButton = page.getByTestId('decline-button');
    await expect(declineButton).toBeVisible();
    await declineButton.click();

    const confirmDeclineButton = page.getByTestId('confirm-decline-button');
    await expect(confirmDeclineButton).toBeVisible();
    await confirmDeclineButton.click();

    const declined = page.getByTestId('confirmation-declined');
    await expect(declined).toBeVisible({ timeout: 10000 });

    // Revisit the same URL — should see "Voce ja respondeu"
    await page.goto(`/confirmar-sessao/${token}`);
    const alreadyResponded = page.getByTestId('confirmation-already-responded');
    await expect(alreadyResponded).toBeVisible();
    await expect(alreadyResponded).toContainText('Voce ja respondeu');
  });

  test('declines a session without providing a reason', async ({ page }) => {
    const token = SEED_SESSIONS.declinable.confirmationToken;

    await page.goto(`/confirmar-sessao/${token}`);

    // Click "Não posso comparecer"
    const declineButton = page.getByTestId('decline-button');
    await declineButton.click();

    // Click "Confirmar cancelamento" without entering a reason
    const confirmDeclineButton = page.getByTestId('confirm-decline-button');
    await confirmDeclineButton.click();

    // Should still show decline success
    const declined = page.getByTestId('confirmation-declined');
    await expect(declined).toBeVisible({ timeout: 10000 });
    await expect(declined).toContainText('Cancelamento registrado');
  });
});
