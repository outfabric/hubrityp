import { expect, test } from '@playwright/test';

import { SEED_PATIENTS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @agenda -- Location CRUD E2E tests.
 *
 * Tests the full location management flow:
 *   1. Navigate to /configuracoes/locais
 *   2. Verify empty state
 *   3. Create a location "Consultorio Centro" (Presencial)
 *   4. Verify the location card appears
 *   5. Edit the name to "Consultorio Sul"
 *   6. Verify the updated name
 *   7. Mark the location as default
 *   8. Verify the "Padrao" badge
 *   9. Create a session and verify the default location is pre-selected
 *
 * Prerequisites:
 *   - Seeded session (storageState) provides an authenticated psychologist.
 *   - No locations are pre-seeded (the empty state should show).
 */

test.describe('@agenda location CRUD', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test('creates a location, edits it, marks as default, and verifies pre-selection in session form', async ({
    page,
  }) => {
    // ---- Step 1: Navigate to locations page and verify empty state ----
    await page.goto('/configuracoes/locais');

    // Verify the page title
    await expect(page.getByTestId('locations-page-title')).toBeVisible();
    await expect(page.getByTestId('locations-page-title')).toHaveText('Locais de Atendimento');

    // Verify the empty state is shown (no locations seeded)
    const emptyState = page.getByTestId('locations-empty-state');
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText('Nenhum local cadastrado');

    // ---- Step 2: Create a location "Consultorio Centro" ----
    // Click the "Adicionar local" button in the empty state
    await page.getByTestId('empty-state-add-location').click();

    // The location form modal should appear
    await expect(page.getByTestId('location-form-modal')).toBeVisible();

    // Fill the name
    const nameInput = page.getByTestId('location-form-name');
    await nameInput.fill('Consultorio Centro');

    // Select the type "Presencial" — it is the default, but verify it is set
    const typeSelect = page.getByTestId('location-form-type');
    await expect(typeSelect).toBeVisible();
    // "Presencial" (in_person) is the default. Click the trigger to see options
    // and verify Presencial is selected.
    await typeSelect.click();
    await page.getByRole('option', { name: 'Presencial' }).click();

    // Click "Salvar"
    await page.getByTestId('location-form-save').click();

    // Wait for the modal to close
    await expect(page.getByTestId('location-form-modal')).toBeHidden({ timeout: 10000 });

    // Verify success toast
    await expect(page.getByText('Local criado com sucesso.')).toBeVisible({ timeout: 5000 });

    // ---- Step 3: Verify the location card appears ----
    // The empty state should be gone now
    await expect(emptyState).toBeHidden({ timeout: 5000 });

    // A location card should be visible with the name "Consultorio Centro"
    const locationCard = page.locator('[data-testid^="location-card-"]').first();
    await expect(locationCard).toBeVisible({ timeout: 5000 });
    await expect(locationCard).toContainText('Consultorio Centro');
    await expect(locationCard).toContainText('Presencial');

    // Extract the location ID from the card's data-testid
    const cardTestId = await locationCard.getAttribute('data-testid');
    const locationId = cardTestId?.replace('location-card-', '') ?? '';

    // ---- Step 4: Edit the location name to "Consultorio Sul" ----
    // Open the actions dropdown
    await page.getByTestId(`location-actions-${locationId}`).click();

    // Click "Editar"
    await page.getByTestId(`location-edit-${locationId}`).click();

    // The form modal should open in edit mode
    await expect(page.getByTestId('location-form-modal')).toBeVisible();

    // Clear and fill the new name
    const editNameInput = page.getByTestId('location-form-name');
    await editNameInput.clear();
    await editNameInput.fill('Consultorio Sul');

    // Click "Salvar"
    await page.getByTestId('location-form-save').click();

    // Wait for the modal to close
    await expect(page.getByTestId('location-form-modal')).toBeHidden({ timeout: 10000 });

    // Verify success toast
    await expect(page.getByText('Local atualizado com sucesso.')).toBeVisible({ timeout: 5000 });

    // Verify the card now shows "Consultorio Sul"
    await expect(locationCard).toContainText('Consultorio Sul');

    // ---- Step 5: Mark as default ----
    // Open the actions dropdown again
    await page.getByTestId(`location-actions-${locationId}`).click();

    // Click "Marcar como padrao"
    await page.getByTestId(`location-set-default-${locationId}`).click();

    // Verify success toast
    await expect(page.getByText('Local marcado como padrao.')).toBeVisible({ timeout: 5000 });

    // Verify the "Padrao" badge appears on the card
    const defaultBadge = page.getByTestId('location-default-badge');
    await expect(defaultBadge).toBeVisible({ timeout: 5000 });
    await expect(defaultBadge).toHaveText('Padrao');

    // ---- Step 6: Verify default location is pre-selected in session form ----
    // Navigate to the agenda page
    await page.goto('/agenda');
    await expect(page.getByTestId('agenda-page-title')).toBeVisible();

    // Open the session creation modal
    await page.getByTestId('schedule-button').click();
    await expect(page.getByTestId('session-form-modal')).toBeVisible();

    // Search and select a patient (required to see location selector)
    const patientName = SEED_PATIENTS.activeWithPhone.fullName;
    const patientSearch = page.getByTestId('session-form-patient-search');
    await patientSearch.fill(patientName);

    const patientResults = page.getByTestId('session-form-patient-results');
    await expect(patientResults).toBeVisible({ timeout: 5000 });

    const patientOption = page.getByTestId(`patient-option-${SEED_PATIENTS.activeWithPhone.id}`);
    await expect(patientOption).toBeVisible({ timeout: 5000 });
    await patientOption.click();

    // The location selector should be visible and pre-selected with the
    // default location "Consultorio Sul".
    const locationSelect = page.getByTestId('session-form-location');
    await expect(locationSelect).toBeVisible();
    await expect(locationSelect).toContainText('Consultorio Sul');

    // Close the modal
    await page.getByTestId('session-form-cancel').click();
    await expect(page.getByTestId('session-form-modal')).toBeHidden();
  });
});
