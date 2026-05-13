import { test, expect } from '../setup/db-fixture';
import { readSeedState, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @whatsapp -- WhatsApp connection page E2E test.
 *
 * Exercises both UI states of the WhatsApp integration page:
 *
 *   Phase 1 — Disconnected state: badge "Nao conectado", "Conectar WhatsApp"
 *     button, dialog form with phone/display-name/LGPD-consent fields.
 *
 *   Phase 2 — Connected state: badge "Conectado", formatted phone number,
 *     display name, and "Desconectar" button.
 *
 * Because the server actions call the real Twilio API (which is not available
 * in the E2E environment), we verify the connection transition by seeding the
 * `whatsapp_accounts` row directly via the DB fixture and reloading the page.
 *
 * Prerequisites:
 *   - Seeded session (storageState) provides an authenticated psychologist.
 */

const WHATSAPP_ACCOUNT_ID = '00000000-0000-4000-8000-000000000060';

test.describe('@whatsapp WhatsApp connection page', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test('shows disconnected state with connect dialog, then connected state after seeding', async ({
    page,
    db,
  }) => {
    // --- Phase 1: Disconnected state ---

    // Ensure no whatsapp account exists for this user.
    // Because other whatsapp e2e tests run in parallel and may INSERT
    // rows for the same user_id between our DELETE and the page render,
    // we delete-then-navigate in a short retry loop to guarantee a
    // clean disconnected state.
    const seed = await readSeedState();

    const MAX_DISCONNECT_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_DISCONNECT_ATTEMPTS; attempt++) {
      await db.sql`DELETE FROM public.whatsapp_accounts WHERE user_id = ${seed.userId}`;
      const cacheBust = Date.now();
      await page.goto(`/configuracoes/integracoes/whatsapp?_=${cacheBust}`);
      await expect(page.getByTestId('whatsapp-integration-page-title')).toBeVisible();

      const badge = page.getByTestId('whatsapp-status-badge');
      const text = await badge.textContent();
      if (text === 'Nao conectado') break;
      if (attempt === MAX_DISCONNECT_ATTEMPTS) {
        // Final attempt failed — let Playwright's assertion produce a
        // clear error message.
        await expect(badge).toHaveText('Nao conectado');
      }
    }

    // Verify page title
    await expect(page.getByTestId('whatsapp-integration-page-title')).toHaveText('WhatsApp');

    // Verify the "Nao conectado" badge
    await expect(page.getByTestId('whatsapp-status-badge')).toBeVisible();
    await expect(page.getByTestId('whatsapp-status-badge')).toHaveText('Nao conectado');

    // Click "Conectar WhatsApp" to open the dialog
    await page.getByTestId('whatsapp-connect-button').click();

    // Verify step 1 form appears
    const step1Form = page.getByTestId('connect-whatsapp-step1-form');
    await expect(step1Form).toBeVisible({ timeout: 5000 });

    // Fill phone number: +5511987654321
    const phoneInput = page.getByTestId('connect-whatsapp-phone-input');
    await phoneInput.fill('+5511987654321');

    // Fill display name
    const displayNameInput = page.getByTestId('connect-whatsapp-display-name-input');
    await displayNameInput.fill('Dra. Teste');

    // Check LGPD consent checkbox
    const consentCheckbox = page.getByTestId('connect-whatsapp-consent-checkbox');
    await consentCheckbox.click();

    // Verify all form fields have correct values
    // The phone mask converts "+5511987654321" to displayed "+55 11 98765-4321"
    await expect(phoneInput).toHaveValue('+55 11 98765-4321');
    await expect(displayNameInput).toHaveValue('Dra. Teste');

    // Verify "Continuar" button is visible and enabled
    const continueButton = page.getByTestId('connect-whatsapp-continue-button');
    await expect(continueButton).toBeVisible();
    await expect(continueButton).toBeEnabled();

    // Close the dialog
    await page.keyboard.press('Escape');

    // --- Phase 2: Connected state ---

    // Seed the whatsapp_account directly via DB to simulate completed connection
    await db.sql`
      INSERT INTO public.whatsapp_accounts (id, user_id, provider, account_id, phone_number, display_name, status, consent_given_at, connected_at)
      VALUES (
        ${WHATSAPP_ACCOUNT_ID},
        ${seed.userId},
        'twilio',
        'MG00000000000000000000000000000000',
        '+5511987654321',
        'Dra. Teste',
        'active',
        now(),
        now()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        phone_number = EXCLUDED.phone_number,
        display_name = EXCLUDED.display_name,
        status       = 'active',
        connected_at = EXCLUDED.connected_at;
    `;

    // Reload the page to see the connected state
    const cacheBust2 = Date.now();
    await page.goto(`/configuracoes/integracoes/whatsapp?_=${cacheBust2}`);

    // Verify the page now shows "Conectado" badge
    await expect(page.getByTestId('whatsapp-status-badge')).toHaveText('Conectado', {
      timeout: 10000,
    });

    // Verify the formatted phone number is displayed
    await expect(page.getByText('+55 11 98765-4321')).toBeVisible();

    // Verify display name is shown
    await expect(page.getByText('Dra. Teste')).toBeVisible();

    // Verify "Desconectar" button is visible
    await expect(page.getByTestId('whatsapp-disconnect-button')).toBeVisible();
  });
});
