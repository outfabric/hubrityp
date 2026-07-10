import { expect, test } from '@playwright/test';

import { STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * Subtask 6.4 — WhatsApp UI freeze: frozen navigation entry points are
 * non-navigable (click and keyboard do nothing), while the reminder settings
 * route stays reachable.
 *
 * The seeded build inlines the three `NEXT_PUBLIC_WHATSAPP_*` UI flags at their
 * defaults (all OFF), so every WhatsApp entry point is frozen here — matching
 * the freeze mechanism under test. The reminders SCREEN is reached by direct
 * URL: the flags are UI-only and never gate the route itself (auth gating is
 * the middleware's job, asserted in the 6.5 integration suite), which is the
 * "a tela de lembretes permanece acessível" guarantee.
 *
 * The reminders-ON card-navigability matrix (each surface flag toggled
 * independently) is covered exhaustively at the unit level in
 * `configuracoes/page-whatsapp-freeze.test.tsx`.
 */
test.describe('WhatsApp UI freeze — frozen entry points are non-navigable', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test('sidebar "Caixa de entrada" is frozen and clicking it does not navigate', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('dashboard-greeting')).toBeVisible({ timeout: 10_000 });

    // The sidebar is rendered twice (a hidden mobile overlay + the visible
    // desktop rail); scope to the desktop nav (last in DOM order, `md:flex`).
    const nav = page.getByRole('navigation', { name: 'Menu principal' }).last();

    // The frozen inbox entry renders as a non-navigable <span aria-disabled>,
    // NOT a link. It carries the "Em breve" badge and no unread counter.
    await expect(nav.getByRole('link', { name: /caixa de entrada/i })).toHaveCount(0);

    const frozenEntry = nav.locator('span[aria-disabled="true"]', {
      hasText: 'Caixa de entrada',
    });
    await expect(frozenEntry).toBeVisible();
    await expect(frozenEntry).toContainText('Em breve');

    // Clicking the frozen entry does nothing — we stay on the dashboard.
    await frozenEntry.click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('settings "WhatsApp" card is frozen and non-navigable (click + keyboard)', async ({
    page,
  }) => {
    await page.goto('/configuracoes');
    await expect(page.getByTestId('settings-index-page')).toBeVisible({ timeout: 10_000 });

    const card = page.getByTestId('settings-area-card-whatsapp');
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('aria-disabled', 'true');
    await expect(card).toContainText('Em breve');

    // No surrounding <Link> — the frozen card is not in the tab order and has
    // no navigation target.
    await expect(page.locator('a:has([data-testid="settings-area-card-whatsapp"])')).toHaveCount(0);

    // Clicking it does not navigate away from the index.
    await card.click();
    await expect(page).toHaveURL(/\/configuracoes$/);

    // Keyboard activation is impossible: there is no focusable link to Enter on.
    // A navigable card (Agenda) proves the index itself is interactive.
    const agendaLink = page.locator('a:has([data-testid="settings-area-card-agenda"])');
    await agendaLink.focus();
    await page.keyboard.press('Enter');
    await page.waitForURL('**/configuracoes/agenda', { timeout: 10_000 });
    expect(new URL(page.url()).pathname).toBe('/configuracoes/agenda');
  });

  test('integrations "WhatsApp" card is frozen and clicking it does not navigate', async ({
    page,
  }) => {
    await page.goto('/configuracoes/integracoes');
    await expect(page.getByTestId('integrations-index-page-title')).toBeVisible({
      timeout: 10_000,
    });

    const card = page.getByTestId('integration-card-whatsapp');
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('aria-disabled', 'true');
    await expect(card).toContainText('Em breve');
    await expect(page.locator('a:has([data-testid="integration-card-whatsapp"])')).toHaveCount(0);

    await card.click();
    await expect(page).toHaveURL(/\/configuracoes\/integracoes$/);
  });

  test('reminder settings screen stays accessible by direct URL despite the frozen entry points', async ({
    page,
  }) => {
    await page.goto('/configuracoes/lembretes');

    // The route responds normally — the reminders configuration screen renders.
    await expect(page.getByTestId('reminder-settings-page-title')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId('reminder-settings-page-title')).toHaveText(
      'Configurações de Lembretes',
    );
  });
});
