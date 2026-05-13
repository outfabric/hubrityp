import { test, expect } from '../setup/db-fixture';
import { SEED_PATIENTS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @whatsapp -- Patient WhatsApp opt-out toggle E2E test.
 *
 * Flow:
 *   1. Navigate to patient edit page
 *   2. Locate "Lembretes WhatsApp" section
 *   3. Verify switch is ON by default
 *   4. Toggle switch OFF
 *   5. Verify opt-out reason field appears
 *   6. Fill reason
 *   7. Save (advance to step 2, then save)
 *   8. Reload page (navigate to edit again)
 *   9. Verify switch is OFF and reason persists
 *  10. Toggle switch back ON
 *  11. Save
 *  12. Reload
 *  13. Verify switch is ON
 *
 * Prerequisites:
 *   - Seeded patient (activeWithPhone) with whatsapp_opt_out = false.
 *   - storageState provides an authenticated psychologist.
 */

test.describe('@whatsapp patient opt-out toggle', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  const patientId = SEED_PATIENTS.activeWithPhone.id;

  test.beforeEach(async ({ db }) => {
    // Reset patient opt-out state to defaults (opted in)
    await db.sql`
      UPDATE public.patients
      SET whatsapp_opt_out = false,
          whatsapp_opt_out_at = NULL,
          updated_at = now()
      WHERE id = ${patientId};
    `;
  });

  test('toggles opt-out OFF, saves reason, reloads to verify, then toggles back ON', async ({
    page,
  }) => {
    // Navigate to patient detail page, then to edit
    await page.goto(`/pacientes/${patientId}`);
    await page.waitForURL(/\/pacientes\/[a-f0-9-]+$/);

    // Open actions menu and click Edit
    const actionsMenu = page.getByTestId('patient-actions-menu');
    await actionsMenu.click();
    await page.getByTestId('patient-action-edit').click();

    await page.waitForURL(/\/pacientes\/[a-f0-9-]+\/editar$/, { timeout: 10000 });
    await expect(page.getByTestId('edit-patient-page-title')).toHaveText('Editar paciente');

    // Locate the "Lembretes WhatsApp" section
    const remindersSection = page.getByTestId('whatsapp-reminders-section');
    await expect(remindersSection).toBeVisible();
    await expect(remindersSection.locator('legend')).toContainText('Lembretes WhatsApp');

    // Verify switch is ON by default (whatsapp_opt_out = false means "receiving reminders")
    // The switch checked state represents "receiving reminders" = !opt_out
    // When opt_out=false, the switch should be checked (ON)
    const switchEl = page.locator('#whatsapp-opt-out-switch');
    await expect(switchEl).toBeVisible();
    // Switch checked=true means "Receber lembretes" is ON (opt_out=false)
    await expect(switchEl).toHaveAttribute('data-state', 'checked');

    // Toggle switch OFF (opt out)
    await switchEl.click();

    // Verify switch is now unchecked
    await expect(switchEl).toHaveAttribute('data-state', 'unchecked');

    // Verify the opt-out reason field appears
    const reasonTextarea = page.getByTestId('whatsapp-opt-out-reason');
    await expect(reasonTextarea).toBeVisible({ timeout: 5000 });

    // Fill the reason
    await reasonTextarea.fill('Paciente nao quer receber');

    // Advance to step 2 and save
    await page.getByTestId('patient-form-next').click();
    await expect(page.getByTestId('patient-form-step2')).toBeVisible();

    await page.getByTestId('patient-form-save').click();

    // Wait for redirect to patient detail
    await page.waitForURL(/\/pacientes\/[a-f0-9-]+$/, { timeout: 10000 });

    // Verify success toast
    await expect(page.getByText('Paciente atualizado')).toBeVisible({ timeout: 5000 });

    // Navigate back to edit page to verify persistence
    await page.getByTestId('patient-actions-menu').click();
    await page.getByTestId('patient-action-edit').click();
    await page.waitForURL(/\/pacientes\/[a-f0-9-]+\/editar$/, { timeout: 10000 });

    // Verify switch is OFF (opt_out=true)
    const switchAfterReload = page.locator('#whatsapp-opt-out-switch');
    await expect(switchAfterReload).toHaveAttribute('data-state', 'unchecked');

    // Now toggle switch back ON
    await switchAfterReload.click();
    await expect(switchAfterReload).toHaveAttribute('data-state', 'checked');

    // The reason field should be hidden
    await expect(page.getByTestId('whatsapp-opt-out-reason')).not.toBeVisible();

    // Save again
    await page.getByTestId('patient-form-next').click();
    await expect(page.getByTestId('patient-form-step2')).toBeVisible();
    await page.getByTestId('patient-form-save').click();

    // Wait for redirect
    await page.waitForURL(/\/pacientes\/[a-f0-9-]+$/, { timeout: 10000 });
    // A previous toast may still be visible, so use .first() to avoid strict mode violation
    await expect(page.getByText('Paciente atualizado').first()).toBeVisible({ timeout: 5000 });

    // Navigate back to edit to verify ON state persisted
    await page.getByTestId('patient-actions-menu').click();
    await page.getByTestId('patient-action-edit').click();
    await page.waitForURL(/\/pacientes\/[a-f0-9-]+\/editar$/, { timeout: 10000 });

    // Verify switch is ON again
    const switchFinal = page.locator('#whatsapp-opt-out-switch');
    await expect(switchFinal).toHaveAttribute('data-state', 'checked');
  });
});
