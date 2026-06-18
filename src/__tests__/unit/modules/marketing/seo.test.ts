import type { Metadata } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Unit coverage (10.5) for `buildPageMetadata()`.
 *
 * The helper composes a Next.js `Metadata` object whose canonical and OG/Twitter
 * URLs MUST be ABSOLUTE, derived from `NEXT_PUBLIC_SITE_URL`. Because the URL
 * base flows through `clientEnv` (parsed once at module-eval), each load stubs
 * the public env and re-imports the module — mirroring `site.test.ts`.
 */

const SITE_URL = 'https://hubrity.com';

async function loadSeo() {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'unit-test-anon-key');
  vi.stubEnv('NEXT_PUBLIC_STREAM_API_KEY', 'unit-test-stream-public-key');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', SITE_URL);
  return import('@/modules/marketing/lib/seo');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('buildPageMetadata', () => {
  let build: (input: {
    title: string;
    description: string;
    path: string;
    ogImage?: string;
  }) => Metadata;

  beforeEach(async () => {
    ({ buildPageMetadata: build } = await loadSeo());
  });

  it('suffixes the title with the site name', () => {
    const meta = build({ title: 'Preços', description: 'Planos da Hubrity.', path: '/precos' });
    expect(meta.title).toBe('Preços | Hubrity');
  });

  it('passes the description through unchanged', () => {
    const meta = build({ title: 'Preços', description: 'Planos da Hubrity.', path: '/precos' });
    expect(meta.description).toBe('Planos da Hubrity.');
  });

  it('produces an absolute canonical URL from the site base', () => {
    const meta = build({ title: 'Preços', description: 'd', path: '/precos' });
    expect(meta.alternates?.canonical).toBe('https://hubrity.com/precos');
  });

  it('sets og:url to the same absolute canonical', () => {
    const meta = build({ title: 'Preços', description: 'd', path: '/precos' });
    expect(meta.openGraph?.url).toBe('https://hubrity.com/precos');
  });

  it('marks the OG type as website with pt_BR locale and the site name', () => {
    const meta = build({ title: 'Preços', description: 'd', path: '/precos' });
    // `openGraph.type` is a discriminated union in Next types — narrow via a cast
    // for the assertion only.
    expect((meta.openGraph as { type?: string }).type).toBe('website');
    expect((meta.openGraph as { locale?: string }).locale).toBe('pt_BR');
    expect(meta.openGraph?.siteName).toBe('Hubrity');
  });

  it('resolves the default OG image to an absolute URL', () => {
    const meta = build({ title: 'Preços', description: 'd', path: '/precos' });
    const images = (meta.openGraph as { images: Array<{ url: string }> }).images;
    expect(images[0]?.url).toBe('https://hubrity.com/og-default.png');
  });

  it('mirrors the OG image into the Twitter large-summary card', () => {
    const meta = build({ title: 'Preços', description: 'd', path: '/precos' });
    expect((meta.twitter as { card?: string }).card).toBe('summary_large_image');
    expect((meta.twitter as { images?: string[] }).images?.[0]).toBe(
      'https://hubrity.com/og-default.png',
    );
  });

  it('resolves a page-specific OG image override to an absolute URL', () => {
    const meta = build({
      title: 'Preços',
      description: 'd',
      path: '/precos',
      ogImage: '/og-precos.png',
    });
    const images = (meta.openGraph as { images: Array<{ url: string }> }).images;
    expect(images[0]?.url).toBe('https://hubrity.com/og-precos.png');
  });

  it('produces distinct titles and canonicals for distinct pages', () => {
    const home = build({ title: 'Início', description: 'a', path: '/' });
    const precos = build({ title: 'Preços', description: 'b', path: '/precos' });

    expect(home.title).not.toBe(precos.title);
    expect(home.alternates?.canonical).not.toBe(precos.alternates?.canonical);
    expect(home.alternates?.canonical).toBe('https://hubrity.com/');
    expect(precos.alternates?.canonical).toBe('https://hubrity.com/precos');
  });
});
