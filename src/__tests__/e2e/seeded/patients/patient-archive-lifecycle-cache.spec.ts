import { expect, test, type Page } from '@playwright/test';

import { STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @patients — Archive lifecycle cache regression (PRD §12, section 6).
 *
 * Reproduces the bug fixed in `revalidatePath` for the archive/unarchive/delete
 * Server Actions: after archiving a patient and navigating away and back, the
 * detail page used to render a STALE Server Component (cached pre-archive), so
 * the actions menu still read "Arquivar" even though the patient was archived.
 *
 * The flow exercised here is exactly the spec scenario:
 *   1. Archive a patient from its detail page.
 *   2. Navigate to /pacientes — confirm it is ABSENT under the default active
 *      filter (archived patients are excluded).
 *   3. Re-open the patient (direct URL) — the actions menu MUST read
 *      "Desarquivar" (never a stale "Arquivar").
 *   4. Unarchive — the menu MUST read "Arquivar" again after navigation.
 *
 * Isolation: the test creates its OWN brand-new patient through the UI rather
 * than reusing a shared `SEED_PATIENTS` row. The shared seed patients are
 * read/mutated by many sibling specs under `fullyParallel` (e.g.
 * patient-edit-archive.spec.ts archives `activeMinimal` and unarchives
 * `archived`), so toggling their status here would race those specs. A fresh
 * patient owned by no other spec keeps this flow deterministic.
 */

test.describe('@patients archive lifecycle cache', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  /**
   * Opens the actions dropdown and returns the archive/unarchive menu item.
   * The item's label is driven by the server-fetched `patient.status`, so its
   * text is the assertion surface for the cache-staleness regression.
   */
  async function openActionsMenu(page: Page) {
    await page.getByTestId('patient-actions-menu').click();
    const archiveItem = page.getByTestId('patient-action-archive');
    await expect(archiveItem).toBeVisible();
    return archiveItem;
  }

  /** Confirms the archive/unarchive modal and waits for it to close. */
  async function confirmArchiveModal(page: Page) {
    const modal = page.getByTestId('archive-confirm-modal');
    await expect(modal).toBeVisible();
    await page.getByTestId('archive-confirm-submit').click();
    await expect(modal).not.toBeVisible({ timeout: 5000 });
  }

  test('archive → navigate → re-open shows "Desarquivar" (no stale "Arquivar")', async ({
    page,
  }) => {
    // ---- Create a dedicated patient through the UI so no sibling spec races us.
    const uniqueSuffix = Date.now().toString().slice(-6);
    const patientName = `Lifecycle Cache ${uniqueSuffix}`;

    await page.goto('/pacientes/novo');
    await expect(page.getByTestId('patient-form-step1')).toBeVisible();

    await page.getByTestId('patient-form-fullname').fill(patientName);
    await page.getByTestId('patient-form-type').click();
    await page.getByRole('option', { name: 'Adulto' }).click();
    await page.getByTestId('patient-form-next').click();

    await expect(page.getByTestId('patient-form-step2')).toBeVisible();
    await page.getByTestId('patient-form-skip').click();

    await page.waitForURL(/\/pacientes\/[a-f0-9-]+$/, { timeout: 10000 });
    const detailUrl = page.url();
    const patientId = detailUrl.split('/').pop();
    expect(patientId).toMatch(/^[a-f0-9-]+$/);

    // Newly created patient is active.
    const statusBadge = page.getByTestId('patient-status-badge');
    await expect(statusBadge).toHaveText('Ativo');

    // ---- Archive it from the detail page.
    const archiveItem = await openActionsMenu(page);
    await expect(archiveItem).toHaveText('Arquivar');
    await archiveItem.click();
    await confirmArchiveModal(page);

    await expect(statusBadge).toHaveText('Arquivado', { timeout: 5000 });

    // ---- Listing under the active filter must NOT show the patient.
    await page.goto('/pacientes');
    await expect(page.getByTestId('patient-list')).toBeVisible();
    // The segmented control defaults its selected state to "Ativos" but the
    // first server paint is unscoped; clicking the active filter triggers the
    // owner-scoped refetch that excludes archived patients. We assert the button
    // is the pressed state and that the just-archived patient is then absent.
    const activeFilter = page.getByTestId('patient-status-active');
    await activeFilter.click();
    await expect(activeFilter).toHaveAttribute('aria-pressed', 'true');
    // A known seed patient stays visible under the active filter, which proves
    // the refetch settled before we assert the archived one is gone.
    await expect(page.getByText('Maria Silva', { exact: false }).first()).toBeVisible();
    await expect(page.getByText(patientName, { exact: false })).toHaveCount(0);

    // ---- Re-open the patient via direct URL: the regression surface.
    await page.goto(detailUrl);
    await page.waitForURL(/\/pacientes\/[a-f0-9-]+$/);
    await expect(statusBadge).toHaveText('Arquivado');

    const reopenedArchiveItem = await openActionsMenu(page);
    // The critical assertion: a stale cached render would read "Arquivar".
    await expect(reopenedArchiveItem).toHaveText('Desarquivar');

    // ---- Unarchive and confirm the label flips back after navigation.
    await reopenedArchiveItem.click();
    await confirmArchiveModal(page);
    await expect(statusBadge).toHaveText('Ativo', { timeout: 5000 });

    // Navigate away and back so we read a fresh server render, then assert the
    // menu reads "Arquivar" again (the unarchive also revalidated the cache).
    await page.goto('/pacientes');
    await expect(page.getByTestId('patient-list')).toBeVisible();

    await page.goto(detailUrl);
    await page.waitForURL(/\/pacientes\/[a-f0-9-]+$/);
    await expect(statusBadge).toHaveText('Ativo');

    const finalArchiveItem = await openActionsMenu(page);
    await expect(finalArchiveItem).toHaveText('Arquivar');
  });
});
