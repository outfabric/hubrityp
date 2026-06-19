import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CookieConsent } from '@/modules/marketing/components/cookie-consent';
import {
  parseConsent,
  readConsentCookie,
  serializeConsentCookie,
} from '@/modules/marketing/lib/cookie-consent';
import { withUtm } from '@/modules/marketing/lib/utm';

/*
 * Section 8 unit coverage:
 *   - Cookie-consent banner visibility by cookie state (8.1).
 *   - "Aceitar"/"Recusar" write the consent cookie with the correct attributes (8.1).
 *   - Consent-gated analytics loader no-ops without consent and without a host (8.2).
 *   - UTM forwarding helper preserves only allowlisted params, opaquely (8.3).
 *
 * The analytics loader reads `clientEnv` (parsed once at module-eval). The
 * host-configured cases therefore stub `NEXT_PUBLIC_ANALYTICS_HOST`, reset the
 * module registry, and dynamically import the component so it picks up the
 * stubbed env — the same pattern the `site.test.ts` suite uses.
 */

// `next/link` → plain anchor; `next/script` → plain <script> so we can assert
// the loader's injected tag and its `src` deterministically in jsdom.
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('next/script', () => ({
  __esModule: true,
  // `defer` keeps the no-sync-scripts lint rule satisfied; the real next/script
  // is non-blocking via `strategy="afterInteractive"`, which we don't model here.
  default: ({ src, ...rest }: { src: string }) => <script defer src={src} {...rest} />,
}));

function clearConsentCookie(): void {
  document.cookie = 'cookie_consent=; Path=/; Max-Age=0';
}

beforeEach(() => {
  clearConsentCookie();
});

afterEach(() => {
  clearConsentCookie();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('cookie-consent lib', () => {
  it('parses only the two valid choices, rejecting anything else', () => {
    expect(parseConsent('accepted')).toBe('accepted');
    expect(parseConsent('rejected')).toBe('rejected');
    expect(parseConsent('evil')).toBeNull();
    expect(parseConsent('')).toBeNull();
    expect(parseConsent(null)).toBeNull();
    expect(parseConsent(undefined)).toBeNull();
  });

  it('reads the cookie value out of a document.cookie string', () => {
    expect(readConsentCookie('theme=dark; cookie_consent=accepted; foo=bar')).toBe('accepted');
    expect(readConsentCookie('cookie_consent=rejected')).toBe('rejected');
    expect(readConsentCookie('theme=dark')).toBeNull();
    expect(readConsentCookie('')).toBeNull();
  });

  it('serializes the consent cookie with SameSite=Lax; Secure; one-year Max-Age; Path=/', () => {
    const serialized = serializeConsentCookie('accepted');
    expect(serialized).toContain('cookie_consent=accepted');
    expect(serialized).toContain('Path=/');
    expect(serialized).toContain('Max-Age=31536000');
    expect(serialized).toContain('SameSite=Lax');
    expect(serialized).toContain('Secure');
  });
});

describe('CookieConsent banner visibility', () => {
  it('shows the banner when no consent cookie is present', async () => {
    render(<CookieConsent />);
    expect(await screen.findByTestId('cookie-consent-banner')).toBeInTheDocument();
  });

  it('does not show the banner when a consent cookie already exists (any value)', async () => {
    document.cookie = 'cookie_consent=accepted; Path=/';
    render(<CookieConsent />);
    // The effect runs on mount; assert the banner stays absent.
    await waitFor(() => {
      expect(screen.queryByTestId('cookie-consent-banner')).not.toBeInTheDocument();
    });
  });

  it('links "Saiba mais" to the privacy policy', async () => {
    render(<CookieConsent />);
    // `asChild` merges the Button props (incl. the testid) onto the inner <a>.
    const link = await screen.findByTestId('cookie-consent-learn-more');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/politica-de-privacidade');
  });
});

describe('CookieConsent decision writes the cookie and dismisses without reload', () => {
  // jsdom over a non-https origin silently drops cookies written with the
  // `Secure` attribute, so reading `document.cookie` back is unreliable. We
  // instead spy on the `document.cookie` SETTER to capture exactly the string
  // the component wrote, and assert the full attribute contract on it.
  function spyOnCookieWrites(): { writes: string[] } {
    const writes: string[] = [];
    const proto = Object.getPrototypeOf(document);
    const original = Object.getOwnPropertyDescriptor(proto, 'cookie');
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: (): string => (original?.get?.call(document) as string | undefined) ?? '',
      set: (value: string) => {
        writes.push(value);
        original?.set?.call(document, value);
      },
    });
    return { writes };
  }

  it('"Aceitar" writes cookie_consent=accepted with the spec attributes and hides the banner', async () => {
    const user = userEvent.setup();
    const { writes } = spyOnCookieWrites();
    render(<CookieConsent />);

    await user.click(await screen.findByTestId('cookie-consent-accept'));

    const consentWrite = writes.find((w) => w.startsWith('cookie_consent='));
    expect(consentWrite).toBeDefined();
    expect(consentWrite).toContain('cookie_consent=accepted');
    expect(consentWrite).toContain('Path=/');
    expect(consentWrite).toContain('Max-Age=31536000');
    expect(consentWrite).toContain('SameSite=Lax');
    expect(consentWrite).toContain('Secure');

    await waitFor(() => {
      expect(screen.queryByTestId('cookie-consent-banner')).not.toBeInTheDocument();
    });
  });

  it('"Recusar" writes cookie_consent=rejected and hides the banner', async () => {
    const user = userEvent.setup();
    const { writes } = spyOnCookieWrites();
    render(<CookieConsent />);

    await user.click(await screen.findByTestId('cookie-consent-reject'));

    const consentWrite = writes.find((w) => w.startsWith('cookie_consent='));
    expect(consentWrite).toContain('cookie_consent=rejected');

    await waitFor(() => {
      expect(screen.queryByTestId('cookie-consent-banner')).not.toBeInTheDocument();
    });
  });
});

