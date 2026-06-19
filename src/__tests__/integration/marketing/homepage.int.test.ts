import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PLANS, TRUST } from '@/modules/marketing';

/*
 * Integration coverage (11.2) for the public homepage (`/`) assembly.
 *
 * The homepage is a static Server Component that composes ten presentational
 * marketing sections (the interactive bits — signup CTA, hero carousel, FAQ
 * disclosures — are isolated client leaves that render to stable, crawlable
 * static markup). It has NO Supabase access and NO DB query, so we render it
 * synchronously with `renderToStaticMarkup` (the integration env is `node`),
 * mirroring `legal-pages.int.test.ts`. No Postgres/Testcontainers is required.
 *
 * Four contracts are asserted:
 *
 *   1. The ten sections render in the spec order (hero → prova social →
 *      problema → solução → funcionalidades → destaque IA → confiança → preços
 *      → FAQ → CTA final), identified by their stable section landmark ids.
 *   2. Heading hierarchy — exactly one `<h1>` on the page (it lives in the hero;
 *      every other section starts at `<h2>`).
 *   3. The pricing teaser shows the REAL plan names + prices from the central
 *      `PLANS` config (not hardcoded copy), and the regulatory codes from the
 *      `TRUST` config are present verbatim.
 *   4. The page exports unique, non-empty SEO metadata (title / description /
 *      canonical / Open Graph).
 */

async function renderHomepage(): Promise<string> {
  const { default: HomePage } = await import('@/app/(public)/page');
  return renderToStaticMarkup(createElement(HomePage));
}

/**
 * The ten homepage sections in spec order, each keyed by the stable identifier
 * its `<section>` landmark carries (`aria-labelledby` id or `aria-label`).
 */
const SECTION_MARKERS = [
  { name: 'Hero', marker: 'aria-labelledby="hero-headline"' },
  { name: 'Prova social', marker: 'aria-label="Dados de mercado"' },
  { name: 'Problema', marker: 'aria-labelledby="problema-title"' },
  { name: 'Solução', marker: 'aria-labelledby="solucao-title"' },
  { name: 'Funcionalidades', marker: 'aria-labelledby="funcionalidades-title"' },
  { name: 'Destaque IA', marker: 'aria-labelledby="destaque-ia-title"' },
  { name: 'Confiança', marker: 'aria-labelledby="confianca-title"' },
  { name: 'Preços', marker: 'aria-labelledby="precos-resumo-title"' },
  { name: 'FAQ', marker: 'aria-labelledby="faq-title"' },
  { name: 'CTA final', marker: 'aria-labelledby="cta-final-title"' },
] as const;

/** pt-BR BRL formatter matching the teaser's display layer (integer reais). */
const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 0,
});

describe('homepage renders the ten marketing sections in spec order', () => {
  it('renders all ten sections', async () => {
    const html = await renderHomepage();
    for (const { name, marker } of SECTION_MARKERS) {
      expect(html.includes(marker), `missing section: ${name}`).toBe(true);
    }
  });

  it('renders them in the exact spec order', async () => {
    const html = await renderHomepage();
    const positions = SECTION_MARKERS.map(({ name, marker }) => {
      const at = html.indexOf(marker);
      expect(at, `section "${name}" not found`).toBeGreaterThanOrEqual(0);
      return at;
    });

    // They appear strictly in declared order.
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
  });
});

describe('homepage heading hierarchy', () => {
  it('exposes exactly one <h1>', async () => {
    const html = await renderHomepage();
    const h1Count = (html.match(/<h1[\s>]/g) ?? []).length;
    expect(h1Count).toBe(1);
  });

  it('starts every other section at <h2> (no stray <h1> outside the hero)', async () => {
    const html = await renderHomepage();
    // The single <h1> must precede the first <h2> (hero is first).
    const h1At = html.indexOf('<h1');
    const h2At = html.indexOf('<h2');
    expect(h1At).toBeGreaterThanOrEqual(0);
    expect(h2At).toBeGreaterThan(h1At);
  });
});

describe('homepage sources content from the central configs', () => {
  it('shows each plan name and its price from the PLANS config', async () => {
    const html = await renderHomepage();
    for (const plan of PLANS) {
      expect(html, `plan name "${plan.name}" missing`).toContain(plan.name);
      expect(html, `plan price for "${plan.name}" missing`).toContain(
        BRL.format(plan.priceCents / 100),
      );
    }
  });

  it('renders the "Mais popular" badge driven by the Avançado plan config', async () => {
    const html = await renderHomepage();
    const badged = PLANS.find((p) => p.badge);
    expect(badged?.badge).toBe('Mais popular');
    expect(html).toContain('Mais popular');
  });

  it('renders all eight regulatory guarantee codes verbatim', async () => {
    const html = await renderHomepage();
    expect(TRUST.guarantees).toHaveLength(8);
    for (const { text } of TRUST.guarantees) {
      expect(html, `regulatory guarantee missing: ${text}`).toContain(text);
    }
  });

  it.each([
    'Resolução CFP nº 001/2009',
    'Resolução CFP nº 06/2019',
    'Resolução CFP nº 09/2024',
    'Res. CFP nº 13/2022',
    'São Paulo (LGPD)',
    'AES-256 em repouso, TLS 1.3 em trânsito',
    'Lei 13.787/2018',
    'CRP ativo',
  ])('contains the regulatory literal "%s"', async (literal) => {
    const html = await renderHomepage();
    expect(html).toContain(literal);
  });
});

describe('homepage SEO metadata', () => {
  it('exports a unique, non-empty title suffixed with the site name', async () => {
    const { metadata } = await import('@/app/(public)/page');
    expect(typeof metadata.title).toBe('string');
    expect(metadata.title).toContain('| Hubrity');
    expect((metadata.title as string).length).toBeGreaterThan('| Hubrity'.length);
  });

  it('exports a non-empty description', async () => {
    const { metadata } = await import('@/app/(public)/page');
    expect(typeof metadata.description).toBe('string');
    expect((metadata.description ?? '').length).toBeGreaterThan(0);
  });

  it('exports the canonical URL for the homepage root', async () => {
    const { metadata } = await import('@/app/(public)/page');
    const canonical = metadata.alternates?.canonical;
    expect(typeof canonical).toBe('string');
    const canonicalStr =
      typeof canonical === 'string' ? canonical : ((canonical as { url?: string })?.url ?? '');
    expect(canonicalStr).toMatch(/\/$/);
  });

  it('exports Open Graph title / description / url / image', async () => {
    const { metadata } = await import('@/app/(public)/page');
    const og = metadata.openGraph;
    expect(og).toBeTruthy();
    expect((og as { title?: string }).title).toContain('| Hubrity');
    expect(typeof (og as { description?: string }).description).toBe('string');
    expect((og as { url?: string }).url).toBeTruthy();
    expect((og as { images?: unknown[] }).images?.length ?? 0).toBeGreaterThan(0);
  });
});
