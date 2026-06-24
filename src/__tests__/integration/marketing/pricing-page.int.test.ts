import { NextRequest } from 'next/server';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isKnownPlanSlug, PLANS, PRICING_PAGE } from '@/modules/marketing';
import type * as RegistrationEdgeModule from '@/modules/registration/edge';

/*
 * Integration coverage (5.2) for the public pricing page (`/precos`) assembly.
 *
 * `/precos` is a static, PUBLIC Server Component that composes four
 * presentational sections — header (title + subtitle), plan cards, the
 * comparison table, and the billing FAQ — plus the closing CTA band. The
 * interactive bits (plan-card UTM CTA, comparison-table disclosure, FAQ
 * `<details>`) are isolated client leaves that render to stable, crawlable
 * static markup; the page itself has NO Supabase access and NO DB query, so we
 * render it synchronously with `renderToStaticMarkup` (the integration env is
 * `node`), mirroring `homepage.int.test.ts`. No Postgres/Testcontainers needed.
 *
 * Six contracts are asserted:
 *
 *   1. PUBLIC route — an ANONYMOUS request to `/precos` passes the middleware
 *      with HTTP 200 and NO login redirect (the negative-auth gate).
 *   2. The four sections render in spec order (header → plan cards → comparison
 *      table → billing FAQ → final CTA), identified by stable landmark ids.
 *   3. Heading hierarchy — exactly one `<h1>` (the page title); every section
 *      below starts at `<h2>`.
 *   4. Prices + plan names come from the central `PLANS` config (not hardcoded),
 *      and the billing-FAQ questions render.
 *   5. Every `/signup?plano=<slug>` CTA target uses a KNOWN, allowlisted slug
 *      from the central config (no free-form / open-parameter sink).
 *   6. The page exports unique, non-empty SEO metadata (title / description /
 *      canonical `/precos` / Open Graph).
 */

// -- Section 1: anonymous middleware gate (no DB) -----------------------------

const { getUserMock, getCurrentProfileEdgeMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  getCurrentProfileEdgeMock: vi.fn(),
}));

const signOutMock = vi.hoisted(() => vi.fn().mockResolvedValue({ error: null }));

vi.mock('@/shared/supabase/middleware', async () => {
  const { NextResponse } = await import('next/server');
  return {
    createMiddlewareClient: vi.fn((request: NextRequest) => {
      const response = NextResponse.next({ request });
      return {
        supabase: { auth: { getUser: getUserMock, signOut: signOutMock } },
        response,
      };
    }),
  };
});

vi.mock('@/modules/registration/edge', async (importOriginal) => {
  const actual = await importOriginal<typeof RegistrationEdgeModule>();
  return { ...actual, getCurrentProfileEdge: getCurrentProfileEdgeMock };
});

beforeEach(() => {
  getUserMock.mockReset();
  getCurrentProfileEdgeMock.mockReset();
  signOutMock.mockReset();
  signOutMock.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.resetModules();
});

// -- Helpers ------------------------------------------------------------------

/** Renders the pricing page Server Component to static HTML (no DB, no PII). */
async function renderPricingPage(): Promise<string> {
  const { default: PricingPage } = await import('@/app/(public)/precos/page');
  return renderToStaticMarkup(createElement(PricingPage));
}

/** pt-BR BRL formatter matching the plan-card display layer (integer reais). */
const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 0,
});

/**
 * The pricing-page sections in spec order, each keyed by the stable identifier
 * its `<section>` landmark carries (`aria-labelledby` id or `aria-label`).
 */
const SECTION_MARKERS = [
  { name: 'Header', marker: 'aria-labelledby="pricing-title"' },
  { name: 'Planos (cards)', marker: 'aria-label="Planos"' },
  { name: 'Comparação', marker: 'aria-labelledby="comparison-title"' },
  { name: 'FAQ de cobrança', marker: 'aria-labelledby="billing-faq-title"' },
  { name: 'CTA final', marker: 'aria-labelledby="cta-final-title"' },
] as const;

// -- Tests --------------------------------------------------------------------

describe('pricing page is public (anonymous gets HTTP 200, no login redirect)', () => {
  it('passes an anonymous request through the middleware with no redirect', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });
    getCurrentProfileEdgeMock.mockResolvedValue(null);

    const { middleware } = await import('@/middleware');
    const response = await middleware(new NextRequest('http://localhost/precos'));

    expect(response.headers.get('location')).toBeNull();
    expect(response.status).toBeLessThan(300);
  });
});

