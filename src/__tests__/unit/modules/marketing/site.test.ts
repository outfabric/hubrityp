import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `clientEnv` parses `process.env` once at module-evaluation time, so each test
// stubs `NEXT_PUBLIC_SITE_URL`, resets the module registry, and re-imports the
// helper to pick up the stubbed value. The other required public vars are kept
// valid so `clientEnvSchema` does not reject the whole env.
async function loadSite(siteUrl: string) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'unit-test-anon-key');
  vi.stubEnv('NEXT_PUBLIC_STREAM_API_KEY', 'unit-test-stream-public-key');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', siteUrl);
  return import('@/modules/marketing/lib/site');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('siteUrl', () => {
  it('returns the configured base URL', async () => {
    const { siteUrl } = await loadSite('https://hubrity.com');
    expect(siteUrl()).toBe('https://hubrity.com');
  });

  it('strips a trailing slash from the configured base', async () => {
    const { siteUrl } = await loadSite('https://hubrity.com/');
    expect(siteUrl()).toBe('https://hubrity.com');
  });

  it('strips multiple trailing slashes', async () => {
    const { siteUrl } = await loadSite('https://hubrity.com///');
    expect(siteUrl()).toBe('https://hubrity.com');
  });

  it('preserves a non-root path in the base', async () => {
    const { siteUrl } = await loadSite('https://hubrity.com/app/');
    expect(siteUrl()).toBe('https://hubrity.com/app');
  });
});

describe('absoluteUrl', () => {
  let base: string;
  let absoluteUrl: (path?: string) => string;

  beforeEach(async () => {
    base = 'https://hubrity.com';
    ({ absoluteUrl } = await loadSite(base));
  });

  it('joins a leading-slash path onto the base', () => {
    expect(absoluteUrl('/precos')).toBe('https://hubrity.com/precos');
  });

  it('joins a path without a leading slash onto the base', () => {
    expect(absoluteUrl('precos')).toBe('https://hubrity.com/precos');
  });

  it('collapses repeated leading slashes on the path to a single separator', () => {
    expect(absoluteUrl('///precos')).toBe('https://hubrity.com/precos');
  });

  it('preserves a nested path', () => {
    expect(absoluteUrl('/blog/post-1')).toBe('https://hubrity.com/blog/post-1');
  });

  it('returns the bare base when no path is provided', () => {
    expect(absoluteUrl()).toBe('https://hubrity.com');
  });

  it('returns the bare base for an empty path', () => {
    expect(absoluteUrl('')).toBe('https://hubrity.com');
  });

  it('returns base + slash for the root path', () => {
    expect(absoluteUrl('/')).toBe('https://hubrity.com/');
  });

  it('does not double the slash when the base has a trailing slash', async () => {
    const { absoluteUrl: fn } = await loadSite('https://hubrity.com/');
    expect(fn('/precos')).toBe('https://hubrity.com/precos');
  });

  it('keeps query strings on the path intact', () => {
    expect(absoluteUrl('/precos?plan=pro')).toBe('https://hubrity.com/precos?plan=pro');
  });
});
