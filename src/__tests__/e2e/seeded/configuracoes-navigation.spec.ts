import { expect, test } from '@playwright/test';

import { STORAGE_STATE_PATH } from './setup/seed-state';

/**
 * @configuracoes -- Navigation shell E2E tests.
 *
 * Validates the settings index page, breadcrumb navigation, tab navigation,
 * keyboard accessibility, and responsive behavior of the configuracoes
 * navigation shell introduced by this change.
 */
test.describe('@configuracoes navigation shell', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  // -------------------------------------------------------------------------
  // 9.1 — Sidebar navigation to settings index
  // -------------------------------------------------------------------------
  test('sidebar Configuracoes navega para o indice', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('dashboard-greeting')).toBeVisible({ timeout: 10_000 });

    // Click the sidebar link "Configurações"
    const sidebarLink = page.getByRole('link', { name: 'Configurações' });
    await sidebarLink.click();

    // Assert URL is /configuracoes (NOT /configuracoes/locais)
    await page.waitForURL('**/configuracoes', { timeout: 10_000 });
    const url = new URL(page.url());
    expect(url.pathname).toBe('/configuracoes');

    // Assert 4 cards visible with correct testids and labels
    const expectedCards = [
      { testid: 'settings-area-card-locais', label: 'Locais de atendimento' },
      { testid: 'settings-area-card-whatsapp', label: 'WhatsApp' },
      { testid: 'settings-area-card-lembretes', label: 'Lembretes' },
      { testid: 'settings-area-card-agenda', label: 'Agenda' },
    ];

    for (const card of expectedCards) {
      const el = page.getByTestId(card.testid);
      await expect(el).toBeVisible({ timeout: 10_000 });
      await expect(el).toContainText(card.label);
    }
  });

  // -------------------------------------------------------------------------
  // 9.2 — Card navigation to each settings area
  // -------------------------------------------------------------------------
  test('navegacao por card para cada area de configuracoes', async ({ page }) => {
    // Only Locais and Agenda are navigable. WhatsApp and Lembretes are frozen
    // behind NEXT_PUBLIC_WHATSAPP_UI_ENABLED (default OFF) — rendered as
    // non-navigable "Em breve" cards, asserted in a dedicated test below.
    const areas = [
      {
        slug: 'locais',
        href: '/configuracoes/locais',
        titleTestid: 'locations-page-title',
      },
      {
        slug: 'agenda',
        href: '/configuracoes/agenda',
        titleTestid: 'agenda-settings-page-title',
      },
    ];

    for (const area of areas) {
      await page.goto('/configuracoes');
      await expect(page.getByTestId('settings-index-page')).toBeVisible({ timeout: 10_000 });

      const card = page.getByTestId(`settings-area-card-${area.slug}`);
      await expect(card).toBeVisible();
      await card.click();

      // Assert URL changed
      await page.waitForURL(`**${area.href}`, { timeout: 10_000 });
      const currentUrl = new URL(page.url());
      expect(currentUrl.pathname).toBe(area.href);

      // Assert the target page h1 is visible
      await expect(page.getByTestId(area.titleTestid)).toBeVisible({ timeout: 10_000 });
    }
  });

  // -------------------------------------------------------------------------
  // 9.2b — Frozen cards (WhatsApp, Lembretes) are non-navigable "Em breve"
  // -------------------------------------------------------------------------
  test('cards WhatsApp e Lembretes congelados nao sao navegaveis (Em breve)', async ({ page }) => {
    await page.goto('/configuracoes');
    await expect(page.getByTestId('settings-index-page')).toBeVisible({ timeout: 10_000 });

    for (const slug of ['whatsapp', 'lembretes']) {
      const card = page.getByTestId(`settings-area-card-${slug}`);
      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute('aria-disabled', 'true');
      await expect(card).toContainText('Em breve');

      // No surrounding <Link>, so there is no navigation target.
      await expect(page.locator(`a:has([data-testid="settings-area-card-${slug}"])`)).toHaveCount(
        0,
      );
    }

    // Clicking a frozen card does not navigate away from the index.
    await page.getByTestId('settings-area-card-whatsapp').click();
    await expect(page).toHaveURL(/\/configuracoes$/);
  });

  // -------------------------------------------------------------------------
  // 9.3 — Integrations index page and WhatsApp card
  // -------------------------------------------------------------------------
  test('indice de integracoes renderiza card WhatsApp congelado e breadcrumb funciona', async ({
    page,
  }) => {
    await page.goto('/configuracoes/integracoes');

    // Assert h1 "Integrações" visible
    await expect(page.getByTestId('integrations-index-page-title')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId('integrations-index-page-title')).toHaveText('Integrações');

    // The WhatsApp card is rendered but frozen behind
    // NEXT_PUBLIC_WHATSAPP_UI_ENABLED (default OFF): a non-navigable
    // `aria-disabled` "Em breve" card, NOT wrapped in a link.
    const whatsappCard = page.getByTestId('integration-card-whatsapp');
    await expect(whatsappCard).toBeVisible();
    await expect(whatsappCard).toHaveAttribute('aria-disabled', 'true');
    await expect(whatsappCard).toContainText('Em breve');
    await expect(page.locator('a:has([data-testid="integration-card-whatsapp"])')).toHaveCount(0);

    // Assert breadcrumb shows "Configurações > Integrações"
    const breadcrumb = page.getByTestId('settings-breadcrumb');
    await expect(breadcrumb).toBeVisible();

    // "Configurações" should be a link (not current page)
    const configLink = breadcrumb.getByRole('link', { name: 'Configurações' });
    await expect(configLink).toBeVisible();

    // "Integrações" is the current page (not linked)
    const integracoesSegment = breadcrumb.locator('span[aria-current="page"]');
    await expect(integracoesSegment).toHaveText('Integrações');

    // Clicking the frozen card does not navigate away from the index.
    await whatsappCard.click();
    await expect(page).toHaveURL(/\/configuracoes\/integracoes$/);
  });

  // -------------------------------------------------------------------------
  // 9.4 — Breadcrumb "Integrações" link from WhatsApp page
  // -------------------------------------------------------------------------
  test('breadcrumb Integracoes link da pagina WhatsApp navega para indice de integracoes sem 404', async ({
    page,
  }) => {
    await page.goto('/configuracoes/integracoes/whatsapp');
    await expect(page.getByTestId('whatsapp-integration-page-title')).toBeVisible({
      timeout: 10_000,
    });

    // Click "Integrações" breadcrumb segment
    const breadcrumb = page.getByTestId('settings-breadcrumb');
    const integracoesLink = breadcrumb.getByRole('link', { name: 'Integrações' });
    await expect(integracoesLink).toBeVisible();
    await integracoesLink.click();

    // Assert URL is /configuracoes/integracoes
    await page.waitForURL('**/configuracoes/integracoes', { timeout: 10_000 });
    expect(new URL(page.url()).pathname).toBe('/configuracoes/integracoes');

    // Assert h1 "Integrações" visible (NOT 404)
    await expect(page.getByTestId('integrations-index-page-title')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId('integrations-index-page-title')).toHaveText('Integrações');
  });

  // -------------------------------------------------------------------------
  // 9.5 — Breadcrumb shows correct trail and links work
  // -------------------------------------------------------------------------
  test('breadcrumb mostra trilha correta e links funcionam', async ({ page }) => {
    // Navigate to /configuracoes/lembretes/templates
    await page.goto('/configuracoes/lembretes/templates');

    const breadcrumb = page.getByTestId('settings-breadcrumb');
    await expect(breadcrumb).toBeVisible({ timeout: 10_000 });

    // Assert breadcrumb shows "Configurações > Lembretes > Templates"
    await expect(breadcrumb.getByRole('link', { name: 'Configurações' })).toBeVisible();
    await expect(breadcrumb.getByRole('link', { name: 'Lembretes' })).toBeVisible();
    await expect(breadcrumb.locator('span[aria-current="page"]')).toHaveText('Templates');

    // Click "Configurações" → assert URL /configuracoes
    await breadcrumb.getByRole('link', { name: 'Configurações' }).click();
    await page.waitForURL('**/configuracoes', { timeout: 10_000 });
    expect(new URL(page.url()).pathname).toBe('/configuracoes');

    // Navigate to /configuracoes/integracoes/whatsapp
    await page.goto('/configuracoes/integracoes/whatsapp');

    const breadcrumb2 = page.getByTestId('settings-breadcrumb');
    await expect(breadcrumb2).toBeVisible({ timeout: 10_000 });

    // Assert breadcrumb shows "Configurações > Integrações > WhatsApp"
    await expect(breadcrumb2.getByRole('link', { name: 'Configurações' })).toBeVisible();
    await expect(breadcrumb2.getByRole('link', { name: 'Integrações' })).toBeVisible();
    await expect(breadcrumb2.locator('span[aria-current="page"]')).toHaveText('WhatsApp');
  });

  // -------------------------------------------------------------------------
  // 9.6 — Breadcrumb at root shows only "Configurações" as current page
  // -------------------------------------------------------------------------
  test('breadcrumb no indice mostra apenas root', async ({ page }) => {
    await page.goto('/configuracoes');

    const breadcrumb = page.getByTestId('settings-breadcrumb');
    await expect(breadcrumb).toBeVisible({ timeout: 10_000 });

    // "Configurações" is the current page (non-linked, with aria-current="page")
    const currentSegment = breadcrumb.locator('span[aria-current="page"]');
    await expect(currentSegment).toHaveText('Configurações');

    // No links inside the breadcrumb (only the current page span)
    const links = breadcrumb.getByRole('link');
    await expect(links).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // 9.7 — Lembretes tabs toggle between sub-sections
  // -------------------------------------------------------------------------
  test('tabs do Lembretes alternam entre sub-secoes', async ({ page }) => {
    await page.goto('/configuracoes/lembretes');

    // Assert "Configuração" tab is active
    const configTab = page.getByTestId('lembretes-tab-configuracao');
    await expect(configTab).toBeVisible({ timeout: 10_000 });
    await expect(configTab).toHaveAttribute('aria-current', 'page');
    // Active tab styling: text-text-primary + border-b-2 border-brand-500
    await expect(configTab).toHaveClass(/text-text-primary/);
    await expect(configTab).toHaveClass(/border-b-2/);
    await expect(configTab).toHaveClass(/border-brand-500/);

    // The "Templates" tab is hidden during the shared-number reminders MVP
    // (NEXT_PUBLIC_WHATSAPP_CONNECTION_UI_ENABLED off), so only "Configuração"
    // and "Histórico" toggle. Click "Histórico".
    const historicoTab = page.getByTestId('lembretes-tab-historico');
    await historicoTab.click();

    // Assert URL changed to historico
    await page.waitForURL('**/configuracoes/lembretes/historico', { timeout: 10_000 });
    expect(new URL(page.url()).pathname).toBe('/configuracoes/lembretes/historico');

    // Assert "Histórico" is now active
    await expect(historicoTab).toHaveAttribute('aria-current', 'page');

    // The Templates tab must not be rendered while the flag is off.
    await expect(page.getByTestId('lembretes-tab-templates')).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // 9.8 — Deep-link and back/forward for Lembretes tabs
  // -------------------------------------------------------------------------
  test('deep-link e back/forward das tabs do Lembretes', async ({ page }) => {
    // Navigate directly to /configuracoes/lembretes/historico
    await page.goto('/configuracoes/lembretes/historico');

    // Assert "Histórico" tab is active and content visible
    const historicoTab = page.getByTestId('lembretes-tab-historico');
    await expect(historicoTab).toBeVisible({ timeout: 10_000 });
    await expect(historicoTab).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('historico-page-title')).toBeVisible();

    // The "Templates" tab is hidden during the MVP, so back/forward is
    // exercised across "Configuração" (the other visible tab).
    const configTab = page.getByTestId('lembretes-tab-configuracao');
    await configTab.click();
    await page.waitForURL('**/configuracoes/lembretes', { timeout: 10_000 });
    expect(new URL(page.url()).pathname).toBe('/configuracoes/lembretes');
    await expect(configTab).toHaveAttribute('aria-current', 'page');

    // Browser back → should go back to Histórico
    await page.goBack();
    await page.waitForURL('**/configuracoes/lembretes/historico', { timeout: 10_000 });
    await expect(page.getByTestId('lembretes-tab-historico')).toHaveAttribute(
      'aria-current',
      'page',
    );

    // Browser forward → should go forward to Configuração
    await page.goForward();
    await page.waitForURL('**/configuracoes/lembretes', { timeout: 10_000 });
    expect(new URL(page.url()).pathname).toBe('/configuracoes/lembretes');
    await expect(page.getByTestId('lembretes-tab-configuracao')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  // -------------------------------------------------------------------------
  // 9.9 — No duplicate breadcrumb on template edit page
  // -------------------------------------------------------------------------
  test('pagina de edicao de template nao tem breadcrumb duplicado', async ({ page }) => {
    // Navigate to a template edit URL
    await page.goto('/configuracoes/lembretes/templates/lembrete_24h');

    // Whether the template exists or we redirect, wait for the page to settle
    await page.waitForURL('**/configuracoes/lembretes/templates**', { timeout: 10_000 });

    // Assert exactly 1 breadcrumb element exists
    const breadcrumbs = page.getByTestId('settings-breadcrumb');
    await expect(breadcrumbs).toHaveCount(1);

    // If we landed on the edit page (template exists), assert h1 shows label.
    // If we landed on the listing (template not found), h1 shows "Templates de Mensagem".
    // Either way, there should be exactly one h1.
    const heading = page.locator('h1').first();
    await expect(heading).toBeVisible({ timeout: 10_000 });
  });

  // -------------------------------------------------------------------------
  // 9.11 — Mobile viewport: cards in single column with correct tap targets
  // -------------------------------------------------------------------------
  test('viewport mobile mostra cards em coluna unica e tap targets corretos', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 667 },
      storageState: STORAGE_STATE_PATH,
    });
    const page = await context.newPage();

    try {
      await page.goto('/configuracoes');
      await expect(page.getByTestId('settings-index-page')).toBeVisible({ timeout: 10_000 });

      const cardSlugs = ['locais', 'whatsapp', 'lembretes', 'agenda'];

      for (const slug of cardSlugs) {
        const card = page.getByTestId(`settings-area-card-${slug}`);
        await expect(card).toBeVisible();

        const box = await card.boundingBox();
        expect(box).not.toBeNull();

        // Card height should be at least 44px (tap target)
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }

      // Assert cards are stacked in a single column: each card's width should
      // be approximately equal to the container width (minus padding).
      // All cards should have the same x position and similar widths.
      const boxes = [];
      for (const slug of cardSlugs) {
        const card = page.getByTestId(`settings-area-card-${slug}`);
        const box = await card.boundingBox();
        boxes.push(box!);
      }

      // All cards share the same x coordinate (stacked in column)
      const firstX = boxes[0]!.x;
      for (const box of boxes) {
        expect(box.x).toBeCloseTo(firstX, 0);
      }

      // All cards have approximately the same width
      const firstWidth = boxes[0]!.width;
      for (const box of boxes) {
        expect(Math.abs(box.width - firstWidth)).toBeLessThan(2);
      }
    } finally {
      await context.close();
    }
  });

  // -------------------------------------------------------------------------
  // 9.12 — Mobile: tab bar scrolls horizontally
  // -------------------------------------------------------------------------
  test('tab bar do Lembretes scrolla horizontalmente em mobile', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 667 },
      storageState: STORAGE_STATE_PATH,
    });
    const page = await context.newPage();

    try {
      await page.goto('/configuracoes/lembretes');

      const tabBar = page.getByTestId('lembretes-tabs');
      await expect(tabBar).toBeVisible({ timeout: 10_000 });

      // Assert overflow-x-auto is active (the element has the class)
      const hasOverflowClass = await tabBar.evaluate((el) => {
        return el.classList.contains('overflow-x-auto');
      });
      expect(hasOverflowClass).toBe(true);

      // Assert each visible tab has min-height >= 44px. The "Templates" tab is
      // hidden during the shared-number reminders MVP.
      const tabSlugs = ['configuracao', 'historico'];
      for (const slug of tabSlugs) {
        const tab = page.getByTestId(`lembretes-tab-${slug}`);
        await expect(tab).toBeVisible();

        const box = await tab.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
    } finally {
      await context.close();
    }
  });

  // -------------------------------------------------------------------------
  // 9.13 — Keyboard navigation on index cards
  // -------------------------------------------------------------------------
  test('navegacao por teclado nos cards do indice', async ({ page }) => {
    await page.goto('/configuracoes');
    await expect(page.getByTestId('settings-index-page')).toBeVisible({ timeout: 10_000 });

    // With NEXT_PUBLIC_WHATSAPP_UI_ENABLED OFF (default), only Locais and
    // Agenda are navigable links. WhatsApp and Lembretes are frozen
    // ("Em breve") and intentionally NOT focusable — they are not links.
    const navigableSlugs = ['locais', 'agenda'];

    for (let i = 0; i < navigableSlugs.length; i++) {
      const slug = navigableSlugs[i]!;
      const cardLink = page.locator(`a:has([data-testid="settings-area-card-${slug}"])`);

      // Focus each card link directly. Sequential Tab is unreliable because
      // the frozen cards interleave with the navigable ones in the DOM.
      await cardLink.focus();
      await expect(cardLink).toBeFocused({ timeout: 5_000 });

      // Assert visible focus indicator (CSS box-shadow or outline).
      // Tailwind focus-visible:shadow-focus applies a box-shadow on
      // :focus-visible; programmatic `.focus()` triggers it in Chromium.
      const hasFocusIndicator = await cardLink.evaluate((el) => {
        const styles = window.getComputedStyle(el);
        const hasShadow = styles.boxShadow !== 'none' && styles.boxShadow !== '';
        const hasOutline = styles.outlineStyle !== 'none' && styles.outlineWidth !== '0px';
        return hasShadow || hasOutline;
      });
      expect(hasFocusIndicator).toBe(true);
    }

    // The frozen cards expose no link in the tab order.
    await expect(page.locator('a:has([data-testid="settings-area-card-whatsapp"])')).toHaveCount(0);
    await expect(page.locator('a:has([data-testid="settings-area-card-lembretes"])')).toHaveCount(
      0,
    );

    // Pressing Enter on a focused navigable card navigates.
    const agendaLink = page.locator('a:has([data-testid="settings-area-card-agenda"])');
    await agendaLink.focus();
    await page.keyboard.press('Enter');

    await page.waitForURL('**/configuracoes/agenda', { timeout: 10_000 });
    expect(new URL(page.url()).pathname).toBe('/configuracoes/agenda');
  });

  // -------------------------------------------------------------------------
  // 9.14 — Keyboard navigation on Lembretes tabs
  // -------------------------------------------------------------------------
  test('navegacao por teclado nas tabs do Lembretes', async ({ page }) => {
    await page.goto('/configuracoes/lembretes');

    const tabBar = page.getByTestId('lembretes-tabs');
    await expect(tabBar).toBeVisible({ timeout: 10_000 });

    // Focus the first tab directly (there are sidebar links and breadcrumb
    // links before the tabs in the DOM, so Tab from page start would not
    // reach them in a predictable number of presses).
    const firstTab = page.getByTestId('lembretes-tab-configuracao');
    await firstTab.focus();

    // The "Templates" tab is hidden during the shared-number reminders MVP,
    // so only "Configuração" and "Histórico" are in the tab order.
    const tabSlugs = ['configuracao', 'historico'];

    for (let i = 0; i < tabSlugs.length; i++) {
      const slug = tabSlugs[i]!;
      const tab = page.getByTestId(`lembretes-tab-${slug}`);

      if (i > 0) {
        await page.keyboard.press('Tab');
      }

      // Wait for the tab to be focused
      await expect(tab).toBeFocused({ timeout: 5_000 });

      // Assert visible focus ring (CSS box-shadow or outline)
      const hasFocusRing = await tab.evaluate((el) => {
        const styles = window.getComputedStyle(el);
        const hasShadow = styles.boxShadow !== 'none' && styles.boxShadow !== '';
        const hasOutline = styles.outlineStyle !== 'none' && styles.outlineWidth !== '0px';
        return hasShadow || hasOutline;
      });
      expect(hasFocusRing).toBe(true);
    }

    // Focus is on "historico" (last). Shift-Tab once → "configuracao".
    await page.keyboard.press('Shift+Tab');

    // Press Enter on "Configuração"
    await page.keyboard.press('Enter');

    await page.waitForURL('**/configuracoes/lembretes', { timeout: 10_000 });
    expect(new URL(page.url()).pathname).toBe('/configuracoes/lembretes');
  });
});