describe('pricing page renders the sections in spec order', () => {
  it('renders all sections', async () => {
    const html = await renderPricingPage();
    for (const { name, marker } of SECTION_MARKERS) {
      expect(html.includes(marker), `missing section: ${name}`).toBe(true);
    }
  });

  it('renders them in the exact spec order', async () => {
    const html = await renderPricingPage();
    const positions = SECTION_MARKERS.map(({ name, marker }) => {
      const at = html.indexOf(marker);
      expect(at, `section "${name}" not found`).toBeGreaterThanOrEqual(0);
      return at;
    });
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
  });
});

describe('pricing page heading hierarchy', () => {
  it('exposes exactly one <h1>', async () => {
    const html = await renderPricingPage();
    const h1Count = (html.match(/<h1[\s>]/g) ?? []).length;
    expect(h1Count).toBe(1);
  });

  it('renders the page title as the single <h1>', async () => {
    const html = await renderPricingPage();
    const h1At = html.indexOf('<h1');
    const h2At = html.indexOf('<h2');
    expect(h1At).toBeGreaterThanOrEqual(0);
    expect(h2At).toBeGreaterThan(h1At);
    expect(html).toContain(PRICING_PAGE.title);
  });
});

describe('pricing page sources content from the central configs', () => {
  it('shows each plan name and its price from the PLANS config', async () => {
    const html = await renderPricingPage();
    for (const plan of PLANS) {
      expect(html, `plan name "${plan.name}" missing`).toContain(plan.name);
      expect(html, `plan price for "${plan.name}" missing`).toContain(
        BRL.format(plan.priceCents / 100),
      );
    }
  });

  it('renders the config-driven "Popular" badge on the badged plan', async () => {
    const html = await renderPricingPage();
    const badged = PLANS.find((p) => p.badge);
    expect(badged?.badge).toBeTruthy();
    expect(html).toContain(badged?.badge ?? '__never__');
  });

  it('renders the page subtitle and the plan CTA label from the content layer', async () => {
    const html = await renderPricingPage();
    expect(html).toContain(PRICING_PAGE.subtitle);
    expect(html).toContain(PRICING_PAGE.ctaLabel);
  });

  it('renders the billing FAQ questions', async () => {
    const html = await renderPricingPage();
    const { BILLING_FAQ_ENTRIES } = await import('@/modules/marketing');
    expect(BILLING_FAQ_ENTRIES.length).toBeGreaterThanOrEqual(3);
    for (const { question } of BILLING_FAQ_ENTRIES) {
      // `question` is ResponsiveCopy; the billing FAQ has no mobile override so
      // the desktop string is what renders in the SSR markup.
      expect(html, `billing FAQ question missing: ${question.desktop}`).toContain(question.desktop);
    }
  });
});

describe('pricing page CTA links use only allowlisted plan slugs', () => {
  it('every /signup?plano=<slug> link targets a known config slug', async () => {
    const html = await renderPricingPage();
    const matches = [...html.matchAll(/\/signup\?plano=([a-z0-9-]+)/g)];
    // The plan cards each emit one such CTA, so there is at least one per plan.
    expect(matches.length).toBeGreaterThanOrEqual(PLANS.length);
    for (const match of matches) {
      const slug = match[1] ?? '';
      expect(isKnownPlanSlug(slug), `unknown plan slug in CTA: ${slug}`).toBe(true);
    }
  });
});

describe('pricing page SEO metadata', () => {
  it('exports a unique, non-empty title suffixed with the site name', async () => {
    const { metadata } = await import('@/app/(public)/precos/page');
    expect(typeof metadata.title).toBe('string');
    expect(metadata.title).toContain('| Hubrity');
    expect((metadata.title as string).length).toBeGreaterThan('| Hubrity'.length);
  });

  it('exports a non-empty description', async () => {
    const { metadata } = await import('@/app/(public)/precos/page');
    expect(typeof metadata.description).toBe('string');
    expect((metadata.description ?? '').length).toBeGreaterThan(0);
  });

  it('exports the canonical URL for /precos', async () => {
    const { metadata } = await import('@/app/(public)/precos/page');
    const canonical = metadata.alternates?.canonical;
    const canonicalStr =
      typeof canonical === 'string' ? canonical : ((canonical as { url?: string })?.url ?? '');
    expect(canonicalStr).toMatch(/\/precos$/);
  });

  it('exports Open Graph title / description / url / image', async () => {
    const { metadata } = await import('@/app/(public)/precos/page');
    const og = metadata.openGraph;
    expect(og).toBeTruthy();
    expect((og as { title?: string }).title).toContain('| Hubrity');
    expect(typeof (og as { description?: string }).description).toBe('string');
    expect((og as { url?: string }).url).toBeTruthy();
    expect((og as { images?: unknown[] }).images?.length ?? 0).toBeGreaterThan(0);
  });
});
