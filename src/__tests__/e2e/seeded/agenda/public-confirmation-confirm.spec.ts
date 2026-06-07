import { expect, test } from '@playwright/test';
import pgModule from 'postgres';

import { readSeedState, SEED_SESSIONS } from '../setup/seed-state';

/**
 * @agenda -- Public session confirmation E2E tests (confirm flow).
 *
 * Tests the patient-facing public confirmation page at `/confirmar-sessao/:token`:
 *   1. Navigate to the page (no auth context)
 *   2. Verify session details are displayed (date, time, psychologist name)
 *   3. Click "Confirmar presença"
 *   4. Verify success message "Presença confirmada"
 *   5. Revisit the same URL -> "Você já respondeu"
 *
 * Prerequisites:
 *   - Seeded session with confirmation_token in global-setup.ts
 *   - No authentication required (public page)
 */
test.describe.serial('@agenda public confirmation — confirm', () => {
  // No storageState needed — this is a public page

  // Reset the session before each test so retries start with a confirmable state.
  // We anchor start_at on the BRT date + fixed UTC hour (10:00 BRT = 13:00 UTC)
  // rather than `now() + interval '2 days'` because the latter preserves the
  // current time of day. If the test runs late in the evening BRT, other tests
  // that render this session in the calendar (confirmation-flow.spec.ts) would
  // see the session outside the visible slot range, causing flaky failures.
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
            start_at           = (current_timestamp AT TIME ZONE 'America/Sao_Paulo')::date + interval '2 days' + interval '13 hours',
            end_at             = (current_timestamp AT TIME ZONE 'America/Sao_Paulo')::date + interval '2 days' + interval '13 hours 50 minutes'
        WHERE id = ${SEED_SESSIONS.confirmable.id};
      `;
    } finally {
      await sql.end();
    }
  });

  test('confirms a session and sees success message', async ({ page }) => {
    const token = SEED_SESSIONS.confirmable.confirmationToken;

    await page.goto(`/confirmar-sessao/${token}`);

    // Verify session details are displayed
    const dateEl = page.getByTestId('session-date');
    await expect(dateEl).toBeVisible();
    // Date text should contain "Sessao de" (the exact date varies but the prefix is stable)
    await expect(dateEl).toContainText('Sessao de');

    const psychologistEl = page.getByTestId('session-psychologist');
    await expect(psychologistEl).toBeVisible();
    await expect(psychologistEl).toContainText('Seed User');

    // Verify the confirmation form is visible
    const form = page.getByTestId('confirmation-form');
    await expect(form).toBeVisible();

    // Click "Confirmar presença"
    const confirmButton = page.getByTestId('confirm-button');
    await expect(confirmButton).toBeVisible();
    await confirmButton.click();

    // Verify success message
    const success = page.getByTestId('confirmation-success');
    await expect(success).toBeVisible({ timeout: 10000 });
    await expect(success).toContainText('Presença confirmada');
    await expect(success).toContainText('Sua psicóloga foi notificada');
  });

  test('revisiting after confirmation shows already-responded', async ({ page }) => {
    const token = SEED_SESSIONS.confirmable.confirmationToken;

    // First, confirm the session
    await page.goto(`/confirmar-sessao/${token}`);
    const confirmButton = page.getByTestId('confirm-button');
    await expect(confirmButton).toBeVisible();
    await confirmButton.click();

    const success = page.getByTestId('confirmation-success');
    await expect(success).toBeVisible({ timeout: 10000 });

    // Revisit the same URL — should see "Você já respondeu"
    await page.goto(`/confirmar-sessao/${token}`);
    const alreadyResponded = page.getByTestId('confirmation-already-responded');
    await expect(alreadyResponded).toBeVisible();
    await expect(alreadyResponded).toContainText('Você já respondeu');
  });

  test('shows invalid message for nonexistent token', async ({ page }) => {
    // Use a token that doesn't exist
    const fakeToken = '0'.repeat(64);
    await page.goto(`/confirmar-sessao/${fakeToken}`);

    const invalid = page.getByTestId('confirmation-invalid');
    await expect(invalid).toBeVisible();
    await expect(invalid).toContainText('Link inválido');
  });
});
