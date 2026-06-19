import type { MetadataRoute } from 'next';
import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * Integration coverage (10.6) for the public SEO infrastructure: the
 * `app/sitemap.ts` and `app/robots.ts` metadata routes and the analytics-host
 * CSP gate in `next.config.ts`.
 *
 * Three contracts are asserted:
 *
 *   1. `/sitemap.xml` lists ONLY public, indexable routes (homepage, preços,
 *      legal pages) with absolute URLs, and NONE of the authenticated prefixes.
 *   2. `/robots.txt` disallows every authenticated prefix, allows `/`, and
 *      carries an absolute `Sitemap:` line.
 *   3. The CSP includes the analytics host (with NO wildcard) ONLY when
 *      `NEXT_PUBLIC_ANALYTICS_HOST` is configured; the baseline CSP is unchanged
 *      when it is unset.
 *
 * These modules read `clientEnv` / `process.env` once at module-eval, so each
 * loader stubs the public env and re-imports — mirroring the marketing unit
 * suites. No Postgres is needed: the boundary under test is the static metadata
 * output and the config string, not a DB query.
 */

const SITE_URL = 'https://hubrity.com';
const ANALYTICS_HOST = 'https://analytics.hubrity.com';

// Authenticated / private prefixes that MUST be disallowed in robots and MUST
// never appear in the sitemap.
const AUTHENTICATED_PREFIXES = [
  '/dashboard',
  '/agenda',
  '/pacientes',
  '/caixa-de-entrada',
  '/configuracoes',
  '/onboarding',
  '/sessao',
  '/api',
] as const;

function stubPublicEnv(analyticsHost?: string): void {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'integration-anon-key');
  vi.stubEnv('NEXT_PUBLIC_STREAM_API_KEY', 'integration-stream-key');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', SITE_URL);
  // `undefined` deletes the var so the optional schema sees it as unset.
  vi.stubEnv('NEXT_PUBLIC_ANALYTICS_HOST', analyticsHost);
}

async function loadSitemap(): Promise<MetadataRoute.Sitemap> {
  vi.resetModules();
  stubPublicEnv();
  const mod = await import('@/app/sitemap');
  return mod.default();
}

async function loadRobots(): Promise<MetadataRoute.Robots> {
  vi.resetModules();
  stubPublicEnv();
  const mod = await import('@/app/robots');
  return mod.default();
}

/** Loads next.config and extracts the global Content-Security-Policy value. */
async function loadCsp(analyticsHost?: string): Promise<string> {
  vi.resetModules();
  stubPublicEnv(analyticsHost);
  const mod = await import('../../../../next.config');
  const config = mod.default;
  const headerGroups = await config.headers!();
  const globalGroup = headerGroups.find((g) => g.source === '/:path*');
  const csp = globalGroup?.headers.find((h) => h.key === 'Content-Security-Policy');
  return csp?.value ?? '';
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('sitemap.xml lists public indexable routes only', () => {
  it('lists the homepage, preços, and both legal pages with absolute URLs', async () => {
    const entries = await loadSitemap();
    const urls = entries.map((e) => e.url);

    expect(urls).toEqual(
      expect.arrayContaining([
        'https://hubrity.com/',
        'https://hubrity.com/precos',
        'https://hubrity.com/politica-de-privacidade',
        'https://hubrity.com/termos-de-uso',
      ]),
    );
  });

  it('emits only absolute URLs on the configured host', async () => {
    const entries = await loadSitemap();
    for (const entry of entries) {
      expect(entry.url.startsWith('https://hubrity.com')).toBe(true);
    }
  });

  it('does not list any authenticated / private route', async () => {
    const entries = await loadSitemap();
    const urls = entries.map((e) => e.url);

    for (const prefix of AUTHENTICATED_PREFIXES) {
      const leaked = urls.some((u) => new URL(u).pathname.startsWith(prefix));
      expect(leaked, `sitemap must not list ${prefix}`).toBe(false);
    }
  });
});

describe('robots.txt disallows authenticated prefixes and points at the sitemap', () => {
  it('allows the public root', async () => {
    const robots = await loadRobots();
    const rules = Array.isArray(robots.rules) ? robots.rules[0] : robots.rules;
    expect(rules?.allow).toBe('/');
  });

  it.each(AUTHENTICATED_PREFIXES)('disallows %s', async (prefix) => {
    const robots = await loadRobots();
    const rules = Array.isArray(robots.rules) ? robots.rules[0] : robots.rules;
    const disallow = rules?.disallow;
    const list = Array.isArray(disallow) ? disallow : disallow ? [disallow] : [];
    expect(list).toContain(prefix);
  });

  it('carries an absolute Sitemap: line on the configured host', async () => {
    const robots = await loadRobots();
    expect(robots.sitemap).toBe('https://hubrity.com/sitemap.xml');
  });
});

describe('CSP gates the analytics host on configuration', () => {
  it('omits the analytics host from script-src/connect-src when unset (baseline unchanged)', async () => {
    const csp = await loadCsp(undefined);

    expect(csp).not.toContain('analytics.hubrity.com');
    // Baseline directives remain intact.
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self'");
  });

  it('adds the analytics origin to script-src and connect-src when configured', async () => {
    const csp = await loadCsp(ANALYTICS_HOST);

    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
    const connectSrc = csp.split(';').find((d) => d.trim().startsWith('connect-src')) ?? '';

    expect(scriptSrc).toContain(ANALYTICS_HOST);
    expect(connectSrc).toContain(ANALYTICS_HOST);
  });

  it('allowlists the exact origin with no wildcard', async () => {
    const csp = await loadCsp(ANALYTICS_HOST);

    // No wildcard host for analytics — only the exact configured origin.
    expect(csp).not.toContain('*.hubrity.com');
    expect(csp).toContain(ANALYTICS_HOST);
  });
});
