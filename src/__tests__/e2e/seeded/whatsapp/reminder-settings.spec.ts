import { test, expect } from '../setup/db-fixture';
import { readSeedState, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @whatsapp -- Reminder settings page E2E test.
 *
 * Flow:
 *   1. Navigate to /configuracoes/lembretes
 *   2. Verify the form loads with default values (24h early, 2h final,
 *      30min video link, night-send OFF)
 *   3. Change early reminder to "24 horas antes" and final to "2 horas antes"
 *      (they already default to these, so we toggle to different values first)
 *   4. Click "Salvar"
 *   5. Verify success toast
 *   6. Reload the page
 *   7. Verify the saved values persisted
 *
 * Prerequisites:
 *   - storageState provides an authenticated psychologist.
 *   - No pre-existing reminder_settings row (cleaned in beforeEach).
 */

test.describe('@whatsapp reminder settings', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test.beforeEach(async ({ db }) => {
    const seed = await readSeedState();
    // Clean any existing reminder settings so the form shows defaults
    await db.sql`DELETE FROM public.reminder_settings WHERE user_id = ${seed.userId}`;
  });

  test('loads defaults, changes early=48h and final=1h, saves, reloads and verifies persistence', async ({
    page,
  }) => {
    // Navigate to the reminder settings page
    const cacheBust = Date.now();
    await page.goto(`/configuracoes/lembretes?_=${cacheBust}`);

    // Verify page title
    await expect(page.getByTestId('reminder-settings-page-title')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('reminder-settings-page-title')).toHaveText(
      'Configurações de Lembretes',
    );

    // Verify form card is visible
    await expect(page.getByTestId('reminder-settings-card')).toBeVisible();

    // Verify defaults: early reminder = 24h (radio "24" selected)
    const early24Radio = page.getByTestId('early-reminder-24');
    await expect(early24Radio).toBeVisible();
    await expect(early24Radio).toBeChecked();

    // Verify defaults: final reminder = 2h (radio "2" selected)
    const final2Radio = page.getByTestId('final-reminder-2');
    await expect(final2Radio).toBeVisible();
    await expect(final2Radio).toBeChecked();

    // Verify defaults: night-send switch is OFF
    const nightSwitch = page.getByTestId('send-during-night-switch');
    await expect(nightSwitch).toBeVisible();
    await expect(nightSwitch).toHaveAttribute('data-state', 'unchecked');

    // --- Change settings ---

    // Change early reminder to 48h
    const early48Radio = page.getByTestId('early-reminder-48');
    await early48Radio.click();
    await expect(early48Radio).toBeChecked();

    // Change final reminder to 1h
    const final1Radio = page.getByTestId('final-reminder-1');
    await final1Radio.click();
    await expect(final1Radio).toBeChecked();

    // Click "Salvar"
    await page.getByTestId('reminder-settings-save').click();

    // Verify success toast
    await expect(page.getByText('Configurações de lembretes salvas')).toBeVisible({
      timeout: 10000,
    });

    // Reload the page to verify persistence
    const cacheBust2 = Date.now();
    await page.goto(`/configuracoes/lembretes?_=${cacheBust2}`);

    // Wait for the form to load
    await expect(page.getByTestId('reminder-settings-card')).toBeVisible({ timeout: 10000 });

    // Verify the saved values persisted: early = 48h
    await expect(page.getByTestId('early-reminder-48')).toBeChecked();
    // 24h should NOT be checked anymore
    await expect(page.getByTestId('early-reminder-24')).not.toBeChecked();

    // Verify the saved values persisted: final = 1h
    await expect(page.getByTestId('final-reminder-1')).toBeChecked();
    // 2h should NOT be checked anymore
    await expect(page.getByTestId('final-reminder-2')).not.toBeChecked();
  });
});
