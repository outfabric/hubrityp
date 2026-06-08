import { expect, test } from '@playwright/test';
import pgModule from 'postgres';

import { readSeedState, SEED_PATIENTS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @ai-transcription -- Deep-link `?status=ready` opens the Pendentes tab,
 * negative-auth gating, and graceful degradation of an unknown status value
 * (PRD 12 §9 / RF-12.16 / RN-12.05; spec:
 * specs/ai-transcription-review-ui/spec.md).
 *
 * Three scenarios are covered here:
 *
 *   4.1 The dashboard "Pendências" AI-notes row links to
 *       `/dashboard/transcricoes?status=ready`. Clicking it lands on the review
 *       list with the Pendentes tab ALREADY active on first render (the tab is
 *       resolved server-side from the param — there must be no client flip from
 *       a different default). To make "Pendentes is active" meaningful (and not
 *       just the only populated bucket), this spec seeds the user with
 *       transcriptions in MULTIPLE buckets (a dedicated `reviewed` and `failed`
 *       row alongside the always-seeded `ready` rows).
 *
 *   4.2 An anonymous GET of the deep-linked URL is redirected to `/login` by
 *       the Edge middleware before any Server Component runs.
 *
 *   4.3 An authenticated load of `?status=xyz` (unknown value) degrades to the
 *       default Pendentes tab with no error and no blank screen — the parser is
 *       a closed allowlist (`resolveInitialTabFromStatus`), so an out-of-set
 *       value can never select a filter outside the allowlist.
 */

// Dedicated transcription rows owned by the seed user, used ONLY by this spec
// to guarantee that the `reviewed` and `failed` buckets are non-empty (so the
// active-tab assertion proves a server-resolved deep link, not a default that
// happens to fall on the only populated bucket). The IDs are unique to this
// file so parallel specs against the shared Testcontainers DB never collide,
// and `afterAll` removes them so other specs see the baseline fixture.
const DEEP_LINK_TRANSCRIPTIONS = {
  reviewed: {
    id: '00000000-0000-4000-8000-0000000000e1',
    audioObjectKey: 'ai-audio/seed-user/deep-link-reviewed-audio.mp3',
  },
  failed: {
    id: '00000000-0000-4000-8000-0000000000e2',
    audioObjectKey: 'ai-audio/seed-user/deep-link-failed-audio.mp3',
  },
} as const;

test.describe('@ai-transcription deep-link — status param → initial tab', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  // A canonical valid generated note (GeneratedNoteSchema v1) — the list query
  // never re-validates it, but using a real shape keeps the fixture honest.
  const generatedNote = JSON.stringify({
    schemaVersion: 1,
    humorInicial: 'Deep-link fixture',
    humorFinal: 'Deep-link fixture',
    pauta: [],
    conteudoTrabalhado: [],
    tarefaCasa: [],
    palavrasRisco: [],
    observacoesExtras: '',
  });

  test.beforeAll(async () => {
    const seed = await readSeedState();
    const sql = pgModule(seed.databaseUrl, { max: 1, onnotice: () => {} });
    try {
      // `reviewed` bucket row.
      await sql`
        INSERT INTO public.ai_transcriptions (
          id, user_id, patient_id, source,
          audio_object_key, status, generated_note, saved_to_prontuario, reviewed_at
        )
        VALUES (
          ${DEEP_LINK_TRANSCRIPTIONS.reviewed.id},
          ${seed.userId},
          ${SEED_PATIENTS.activeMinimal.id},
          'manual_upload',
          ${DEEP_LINK_TRANSCRIPTIONS.reviewed.audioObjectKey},
          'reviewed',
          ${generatedNote}::jsonb,
          true,
          now()
        )
        ON CONFLICT (id) DO UPDATE SET
          status              = 'reviewed',
          saved_to_prontuario = true,
          generated_note      = EXCLUDED.generated_note,
          reviewed_at         = now();
      `;

      // `failed` bucket row.
      await sql`
        INSERT INTO public.ai_transcriptions (
          id, user_id, patient_id, source,
          audio_object_key, status, error_code
        )
        VALUES (
          ${DEEP_LINK_TRANSCRIPTIONS.failed.id},
          ${seed.userId},
          ${SEED_PATIENTS.activeMinimal.id},
          'manual_upload',
          ${DEEP_LINK_TRANSCRIPTIONS.failed.audioObjectKey},
          'failed',
          'transcription_failed'
        )
        ON CONFLICT (id) DO UPDATE SET
          status     = 'failed',
          error_code = 'transcription_failed';
      `;
    } finally {
      await sql.end();
    }
  });

  test.afterAll(async () => {
    const seed = await readSeedState();
    const sql = pgModule(seed.databaseUrl, { max: 1, onnotice: () => {} });
    try {
      await sql`
        DELETE FROM public.ai_transcriptions
        WHERE id IN (
          ${DEEP_LINK_TRANSCRIPTIONS.reviewed.id},
          ${DEEP_LINK_TRANSCRIPTIONS.failed.id}
        )
          AND user_id = ${seed.userId};
      `;
    } finally {
      await sql.end();
    }
  });

  // 4.1 — from the dashboard, click the AI-notes "Ver" link and assert the
  // server-resolved Pendentes tab is active on load (no client flip).
  test('dashboard AI-notes link opens transcricoes with the Pendentes tab active', async ({
    page,
  }) => {
    await page.goto('/dashboard');

    // The seed user always has >=2 `ready` (unsaved) transcriptions, so the
    // AI-notes pendência row is rendered and links to the deep-linked URL.
    const verLink = page.getByTestId('dashboard-pendencias-link-ai-review');
    await expect(verLink).toBeVisible();
    await expect(verLink).toHaveAttribute('href', '/dashboard/transcricoes?status=ready');

    await verLink.click();

    // URL preserves the deep-link param.
    await page.waitForURL('**/dashboard/transcricoes?status=ready', { timeout: 15_000 });
    const url = new URL(page.url());
    expect(url.pathname).toBe('/dashboard/transcricoes');
    expect(url.searchParams.get('status')).toBe('ready');

    // The tabs (multiple buckets seeded) render and Pendentes is the active tab
    // on the FIRST render — Radix sets `data-state="active"` on the selected
    // trigger and matching panel. We assert immediately after navigation
    // (no interaction) so a client flip to a different default would fail here.
    await expect(page.getByTestId('transcriptions-tabs')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('tab-pending')).toHaveAttribute('data-state', 'active');
    await expect(page.getByTestId('panel-pending')).toHaveAttribute('data-state', 'active');

    // The sibling tabs are present (proving multiple buckets) but NOT active.
    await expect(page.getByTestId('tab-reviewed')).toHaveAttribute('data-state', 'inactive');
    await expect(page.getByTestId('tab-failed')).toHaveAttribute('data-state', 'inactive');
  });

  // 4.3 — unknown status value degrades to the default Pendentes tab.
  test('unknown status value (?status=xyz) renders the default Pendentes tab', async ({ page }) => {
    await page.goto('/dashboard/transcricoes?status=xyz');

    // No error / blank screen: the page title and the tabs both render.
    await expect(page.getByTestId('transcricoes-page-title')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('transcriptions-tabs')).toBeVisible();

    // The closed allowlist collapses the unknown value to the default tab.
    await expect(page.getByTestId('tab-pending')).toHaveAttribute('data-state', 'active');
    await expect(page.getByTestId('panel-pending')).toHaveAttribute('data-state', 'active');
  });
});

// ---------------------------------------------------------------------------
// 4.2 — anonymous deep-link is gated by the middleware.
// ---------------------------------------------------------------------------
//
// This block intentionally carries NO storageState — the request hits the Edge
// middleware as a fully anonymous user.
test.describe('@ai-transcription deep-link — anonymous access is blocked', () => {
  test('anonymous /dashboard/transcricoes?status=ready redirects to /login', async ({ page }) => {
    const response = await page.goto('/dashboard/transcricoes?status=ready');

    // Playwright follows redirects; the final response is the login page.
    expect(response?.status()).toBe(200);

    const url = new URL(page.url());
    expect(url.pathname).toBe('/login');
    // The redirect target preserves the path (param preservation is desirable
    // but not required, so we only assert the path prefix is preserved).
    expect(url.searchParams.get('redirectTo')).toContain('/dashboard/transcricoes');

    // The login form must be rendered — never the review surface.
    await expect(page.getByTestId('login-form-email')).toBeVisible();
    await expect(page.getByTestId('transcriptions-tabs')).toHaveCount(0);
  });
});
