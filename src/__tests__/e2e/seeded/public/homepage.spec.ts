import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

// Public homepage (`/`) critical-flow E2E (anonymous).
// --------------------------------------------------------------------------
// These specs pin the marketing landing page's user-facing contract. Every
// flow here is anonymous: `/` is classified `public` by the middleware, so no
// storageState / session is involved and no auth gating is exercised.
//
// Covered:
//   1. Navigation — hero renders; the hero primary CTA goes to `/signup`; the
//      secondary CTA scrolls to `#funcionalidades`; the header "Entrar" → `/login`.
//   2. Carousel + lightbox — arrows and dots change the active slide WITHOUT
//      auto-advancing; a feature-card thumbnail opens the lightbox dialog and
//      Escape closes it.
//   3. FAQ + reduced-motion — the accordion is exclusive (opening one item
//      closes the previously open one); under `prefers-reduced-motion: reduce`
//      the scroll-reveal content stays fully visible (never stuck at opacity 0).
//   4. UTM preservation — `utm_*` params on `/?...` survive the hero CTA hop to
//      `/signup`.
//
// The hero CTA computes its UTM-bearing href client-side after hydration (the
// `SignupCta` leaf reads `window.location.search` on the next animation frame),
// so the navigation assertions wait for the soft navigation to land rather than
// inspecting the static SSR href.

/** The page banner landmark — scopes header assertions away from the footer. */
function header(page: Page): Locator {
  return page.getByRole('banner');
}

/** The hero section landmark — scopes hero assertions away from the (visually
 *  similar) header/footer CTAs that also point at `/signup`. */
function hero(page: Page): Locator {
  return page.locator('section[aria-labelledby="hero-headline"]');
}

/** The hero's UTM-preserving primary CTA ("Começar grátis — 14 dias"). */
function heroPrimaryCta(page: Page): Locator {
  return hero(page).getByRole('link', { name: 'Começar grátis — 14 dias' });
}

/**
 * Pre-seed the LGPD consent decision so the fixed-bottom cookie banner never
 * mounts. While present it legitimately intercepts pointer events over the page
 * footer (the intended consent UX), which would race clicks on bottom-of-page
 * content. Seeding `cookie_consent=accepted` up front makes the returning-visitor
 * path deterministic; the dedicated consent test in `public-shell.spec.ts` still
 * exercises the banner's own first-visit + accept behavior.
 */
async function seedCookieConsent(context: BrowserContext): Promise<void> {
  await context.addCookies([
    {
      name: 'cookie_consent',
      value: 'accepted',
      url: 'http://localhost:3000',
      sameSite: 'Lax',
    },
  ]);
}

test.describe('public homepage — navigation flows', () => {
  test('hero renders, and the primary/secondary CTAs and header "Entrar" navigate correctly', async ({
    page,
  }) => {
    const response = await page.goto('/');

    // Public page: 200 and the URL stays on `/` (no redirect to /login).
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe('/');

    // Hero renders: the badge and the single <h1> headline are visible. At the
    // desktop viewport the condensed mobile headline variant is `display:none`,
    // so the accessible name is the desktop string only.
    await expect(hero(page).getByText('Feito para psicólogos autônomos')).toBeVisible();
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'De 10 ferramentas espalhadas a um só sistema clínico.',
      }),
    ).toBeVisible();

    // "Ver funcionalidades" scrolls to (and reveals) the #funcionalidades
    // section. The section heading must come into view after the in-page jump.
    await hero(page).getByRole('link', { name: 'Ver funcionalidades' }).click();
    await expect(page).toHaveURL(/#funcionalidades$/);
    const featuresHeading = page.getByRole('heading', {
      name: 'Tudo o que você precisa, em um só sistema',
    });
    await expect(featuresHeading).toBeInViewport();

    // "Começar grátis — 14 dias" navigates to /signup.
    await page.goto('/');
    await heroPrimaryCta(page).click();
    await page.waitForURL('**/signup');
    expect(new URL(page.url()).pathname).toBe('/signup');

    // Header "Entrar" → /login.
    await page.goto('/');
    await header(page).getByRole('link', { name: 'Entrar' }).click();
    await page.waitForURL('**/login');
    expect(new URL(page.url()).pathname).toBe('/login');
  });
});

