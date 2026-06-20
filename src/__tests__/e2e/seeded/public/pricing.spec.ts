import { expect, test, type Locator, type Page } from '@playwright/test';

// Public pricing page (`/precos`) critical-flow E2E (anonymous).
// --------------------------------------------------------------------------
// These specs pin the `/precos` user-facing contract. Every flow here is
// anonymous: `/precos` is classified `public` by the middleware, so no
// storageState / session is involved and no auth gating is exercised.
//
// Covered (RF-14.26 / RF-14.27 / RF-14.28):
//   1. Plan cards — exactly two cards render with R$ 60 (Essencial) and R$ 90
//      (Avançado), the "Mais popular" badge is on Avançado only, and the
//      Avançado CTA "Experimentar grátis — 14 dias" navigates to
//      /signup?plano=avancado.
//   2. Comparison table — expanding it reveals the two Avançado-exclusive rows
//      (WhatsApp reminders + AI notes), each ✓ for Avançado and — for
//      Essencial; the billing FAQ opens exclusively (one item at a time).
//   3. Cross-page link — the homepage "Ver planos completos →" link navigates
//      to /precos (link integrity across the two public pages).
//
// The plan CTA computes its UTM-bearing href client-side after hydration (the
// `PlanCta` leaf reads `window.location.search` on the next animation frame),
// so navigation assertions wait for the soft navigation to land rather than
// inspecting the static SSR href. The comparison table and billing FAQ are
// JS-enhanced (collapse-to-preview and exclusive-open are applied only after
// hydration), so those flows poll for the hydrated state before interacting.

/** The two prices the MVP plans render, tolerating the BRL non-breaking space. */
const ESSENCIAL_PRICE = /R\$\s*60/;
const AVANCADO_PRICE = /R\$\s*90/;

/** Verbatim RF-14.27 labels for the two Avançado-exclusive comparison rows. */
const WHATSAPP_ROW_LABEL = 'Lembretes automáticos via WhatsApp';
const IA_ROW_LABEL = 'Transcrição e nota com IA';

/** The plan-cards section landmark (scopes assertions away from the table/FAQ). */
function planCards(page: Page): Locator {
  return page.getByRole('region', { name: 'Planos' });
}

/** The expandable comparison-table section landmark. */
function comparisonSection(page: Page): Locator {
  return page.locator('section[aria-labelledby="comparison-title"]');
}

/** The billing-FAQ section landmark. */
function billingFaqSection(page: Page): Locator {
  return page.locator('section[aria-labelledby="billing-faq-title"]');
}

test.describe('public pricing — plan cards', () => {
  test('loads /precos with two plan cards (R$ 60 / R$ 90), "Mais popular" on Avançado, and the Avançado CTA goes to /signup?plano=avancado', async ({
    page,
  }) => {
    const response = await page.goto('/precos');

    // Public page: 200 and the URL stays on /precos (no redirect to /login).
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe('/precos');

    // The single <h1> page title renders (proves the page, not an error shell).
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Investimento no seu consultório, não na burocracia.',
      }),
    ).toBeVisible();

    // Exactly two plan cards, each a heading-bearing list item.
    const cards = planCards(page).locator('> ul > li');
    await expect(cards).toHaveCount(2);

    // Card 1 — Essencial: R$ 60, NO "Mais popular" badge.
    const essencial = cards.filter({
      has: page.getByRole('heading', { level: 3, name: 'Essencial' }),
    });
    await expect(essencial).toHaveCount(1);
    await expect(essencial).toContainText(ESSENCIAL_PRICE);
    await expect(essencial.getByText('Mais popular')).toHaveCount(0);

    // Card 2 — Avançado: R$ 90, carries the "Mais popular" badge.
    const avancado = cards.filter({
      has: page.getByRole('heading', { level: 3, name: 'Avançado' }),
    });
    await expect(avancado).toHaveCount(1);
    await expect(avancado).toContainText(AVANCADO_PRICE);
    await expect(avancado.getByText('Mais popular')).toBeVisible();

    // The Avançado CTA folds the (empty) UTM set into the href after hydration;
    // poll until it resolves to the stable /signup?plano=avancado target, then
    // click and assert the navigation lands there.
    const cta = avancado.getByRole('link', { name: 'Experimentar grátis — 14 dias' });
    await expect.poll(async () => cta.getAttribute('href')).toMatch(/^\/signup\?plano=avancado/);

    await cta.click();
    await page.waitForURL('**/signup?**');
    const url = new URL(page.url());
    expect(url.pathname).toBe('/signup');
    expect(url.searchParams.get('plano')).toBe('avancado');
  });
});