// `clientEnv` parses env once at module-eval, so the analytics loader is loaded
// per-case via a stubbed env + resetModules + dynamic import.
async function loadAnalyticsLoader(host: string | undefined) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'unit-test-anon-key');
  vi.stubEnv('NEXT_PUBLIC_STREAM_API_KEY', 'unit-test-stream-public-key');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://127.0.0.1:3000');
  // `undefined` deletes the var so the optional schema sees it as unset (an
  // empty string would fail `.url()`); a real URL exercises the host path.
  vi.stubEnv('NEXT_PUBLIC_ANALYTICS_HOST', host);
  const mod = await import('@/modules/marketing/components/analytics-loader');
  return mod.AnalyticsLoader;
}

describe('AnalyticsLoader consent + host gating', () => {
  it('renders nothing when no analytics host is configured (even with consent)', async () => {
    document.cookie = 'cookie_consent=accepted; Path=/';
    const AnalyticsLoader = await loadAnalyticsLoader(undefined);
    const { container } = render(<AnalyticsLoader />);
    await waitFor(() => {
      expect(container.querySelector('script')).toBeNull();
    });
  });

  it('renders nothing when a host is configured but the visitor has not consented', async () => {
    // No consent cookie at all.
    const AnalyticsLoader = await loadAnalyticsLoader('https://analytics.example.com');
    const { container } = render(<AnalyticsLoader />);
    await waitFor(() => {
      expect(container.querySelector('script')).toBeNull();
    });
  });

  it('renders nothing when the visitor explicitly rejected, even with a host', async () => {
    document.cookie = 'cookie_consent=rejected; Path=/';
    const AnalyticsLoader = await loadAnalyticsLoader('https://analytics.example.com');
    const { container } = render(<AnalyticsLoader />);
    await waitFor(() => {
      expect(container.querySelector('script')).toBeNull();
    });
  });

  it('injects the script from the configured host once consent is accepted', async () => {
    document.cookie = 'cookie_consent=accepted; Path=/';
    const AnalyticsLoader = await loadAnalyticsLoader('https://analytics.example.com');
    const { container } = render(<AnalyticsLoader />);
    await waitFor(() => {
      const script = container.querySelector('script');
      expect(script).not.toBeNull();
      expect(script?.getAttribute('src')).toBe('https://analytics.example.com/script.js');
    });
  });
});

describe('UTM forwarding (withUtm)', () => {
  it('forwards only allowlisted utm_* params, preserving them verbatim', () => {
    expect(withUtm('/signup', '?utm_source=newsletter&utm_campaign=launch&utm_medium=email')).toBe(
      '/signup?utm_source=newsletter&utm_medium=email&utm_campaign=launch',
    );
  });

  it('drops non-allowlisted params (no arbitrary smuggling onto the target)', () => {
    expect(withUtm('/signup', '?utm_source=x&evil=%3Cscript%3E&foo=bar')).toBe(
      '/signup?utm_source=x',
    );
  });

  it('forwards common click identifiers (gclid/fbclid)', () => {
    expect(withUtm('/signup', '?gclid=abc123')).toBe('/signup?gclid=abc123');
  });

  it('returns the target unchanged when there are no tracking params', () => {
    expect(withUtm('/signup', '')).toBe('/signup');
    expect(withUtm('/signup', '?foo=bar')).toBe('/signup');
  });

  it('ignores empty-valued tracking params', () => {
    expect(withUtm('/signup', '?utm_source=&utm_campaign=launch')).toBe(
      '/signup?utm_campaign=launch',
    );
  });
});