test.describe('public homepage — carousel + lightbox', () => {
  test('carousel arrows and dots change the active slide without auto-advancing', async ({
    page,
  }) => {
    await page.goto('/');

    const carousel = page.getByRole('region', { name: 'Telas do sistema Hubrity' });
    await expect(carousel).toBeVisible();

    // The current slide is the only one with data-active="true"; its caption is
    // shown in the aria-live paragraph. We assert via the caption text, which is
    // distinct per slide.
    const caption = carousel.locator('p[aria-live="polite"]');
    const initialCaption = (await caption.innerText()).trim();
    expect(initialCaption.length).toBeGreaterThan(0);

    // The interactive controls (arrows + dots) are revealed only after hydration.
    const nextArrow = carousel.getByRole('button', { name: 'Próximo slide' });
    const prevArrow = carousel.getByRole('button', { name: 'Slide anterior' });
    await expect(nextArrow).toBeVisible();

    // Next arrow advances: the caption changes to the second slide's caption.
    await nextArrow.click();
    await expect(caption).not.toHaveText(initialCaption);
    const secondCaption = (await caption.innerText()).trim();

    // Prev arrow goes back to the first slide's caption.
    await prevArrow.click();
    await expect(caption).toHaveText(initialCaption);

    // Dots jump directly to a slide: clicking the 2nd dot returns to the 2nd
    // slide's caption (proving the dots drive the same state as the arrows).
    const dots = carousel.getByRole('tab');
    await dots.nth(1).click();
    await expect(caption).toHaveText(secondCaption);
    await expect(dots.nth(1)).toHaveAttribute('aria-selected', 'true');

    // No auto-advance: jump back to the first slide, wait, and assert the
    // caption has NOT changed on its own (there is no timer in the component).
    await dots.nth(0).click();
    await expect(caption).toHaveText(initialCaption);
    await page.waitForTimeout(2500);
    await expect(caption).toHaveText(initialCaption);
    await expect(dots.nth(0)).toHaveAttribute('aria-selected', 'true');
  });

  test('a feature-card thumbnail opens the lightbox and Escape closes it', async ({ page }) => {
    await page.goto('/');

    // Open the first feature-card thumbnail. The trigger is a button with an
    // "Ampliar captura de tela: ..." accessible label.
    const thumbnail = page.getByRole('button', { name: /^Ampliar captura de tela: / }).first();
    await thumbnail.scrollIntoViewIfNeeded();
    await thumbnail.click();

    // The lightbox dialog is shown.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Escape closes it (and focus returns to the page — the dialog unmounts).
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
});

test.describe('public homepage — FAQ + reduced motion', () => {
  test('FAQ accordion is exclusive: opening one item closes the previously open one', async ({
    page,
  }) => {
    await page.goto('/');

    // After hydration the FAQ collapses to a single open item (the first). The
    // accordion is built on native <details>; the open one carries the `open`
    // attribute. Scope queries to the FAQ section.
    const faqSection = page.locator('section[aria-labelledby="faq-title"]');
    const items = faqSection.locator('details');
    const count = await items.count();
    expect(count).toBeGreaterThan(1);

    // Wait for the client enhancement to collapse all but the first item
    // (no-JS / pre-hydration state is "all open"). Exactly one open item proves
    // hydration ran.
    await expect.poll(async () => faqSection.locator('details[open]').count()).toBe(1);

    const first = items.nth(0);
    const second = items.nth(1);
    await expect(first).toHaveAttribute('open', '');

    // Open the second item by clicking its summary. Exclusivity: the first item
    // closes and only the second remains open.
    await second.locator('summary').click();
    await expect(second).toHaveAttribute('open', '');
    await expect(first).not.toHaveAttribute('open', '');
    await expect(faqSection.locator('details[open]')).toHaveCount(1);
  });

  test('with prefers-reduced-motion the scroll-reveal content stays fully visible', async ({
    page,
  }) => {
    // Emulate the reduced-motion preference BEFORE navigating so the timeline's
    // mount-time matchMedia check sees it and skips the IntersectionObserver
    // fade-in entirely (the default state is full opacity).
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    const timelineSection = page.locator('section[aria-labelledby="solucao-title"]');
    const items = timelineSection.locator('[data-fade-item]');
    const count = await items.count();
    expect(count).toBeGreaterThan(0);

    // Under reduced motion the fade-in never activates: `data-fade-visible` is
    // absent and every item resolves to opacity 1 (visible content), never the
    // 0-opacity hidden enhancement state.
    for (let i = 0; i < count; i++) {
      const item = items.nth(i);
      await expect(item).not.toHaveAttribute('data-fade-visible', 'false');
      await expect(item).toBeVisible();
      const opacity = await item.evaluate((el) => getComputedStyle(el).opacity);
      expect(Number(opacity)).toBeGreaterThan(0.99);
    }
  });
});

test.describe('public homepage — UTM preservation', () => {
  test('UTM params on `/?...` are preserved on the hero "Começar grátis" navigation to /signup', async ({
    page,
    context,
  }) => {
    // The footer cookie banner can overlay bottom-of-page content; the hero CTA
    // is above the fold, but seed consent anyway for a fully deterministic page.
    await seedCookieConsent(context);

    await page.goto('/?utm_source=test&utm_medium=email&utm_campaign=launch');

    // The hero CTA computes its href from window.location.search after hydration
    // (next animation frame). Poll the resolved href until the UTM params are
    // folded in, then click and assert the navigation carries them.
    const cta = heroPrimaryCta(page);
    await expect.poll(async () => cta.getAttribute('href')).toMatch(/^\/signup\?.*utm_source=test/);

    await cta.click();
    await page.waitForURL('**/signup?**');

    const url = new URL(page.url());
    expect(url.pathname).toBe('/signup');
    expect(url.searchParams.get('utm_source')).toBe('test');
    expect(url.searchParams.get('utm_medium')).toBe('email');
    expect(url.searchParams.get('utm_campaign')).toBe('launch');
  });
});
