// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Section 8.5 — integration coverage for the consent-gated analytics loader.
 *
 * This proves the LGPD "no analytics before consent" contract end-to-end at the
 * render boundary (the layer the browser actually executes):
 *
 *   1. Before consent (no cookie) → NO <script> tag is rendered and NO network
 *      request is issued for the analytics host.
 *   2. With consent `accepted` AND a configured host → the deferred provider
 *      script is rendered, with its `src` pointing at the ALLOWLISTED host from
 *      `NEXT_PUBLIC_ANALYTICS_HOST` (never an arbitrary origin).
 *   3. With a host configured but consent absent/rejected → still NO script.
 *
 * Runs under jsdom (overriding the suite's node default) because the loader
 * gates on a `useEffect`-read of `document.cookie`, which only fires in a DOM.
 * `clientEnv` is parsed once at module-eval, so each case stubs the analytics
 * host, resets the module registry, and dynamically imports the component.
 *
 * No Postgres/Testcontainers is needed: the boundary under test is the client
 * render decision (consent + host), not a DB query.
 */

const ANALYTICS_HOST = 'https://analytics.hubrity.com';

// `next/script` is mocked to a plain <script> so the rendered tag (and its
// `src`) is observable in jsdom exactly as the loader configured it.
vi.mock('next/script', () => ({
  __esModule: true,
  default: ({ src, ...rest }: { src: string }) =>
    createElement('script', { defer: true, src, ...rest }),
}));

function clearConsentCookie(): void {
  document.cookie = 'cookie_consent=; Path=/; Max-Age=0';
}

/**
 * Loads the loader with a stubbed analytics host (or none). Mirrors the unit
 * suite's env-reset pattern so each case observes the env it set.
 */
async function loadAnalyticsLoader(host: string | undefined) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'integration-anon-key');
  vi.stubEnv('NEXT_PUBLIC_STREAM_API_KEY', 'integration-stream-key');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://127.0.0.1:3000');
  // `undefined` deletes the var so the optional schema sees it as unset (an
  // empty string would fail `.url()`).
  vi.stubEnv('NEXT_PUBLIC_ANALYTICS_HOST', host);
  vi.stubEnv('NEXT_PUBLIC_ANALYTICS_SITE_ID', host ? 'hubrity.com' : undefined);
  const mod = await import('@/modules/marketing/components/analytics-loader');
  return mod.AnalyticsLoader;
}

beforeEach(() => {
  clearConsentCookie();
  // Spy on fetch so we can assert NO network request reaches the analytics host
  // before consent. (The mocked <script> never fetches, but a regression that
  // swapped to a fetch-based loader would be caught here.)
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
  );
});

afterEach(() => {
  cleanup();
  clearConsentCookie();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('analytics consent gate — before consent', () => {
  it('renders no <script> and issues no network request when no consent cookie exists', async () => {
    const AnalyticsLoader = await loadAnalyticsLoader(ANALYTICS_HOST);
    const { container } = render(createElement(AnalyticsLoader));

    // Give any pending effect a tick to (not) run.
    await waitFor(() => {
      expect(container.querySelector('script')).toBeNull();
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('renders no <script> when the visitor explicitly rejected consent', async () => {
    document.cookie = 'cookie_consent=rejected; Path=/';
    const AnalyticsLoader = await loadAnalyticsLoader(ANALYTICS_HOST);
    const { container } = render(createElement(AnalyticsLoader));

    await waitFor(() => {
      expect(container.querySelector('script')).toBeNull();
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('analytics consent gate — host not configured', () => {
  it('is a hard no-op even when consent is accepted but no host is set', async () => {
    document.cookie = 'cookie_consent=accepted; Path=/';
    const AnalyticsLoader = await loadAnalyticsLoader(undefined);
    const { container } = render(createElement(AnalyticsLoader));

    await waitFor(() => {
      expect(container.querySelector('script')).toBeNull();
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('analytics consent gate — after consent', () => {
  it('loads the script from the allowlisted host once consent is accepted', async () => {
    document.cookie = 'cookie_consent=accepted; Path=/';
    const AnalyticsLoader = await loadAnalyticsLoader(ANALYTICS_HOST);
    const { container } = render(createElement(AnalyticsLoader));

    const script = await waitFor(() => {
      const el = container.querySelector('script');
      expect(el).not.toBeNull();
      return el as HTMLScriptElement;
    });

    // The src host must be exactly the configured (allowlisted) origin.
    const src = script.getAttribute('src') ?? '';
    expect(src).toBe(`${ANALYTICS_HOST}/script.js`);
    expect(new URL(src).origin).toBe(ANALYTICS_HOST);

    // The opaque site identifier is forwarded as a data attribute, never PII.
    expect(script.getAttribute('data-site')).toBe('hubrity.com');
  });
});
