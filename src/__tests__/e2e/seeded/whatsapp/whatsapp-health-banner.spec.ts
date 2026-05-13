import { test, expect } from '../setup/db-fixture';
import { readSeedState, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @whatsapp -- WhatsApp health banner E2E test.
 *
 * Verifies that a persistent danger banner appears in the (app) layout when
 * the psychologist's WhatsApp connection is in 'error' state AND at least
 * one reminder type is enabled.
 *
 * Flow:
 *   1. Seed whatsapp_accounts with status='error' and reminder_settings
 *      with early_reminder_hours=24 (at least one enabled)
 *   2. Navigate to /agenda (any authenticated page)
 *   3. Verify the banner appears with the warning text
 *   4. Verify the "Reconectar" link is visible
 *   5. Click "Reconectar" and verify navigation to /configuracoes/integracoes/whatsapp
 *
 * Prerequisites:
 *   - storageState provides an authenticated psychologist.
 */

const WHATSAPP_ACCOUNT_ID = '00000000-0000-4000-8000-000000000070';

test.describe('@whatsapp health banner', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  // Tests modify the same user's whatsapp data, so run serially to prevent
  // parallel workers from stepping on each other's state.
  test.describe.configure({ mode: 'serial' });

  test('shows danger banner when WA status=error and reminders enabled, navigates to reconnect', async ({
    page,
    db,
  }) => {
    const seed = await readSeedState();

    // Clean up and seed fresh data for this test
    await db.sql`DELETE FROM public.reminder_settings WHERE user_id = ${seed.userId}`;
    await db.sql`DELETE FROM public.whatsapp_accounts WHERE user_id = ${seed.userId}`;

    // Insert whatsapp_account with status='error'
    await db.sql`
      INSERT INTO public.whatsapp_accounts (id, user_id, provider, account_id, phone_number, display_name, status, consent_given_at)
      VALUES (
        ${WHATSAPP_ACCOUNT_ID},
        ${seed.userId},
        'twilio',
        'MG00000000000000000000000000000000',
        '+5511987654321',
        'Dra. Teste',
        'error',
        now()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        status = 'error';
    `;

    // Insert reminder_settings with at least one reminder enabled
    await db.sql`
      INSERT INTO public.reminder_settings (user_id, early_reminder_hours, final_reminder_hours, video_link_minutes, send_during_night)
      VALUES (
        ${seed.userId},
        24,
        2,
        30,
        false
      )
      ON CONFLICT (user_id) DO UPDATE SET
        early_reminder_hours = 24,
        final_reminder_hours = 2;
    `;

    // Navigate to the dashboard (a different page than other whatsapp tests
    // use) to get a fresh layout render. The dashboard is a lightweight page
    // that always renders the (app) layout including the banner.
    const cacheBust = Date.now();
    await page.goto(`/dashboard?_=${cacheBust}`, { waitUntil: 'networkidle' });

    // Verify the health banner appears
    const banner = page.getByTestId('whatsapp-health-banner');
    await expect(banner).toBeVisible({ timeout: 15000 });

    // Verify the banner text
    await expect(banner).toContainText('Sua conexao com WhatsApp expirou');
    await expect(banner).toContainText('Lembretes nao estao sendo enviados');

    // Verify the "Reconectar" link is present
    const reconnectLink = banner.getByRole('link', { name: 'Reconectar' });
    await expect(reconnectLink).toBeVisible();

    // Click "Reconectar" and verify navigation
    await reconnectLink.click();
    await page.waitForURL('**/configuracoes/integracoes/whatsapp', { timeout: 10000 });
  });

  test('does NOT show banner when WA status=active', async ({ page, db }) => {
    const seed = await readSeedState();

    // Clean up and seed fresh data for this test
    await db.sql`DELETE FROM public.reminder_settings WHERE user_id = ${seed.userId}`;
    await db.sql`DELETE FROM public.whatsapp_accounts WHERE user_id = ${seed.userId}`;

    // Insert whatsapp_account with status='active' (healthy)
    await db.sql`
      INSERT INTO public.whatsapp_accounts (id, user_id, provider, account_id, phone_number, display_name, status, consent_given_at)
      VALUES (
        ${WHATSAPP_ACCOUNT_ID},
        ${seed.userId},
        'twilio',
        'MG00000000000000000000000000000000',
        '+5511987654321',
        'Dra. Teste',
        'active',
        now()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        status = 'active';
    `;

    // Insert reminder_settings with reminders enabled
    await db.sql`
      INSERT INTO public.reminder_settings (user_id, early_reminder_hours, final_reminder_hours, video_link_minutes, send_during_night)
      VALUES (
        ${seed.userId},
        24,
        2,
        30,
        false
      )
      ON CONFLICT (user_id) DO UPDATE SET
        early_reminder_hours = 24,
        final_reminder_hours = 2;
    `;

    // Navigate to the dashboard with a fresh render
    const cacheBust = Date.now();
    await page.goto(`/dashboard?_=${cacheBust}`, { waitUntil: 'networkidle' });

    // Wait for the page to load
    await expect(page.getByText('HubrityP')).toBeVisible({ timeout: 15000 });

    // Verify the banner is NOT present
    await expect(page.getByTestId('whatsapp-health-banner')).not.toBeVisible();
  });
});
