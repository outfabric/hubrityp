import { expect, test } from '@playwright/test';

import { SEED_IDOR, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @ai-transcription -- Cross-tenant IDOR (section 11.2).
 *
 * Psychologist B (the seed user, authenticated via storageState) opens a
 * `transcriptionId` that belongs to psychologist A. `getTranscriptionForReview`
 * scopes the read to `user_id = B`, so A's row is invisible: the page renders
 * the neutral not-found state, NOT the actual data and — critically — NOT A's
 * patient name.
 *
 * The fixture rows (A's user/profile/patient/transcription) are seeded once in
 * `global-setup.ts` (see SEED_IDOR). A's patient name is deliberately unique
 * so we can assert its ABSENCE from the rendered page.
 *
 * Spec: specs/ai-transcription-review-ui/spec.md
 *   Scenario "Cross-tenant IDOR is blocked".
 */
test.describe('@ai-transcription review — cross-tenant IDOR is blocked', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test("B opening A's transcription sees not-found, no patient name leak", async ({ page }) => {
    const foreignId = SEED_IDOR.transcriptionA.id;

    await page.goto(`/dashboard/transcricoes/${foreignId}/revisar`);

    // The neutral not-found state must render — owner-scoped query resolved
    // NOT_FOUND for B even though the row exists for A.
    const notFound = page.getByTestId('transcription-not-found');
    await expect(notFound).toBeVisible({ timeout: 15_000 });

    // The actual review surface must NOT be present.
    await expect(page.getByTestId('transcription-review-form')).toHaveCount(0);

    // No leak of A's patient name anywhere in the rendered document. We assert
    // against the unique seeded name and a couple of distinctive tokens.
    const body = page.locator('body');
    await expect(body).not.toContainText(SEED_IDOR.patientA.fullName);
    await expect(body).not.toContainText('Confidencial');
    await expect(body).not.toContainText('Tenant A');
  });
});
