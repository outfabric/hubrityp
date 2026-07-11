import { expect, test } from '@playwright/test';

import { STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * Subtask 6.5 — the "Templates" tab is hidden on the Lembretes settings
 * section while the connection UI flag is off (the shared-number reminders
 * MVP config). The seeded build inlines the three `NEXT_PUBLIC_WHATSAPP_*` UI
 * flags at their defaults (all OFF), so `NEXT_PUBLIC_WHATSAPP_CONNECTION_UI_ENABLED`
 * is off here — matching the MVP configuration under test.
 *
 * Gating is visual-only: the underlying `/configuracoes/lembretes/templates`
 * route stays reachable by direct URL (auth gating is the middleware's job,
 * not the UI flag's).
 */
test.describe('@whatsapp Lembretes tabs — Templates tab hidden under the MVP flag config', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test('shows only "Configuração" and "Histórico" — no Templates tab element', async ({ page }) => {
    await page.goto('/configuracoes/lembretes');

    // The reminders configuration screen renders and the tab bar is present.
    await expect(page.getByTestId('reminder-settings-page-title')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId('lembretes-tabs')).toBeVisible();

    // The two remaining tabs are visible.
    await expect(page.getByTestId('lembretes-tab-configuracao')).toBeVisible();
    await expect(page.getByTestId('lembretes-tab-historico')).toBeVisible();

    // The Templates tab is fully hidden — not a disabled "Em breve" entry.
    await expect(page.getByTestId('lembretes-tab-templates')).toHaveCount(0);
    await expect(page.getByTestId('lembretes-tabs').getByText('Templates')).toHaveCount(0);
  });

  test('direct URL /configuracoes/lembretes/templates still responds (visual-only gating)', async ({
    page,
  }) => {
    await page.goto('/configuracoes/lembretes/templates');

    // The route responds and renders the templates screen despite the hidden tab.
    await expect(page.getByTestId('templates-page-title')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('templates-page-title')).toHaveText('Templates de Mensagem');
  });
});
