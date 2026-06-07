import { expect } from '@playwright/test';

import { test } from '../setup/db-fixture';
import { SEED_PATIENTS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @prontuario -- Psychometric Scales E2E tests.
 *
 * Tests the "Escalas" tab inside the prontuario shell:
 *   1. In-session flow: select PHQ-9, answer all 9 items, submit, assert score + badge
 *   2. Remote flow: generate link, open unauthenticated, fill, submit "Obrigado",
 *      return to psychologist view and assert score
 *   3. Chart: seed 3 applications, open history sheet, assert 3 Recharts dots
 *   4. Expired token: navigate to `/escala/{expired-token}`, assert expired message
 *   5. Middleware negative: unauthenticated GET to `/escala/{token}` does NOT redirect
 *
 * Prerequisites:
 *   - Seeded storageState provides an authenticated psychologist.
 *   - Patient with ID SEED_PATIENTS.activeMinimal exists (seeded in globalSetup).
 *   - scale_applications rows cleaned in beforeEach.
 */

const SEED_USER_ID = '00000000-0000-4000-8000-000000000001';
const patientId = SEED_PATIENTS.activeMinimal.id;

// ---------------------------------------------------------------------------
// All scales tests that mutate scale_applications for the same patient/user
// pair MUST run serially — parallel execution causes data races where one
// test's beforeEach cleanup deletes another test's in-flight application.
// The expired-token and negative-auth tests are included to avoid any
// cross-describe data interference (expired token inserts into the same table).
// ---------------------------------------------------------------------------

test.describe('@prontuario scales', () => {
  test.describe.configure({ mode: 'serial' });

  // ---------------------------------------------------------------------------
  // 13.1 — In-session PHQ-9 flow
  // ---------------------------------------------------------------------------

  test.describe('@prontuario scales in-session PHQ-9', () => {
    test.use({ storageState: STORAGE_STATE_PATH });
    test.setTimeout(90_000);

    test.beforeEach(async ({ db }) => {
      // Clean all scale applications for this patient+user pair
      await db.sql`
      DELETE FROM public.scale_applications
      WHERE patient_id = ${patientId}
        AND user_id = ${SEED_USER_ID}
    `;
    });

    test('applies PHQ-9 in-session and sees score + classification badge', async ({ page }) => {
      // 1. Navigate to prontuario page
      await page.goto(`/pacientes/${patientId}/prontuario`);
      await expect(page.getByTestId('prontuario-page-title')).toBeVisible();

      // 2. Click the "Escalas" tab
      await page.getByTestId('prontuario-tab-escalas').click();
      await expect(page.getByTestId('prontuario-tab-content-escalas')).toBeVisible();

      // 3. Click "Aplicar nova escala"
      await page.getByTestId('scales-apply-button').click();

      // 4. Scale selection modal should open
      await expect(page.getByTestId('scale-select-modal')).toBeVisible();

      // 5. Select PHQ-9 from the radio group
      await page.getByTestId('scale-card-phq9').click();

      // 6. Click "Continuar"
      await page.getByTestId('scale-select-next').click();

      // 7. Mode selection step should appear — "Aplicar agora" is default
      await expect(page.getByTestId('mode-selection-radio-group')).toBeVisible();

      // 8. Click "Confirmar" (in-session mode is default)
      await page.getByTestId('mode-select-confirm').click();

      // 9. The ScaleApplicationForm should appear with 9 questions
      await expect(page.getByTestId('scale-application-form')).toBeVisible({ timeout: 15_000 });

      // 10. Answer all 9 PHQ-9 questions with value 0 ("Nenhuma vez")
      // Total score = 0 -> classification "Minimo" -> severity "minimal" -> badge "success"
      for (let i = 1; i <= 9; i++) {
        const questionGroup = page.getByTestId(`scale-question-q${i}`);
        await expect(questionGroup).toBeVisible();
        // Select the first option (value=0, "Nenhuma vez")
        await questionGroup.getByRole('radio', { name: 'Nenhuma vez' }).click();
      }

      // 11. Click "Salvar no prontuario"
      await page.getByTestId('scale-form-submit').click();

      // 12. Assert the result display appears with score and classification badge
      await expect(page.getByTestId('scale-result-display')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('scale-total-score')).toHaveText('0');

      // 13. Assert classification badge text and semantic variant
      const badge = page.getByTestId('scale-classification-badge');
      await expect(badge).toHaveText('Minimo');
      // severity "minimal" maps to badge variant "success" (bg-success-50 text-success-700)
      await expect(badge).toHaveClass(/bg-success-50/);
    });
  });

  // ---------------------------------------------------------------------------
  // 13.2 — Remote flow
  // ---------------------------------------------------------------------------

  test.describe('@prontuario scales remote flow', () => {
    test.use({ storageState: STORAGE_STATE_PATH });
    test.setTimeout(120_000);

    test.beforeEach(async ({ db }) => {
      await db.sql`
      DELETE FROM public.scale_applications
      WHERE patient_id = ${patientId}
        AND user_id = ${SEED_USER_ID}
    `;
    });

    test('generates remote link, patient fills and submits, psychologist sees score', async ({
      page,
      browser,
    }) => {
      // 1. Navigate to prontuario > Escalas tab
      await page.goto(`/pacientes/${patientId}/prontuario`);
      await expect(page.getByTestId('prontuario-page-title')).toBeVisible();
      await page.getByTestId('prontuario-tab-escalas').click();
      await expect(page.getByTestId('prontuario-tab-content-escalas')).toBeVisible();

      // 2. Open modal and select PHQ-9
      await page.getByTestId('scales-apply-button').click();
      await expect(page.getByTestId('scale-select-modal')).toBeVisible();
      await page.getByTestId('scale-card-phq9').click();
      await page.getByTestId('scale-select-next').click();

      // 3. Select "Enviar link ao paciente" mode
      await expect(page.getByTestId('mode-selection-radio-group')).toBeVisible();
      await page.getByTestId('mode-remote-card').click();

      // 4. Click "Confirmar"
      await page.getByTestId('mode-select-confirm').click();

      // 5. Remote link display should appear
      const remoteInput = page.getByTestId('remote-link-input');
      await expect(remoteInput).toBeVisible({ timeout: 15_000 });

      // 6. Extract the remote URL
      const remoteUrl = await remoteInput.inputValue();
      expect(remoteUrl).toContain('/escala/');

      // 7. Close the modal
      await page.getByTestId('remote-link-close').click();

      // 8. Open a NEW browser context (no auth) to simulate the patient
      const patientContext = await browser.newContext({
        // No storageState — anonymous
      });
      const patientPage = await patientContext.newPage();

      // 9. Navigate to the remote URL
      const urlPath = new URL(remoteUrl).pathname;
      await patientPage.goto(urlPath);

      // 10. The public form should be visible with 9 questions
      await expect(patientPage.getByTestId('scale-public-form')).toBeVisible({ timeout: 15_000 });

      // 11. Answer all 9 questions with value 1 ("Vários dias")
      // Total score = 9 -> classification "Leve" -> severity "mild"
      for (let i = 1; i <= 9; i++) {
        const questionGroup = patientPage.getByTestId(`scale-question-q${i}`);
        await expect(questionGroup).toBeVisible();
        await questionGroup.getByRole('radio', { name: 'Vários dias' }).click();
      }

      // 12. Click "Enviar respostas"
      await patientPage.getByTestId('scale-submit-button').click();

      // 13. Assert "Obrigado" success message
      await expect(patientPage.getByTestId('scale-submit-success')).toBeVisible({
        timeout: 15_000,
      });
      await expect(patientPage.getByText('Obrigado!')).toBeVisible();
      await expect(
        patientPage.getByText('Suas respostas foram enviadas ao seu psicólogo.'),
      ).toBeVisible();

      // Close the patient context
      await patientContext.close();

      // 14. Return to the psychologist view — reload to fetch the updated data
      await page.reload();
      await expect(page.getByTestId('prontuario-page-title')).toBeVisible();

      // Re-navigate to Escalas tab (tabs reset on reload)
      await page.getByTestId('prontuario-tab-escalas').click();
      await expect(page.getByTestId('prontuario-tab-content-escalas')).toBeVisible();

      // 15. Assert the score appeared in the ScalesTab (PHQ-9 summary card)
      const summaryCard = page.getByTestId('scale-summary-card-phq9');
      await expect(summaryCard).toBeVisible({ timeout: 15_000 });
      await expect(summaryCard).toContainText('Pontuação: 9');
    });
  });

  // ---------------------------------------------------------------------------
  // 13.3 — Chart with 3 data points
  // ---------------------------------------------------------------------------

  test.describe('@prontuario scales chart rendering', () => {
    test.use({ storageState: STORAGE_STATE_PATH });
    test.setTimeout(60_000);

    test.beforeEach(async ({ db }) => {
      await db.sql`
      DELETE FROM public.scale_applications
      WHERE patient_id = ${patientId}
        AND user_id = ${SEED_USER_ID}
    `;
    });

    test('renders chart with 3 visible dot elements for 3 PHQ-9 applications', async ({
      page,
      db,
    }) => {
      // Seed 3 completed PHQ-9 applications with different scores and dates
      const applications = [
        {
          id: '00000000-0000-4000-8000-000000000070',
          score: 3,
          classification: 'Minimo',
          appliedAt: '2026-01-15 10:00:00+00',
        },
        {
          id: '00000000-0000-4000-8000-000000000071',
          score: 8,
          classification: 'Leve',
          appliedAt: '2026-02-15 10:00:00+00',
        },
        {
          id: '00000000-0000-4000-8000-000000000072',
          score: 15,
          classification: 'Moderado',
          appliedAt: '2026-03-15 10:00:00+00',
        },
      ];

      for (const app of applications) {
        await db.sql`
        INSERT INTO public.scale_applications (
          id, user_id, patient_id, scale_key,
          applied_at, responses, total_score, classification,
          completed_at, applied_remotely
        ) VALUES (
          ${app.id},
          ${SEED_USER_ID},
          ${patientId},
          'phq9',
          ${app.appliedAt}::timestamptz,
          '{"q1":1,"q2":1,"q3":0,"q4":0,"q5":0,"q6":0,"q7":0,"q8":0,"q9":0}'::jsonb,
          ${app.score},
          ${app.classification},
          ${app.appliedAt}::timestamptz,
          false
        )
        ON CONFLICT (id) DO NOTHING
      `;
      }

      // 1. Navigate to prontuario > Escalas tab
      await page.goto(`/pacientes/${patientId}/prontuario`);
      await expect(page.getByTestId('prontuario-page-title')).toBeVisible();
      await page.getByTestId('prontuario-tab-escalas').click();
      await expect(page.getByTestId('prontuario-tab-content-escalas')).toBeVisible();

      // 2. Wait for the PHQ-9 summary card to appear
      const summaryCard = page.getByTestId('scale-summary-card-phq9');
      await expect(summaryCard).toBeVisible({ timeout: 15_000 });

      // 3. Click "Ver historico completo" to open the history sheet
      await page.getByTestId('scale-history-btn-phq9').click();

      // 4. Wait for the chart container to render
      const chartContainer = page.getByTestId('scale-history-chart');
      await expect(chartContainer).toBeVisible({ timeout: 10_000 });

      // 5. Assert exactly 3 chart dots are rendered (one per data point)
      const dots = chartContainer.locator('[data-testid="chart-dot"]');
      await expect(dots).toHaveCount(3);
    });
  });

  // ---------------------------------------------------------------------------
  // 13.4 — Expired token UI
  // ---------------------------------------------------------------------------

  test.describe('@prontuario scales expired token', () => {
    // No storageState needed — this is a public page
    test.setTimeout(30_000);

    test.beforeEach(async ({ db }) => {
      // Seed an expired scale application with a known token
      const expiredToken = 'f'.repeat(64); // deterministic 64-char token
      await db.sql`
      INSERT INTO public.scale_applications (
        id, user_id, patient_id, scale_key,
        applied_remotely, remote_token, token_expires_at,
        completed_at
      ) VALUES (
        '00000000-0000-4000-8000-000000000080',
        ${SEED_USER_ID},
        ${patientId},
        'phq9',
        true,
        ${expiredToken},
        now() - interval '1 day',
        NULL
      )
      ON CONFLICT (id) DO UPDATE SET
        remote_token = EXCLUDED.remote_token,
        token_expires_at = EXCLUDED.token_expires_at,
        completed_at = NULL
    `;
    });

    test('shows expired message for an expired token', async ({ page }) => {
      const expiredToken = 'f'.repeat(64);

      await page.goto(`/escala/${expiredToken}`);

      // Assert the expired state is rendered
      const expiredState = page.getByTestId('scale-expired');
      await expect(expiredState).toBeVisible({ timeout: 10_000 });
      await expect(
        page.getByText('Este link expirou. Solicite um novo ao seu psicologo.'),
      ).toBeVisible();
    });
  });

  // ---------------------------------------------------------------------------
  // 13.5 — Middleware negative test: /escala/* is public
  // ---------------------------------------------------------------------------

  test.describe('@prontuario scales public route (negative-auth)', () => {
    // NO storageState — unauthenticated browser context
    test.setTimeout(30_000);

    test('unauthenticated GET to /escala/{token} does NOT redirect to login', async ({ page }) => {
      // Use an arbitrary token — the test only cares that the middleware
      // does not redirect to /login, regardless of whether the token is valid
      const arbitraryToken = 'a'.repeat(64);

      const response = await page.goto(`/escala/${arbitraryToken}`);

      // Wait for the page to settle — should NOT redirect to /login
      // The page should stay on /escala/... and render the expired/not-found state
      // (since the token doesn't exist, it renders as expired)
      const url = new URL(page.url());
      expect(url.pathname).not.toBe('/login');
      expect(url.pathname).toContain('/escala/');

      // Verify the response is not a server error
      expect(response?.status()).toBeLessThan(500);

      // Confirm the page content rendered (the expired state, since token doesn't exist)
      // This proves the page is accessible without auth
      await expect(page.getByTestId('scale-expired')).toBeVisible({ timeout: 10_000 });
    });
  });
}); // close outer @prontuario scales serial describe
