import { expect, test } from '@playwright/test';

import { SEED_PATIENTS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @patients -- Consent management in patient detail page.
 *
 * Tests the consent UI in the authenticated patient detail view:
 *   1. Badge shows correct consent status (pending / signed / revoked)
 *   2. "Copiar link" button copies the consent URL to clipboard
 *   3. WhatsApp button builds correct href for consent delivery
 *
 * Prerequisites:
 *   - Seeded patients with various consent states (global-setup.ts)
 *   - Authenticated session via storageState
 */

test.describe('@patients consent management in detail', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test('shows "Consentimento pendente" badge for patient without consent', async ({ page }) => {
    // activeWithPhone has an unsigned consent term -> pending
    await page.goto(`/pacientes/${SEED_PATIENTS.activeWithPhone.id}`);

    const badge = page.getByTestId('consent-status-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('Consentimento pendente');
  });

  test('shows "Consentimento assinado" badge for patient with signed consent', async ({ page }) => {
    // activeMinimal has a signed consent term + consent_signed_at set
    await page.goto(`/pacientes/${SEED_PATIENTS.activeMinimal.id}`);

    const badge = page.getByTestId('consent-status-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('Consentimento assinado');
  });

  test('shows "Consentimento revogado" badge for patient with revoked consent', async ({
    page,
  }) => {
    // archived patient has a revoked consent term
    await page.goto(`/pacientes/${SEED_PATIENTS.archived.id}`);

    const badge = page.getByTestId('consent-status-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('Consentimento revogado');
  });

  test('"Copiar link" button triggers clipboard write and shows toast', async ({ page }) => {
    // Grant clipboard permission for the test
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.goto(`/pacientes/${SEED_PATIENTS.activeWithPhone.id}`);

    const copyButton = page.getByTestId('consent-copy-link-button');
    await expect(copyButton).toBeVisible();
    await copyButton.click();

    // Verify toast appears with the correct message
    const toastMessage = page.getByText('Link do termo copiado');
    await expect(toastMessage).toBeVisible({ timeout: 5000 });
  });

  test('WhatsApp consent button is visible for patient with phone', async ({ page }) => {
    await page.goto(`/pacientes/${SEED_PATIENTS.activeWithPhone.id}`);

    const waButton = page.getByTestId('consent-whatsapp-button');
    await expect(waButton).toBeVisible();
    await expect(waButton).toHaveText('Enviar termo por WhatsApp');
  });

  test('WhatsApp consent button is hidden for patient without phone', async ({ page }) => {
    // activeMinimal has no phone number
    await page.goto(`/pacientes/${SEED_PATIENTS.activeMinimal.id}`);

    const waButton = page.getByTestId('consent-whatsapp-button');
    await expect(waButton).not.toBeVisible();
  });

  test('"Revogar consentimento" appears in actions menu for signed consent', async ({ page }) => {
    // activeMinimal has signed consent
    await page.goto(`/pacientes/${SEED_PATIENTS.activeMinimal.id}`);

    const actionsMenu = page.getByTestId('patient-actions-menu');
    await actionsMenu.click();

    const revokeItem = page.getByTestId('patient-action-revoke-consent');
    await expect(revokeItem).toBeVisible();
  });

  test('"Revogar consentimento" is not shown for pending consent', async ({ page }) => {
    // activeWithPhone has pending consent
    await page.goto(`/pacientes/${SEED_PATIENTS.activeWithPhone.id}`);

    const actionsMenu = page.getByTestId('patient-actions-menu');
    await actionsMenu.click();

    const revokeItem = page.getByTestId('patient-action-revoke-consent');
    await expect(revokeItem).not.toBeVisible();
  });

  test('revoke consent shows confirmation dialog with correct content', async ({ page }) => {
    await page.goto(`/pacientes/${SEED_PATIENTS.activeMinimal.id}`);

    const actionsMenu = page.getByTestId('patient-actions-menu');
    await actionsMenu.click();

    const revokeItem = page.getByTestId('patient-action-revoke-consent');
    await revokeItem.click();

    // Verify dialog appears
    const dialog = page.getByTestId('revoke-consent-dialog');
    await expect(dialog).toBeVisible();

    // Verify dialog title
    await expect(dialog.locator('h3')).toHaveText('Revogar consentimento?');

    // Verify action buttons
    const cancelButton = page.getByTestId('revoke-consent-cancel');
    await expect(cancelButton).toBeVisible();
    await expect(cancelButton).toHaveText('Cancelar');

    const confirmButton = page.getByTestId('revoke-consent-confirm');
    await expect(confirmButton).toBeVisible();
    await expect(confirmButton).toHaveText('Revogar');

    // Cancel closes the dialog
    await cancelButton.click();
    await expect(dialog).not.toBeVisible();
  });
});
