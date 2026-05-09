import { expect, test } from '@playwright/test';

import { SEED_PATIENTS, STORAGE_STATE_PATH } from '../setup/seed-state';

test.describe('@patients patient anamnesis tab', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test('fills anamnesis section, auto-saves, and persists after reload', async ({ page }) => {
    // Navigate to patient detail page
    await page.goto(`/pacientes/${SEED_PATIENTS.activeWithPhone.id}`);
    await page.waitForURL(/\/pacientes\/[a-f0-9-]+$/);

    // Click the "Anamnese" tab
    const anamnesisTab = page.getByTestId('patient-tab-anamnesis');
    await expect(anamnesisTab).toBeVisible();
    await anamnesisTab.click();

    // Verify anamnesis tab content is visible
    const anamnesisContent = page.getByTestId('patient-tab-content-anamnesis');
    await expect(anamnesisContent).toBeVisible();

    const anamnesisTabComponent = page.getByTestId('anamnesis-tab');
    await expect(anamnesisTabComponent).toBeVisible();

    // Verify the "Queixa Principal" section card is visible
    const chiefComplaintSection = page.getByTestId('anamnesis-section-chiefComplaint');
    await expect(chiefComplaintSection).toBeVisible();

    // Type text into the chief complaint editor. TiptapEditor uses ProseMirror
    // which intercepts input at the ContentEditable level — standard `fill()`
    // does not trigger Tiptap's `onUpdate`. We use `pressSequentially` to
    // simulate real keystrokes that ProseMirror processes correctly.
    const editorArea = chiefComplaintSection.locator('.ProseMirror').first();
    await expect(editorArea).toBeVisible();

    const testText = 'Paciente relata dificuldade';
    await editorArea.click();
    await editorArea.pressSequentially(testText, { delay: 10 });

    // Click manual save button to persist immediately (instead of waiting 10s auto-save)
    const saveButton = page.getByTestId('anamnesis-save-button');
    await expect(saveButton).toBeEnabled({ timeout: 5_000 });
    await saveButton.click();

    // Wait for the save to complete — the auto-save indicator should show "Salvo as HH:MM"
    const savedIndicator = page.getByTestId('anamnesis-autosave-saved');
    await expect(savedIndicator).toBeVisible({ timeout: 10_000 });
    await expect(savedIndicator).toContainText('Salvo as');

    // Reload the page to confirm persistence
    await page.reload();
    await page.waitForURL(/\/pacientes\/[a-f0-9-]+$/);

    // Navigate back to anamnesis tab
    const anamnesisTabAfterReload = page.getByTestId('patient-tab-anamnesis');
    await anamnesisTabAfterReload.click();

    // Verify the content persisted
    const chiefComplaintAfterReload = page.getByTestId('anamnesis-section-chiefComplaint');
    await expect(chiefComplaintAfterReload).toBeVisible();

    const editorAfterReload = chiefComplaintAfterReload.locator('.ProseMirror').first();
    await expect(editorAfterReload).toContainText(testText, { timeout: 10_000 });
  });

  test('all 8 standard sections are rendered', async ({ page }) => {
    await page.goto(`/pacientes/${SEED_PATIENTS.activeWithPhone.id}`);
    await page.waitForURL(/\/pacientes\/[a-f0-9-]+$/);

    const anamnesisTab = page.getByTestId('patient-tab-anamnesis');
    await anamnesisTab.click();

    const sectionKeys = [
      'chiefComplaint',
      'historyPresentIllness',
      'familyHistory',
      'educationalProfessional',
      'physicalHealth',
      'priorTherapy',
      'initialHypothesis',
      'treatmentPlan',
    ];

    for (const key of sectionKeys) {
      const section = page.getByTestId(`anamnesis-section-${key}`);
      await expect(section).toBeVisible();
    }
  });
});