test.describe('public pricing — comparison table + billing FAQ', () => {
  test('expanding the comparison table reveals the WhatsApp + IA rows (✓ only for Avançado)', async ({
    page,
  }) => {
    await page.goto('/precos');

    const section = comparisonSection(page);
    await expect(
      section.getByRole('heading', { level: 2, name: 'Compare os planos' }),
    ).toBeVisible();

    // The disclosure toggle is rendered only after hydration (no-JS shows the
    // full table). Wait for it, which proves the collapse enhancement ran.
    const toggle = section.getByRole('button', { name: 'Ver todos os recursos' });
    await expect(toggle).toBeVisible();

    // Scope to the desktop <table> (the mobile stacked blocks carry the same
    // data; we assert on the table to avoid duplicate matches).
    const table = section.locator('table');

    // While collapsed the two Avançado-exclusive rows live below the 6-row
    // preview, so their label cells are not visible yet.
    const whatsappRow = table.locator('tr', { hasText: WHATSAPP_ROW_LABEL });
    const iaRow = table.locator('tr', { hasText: IA_ROW_LABEL });
    await expect(whatsappRow).toBeHidden();
    await expect(iaRow).toBeHidden();

    // Expand: the toggle reveals the full matrix.
    await toggle.click();
    await expect(section.getByRole('button', { name: 'Ver menos' })).toBeVisible();
    await expect(whatsappRow).toBeVisible();
    await expect(iaRow).toBeVisible();

    // The plan columns are in config order: Essencial (col 2), Avançado (col 3).
    // For each Avançado-exclusive row, the Essencial cell announces "não
    // incluído" and the Avançado cell announces "incluído" — the screen-reader
    // labels that pair the ✓/— marks (the marks themselves are aria-hidden).
    for (const row of [whatsappRow, iaRow]) {
      const cells = row.locator('td');
      await expect(cells).toHaveCount(2);
      await expect(cells.nth(0)).toContainText('não incluído'); // Essencial: —
      await expect(cells.nth(1)).toContainText('incluído'); // Avançado: ✓
    }
  });

  test('the billing FAQ opens exclusively — opening one item closes the previously open one', async ({
    page,
  }) => {
    await page.goto('/precos');

    const section = billingFaqSection(page);
    await expect(
      section.getByRole('heading', { level: 2, name: 'Dúvidas sobre cobrança' }),
    ).toBeVisible();

    const items = section.locator('details');
    const count = await items.count();
    expect(count).toBeGreaterThan(1);

    // After hydration the accordion collapses to a single open item (the first).
    // Exactly one open item proves the JS enhancement ran (no-JS = all open).
    await expect.poll(async () => section.locator('details[open]').count()).toBe(1);

    const first = items.nth(0);
    const second = items.nth(1);
    await expect(first).toHaveAttribute('open', '');

    // Open the second item: exclusivity closes the first and leaves only the
    // second open.
    await second.locator('summary').click();
    await expect(second).toHaveAttribute('open', '');
    await expect(first).not.toHaveAttribute('open', '');
    await expect(section.locator('details[open]')).toHaveCount(1);
  });
});

test.describe('public pricing — cross-page link integrity', () => {
  test('the homepage "Ver planos completos →" link navigates to /precos', async ({ page }) => {
    await page.goto('/');

    // The pricing-summary section owns the full-plans link; scope to it so the
    // header/footer never satisfy the assertion.
    const summary = page.locator('section[aria-labelledby="precos-resumo-title"]');
    const fullPlansLink = summary.getByRole('link', { name: 'Ver planos completos →' });
    await fullPlansLink.scrollIntoViewIfNeeded();
    await expect(fullPlansLink).toHaveAttribute('href', '/precos');

    await fullPlansLink.click();
    await page.waitForURL('**/precos');
    expect(new URL(page.url()).pathname).toBe('/precos');

    // The destination rendered the pricing page (its single <h1>), not a 404.
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Investimento no seu consultório, não na burocracia.',
      }),
    ).toBeVisible();
  });
});
