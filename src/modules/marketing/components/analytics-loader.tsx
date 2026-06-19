'use client';

// Consent-gated analytics loader (leaf).
// --------------------------------------------------------------------------
// Injects the privacy-friendly analytics provider script ONLY when BOTH:
//   1. an analytics host is configured (`NEXT_PUBLIC_ANALYTICS_HOST`), and
//   2. the visitor has consented (`cookie_consent=accepted`).
// In every other case this component renders `null` — no script tag, no
// network request. This is the technical enforcement of the LGPD "no analytics
// before consent" rule (RNF-14.06): with no consent there is nothing to load.
//
// The script is deferred (`strategy="afterInteractive"`) so it never blocks
// first paint — the loader is purely additive after hydration.
//
// Host allowlisting: the script `src` is built from `clientEnv.NEXT_PUBLIC_ANALYTICS_HOST`,
// a build-time env value validated as a URL — never from user input or the URL
// bar — so this cannot be turned into an arbitrary-script-injection sink.
//
// `clientEnv` is imported from the leaf (`@/shared/env/client`), not the
// `@/shared/env` barrel: the barrel is `server-only` and importing a runtime
// value from it inside a client component breaks the Next build.

import Script from 'next/script';
import * as React from 'react';

import { parseConsent, readConsentCookie } from '@/modules/marketing/lib/cookie-consent';
import { clientEnv } from '@/shared/env/client';

export function AnalyticsLoader(): React.JSX.Element | null {
  const host = clientEnv.NEXT_PUBLIC_ANALYTICS_HOST;
  const siteId = clientEnv.NEXT_PUBLIC_ANALYTICS_SITE_ID;

  // Re-read the consent cookie on mount (and whenever the component remounts)
  // so accepting in the banner — which dismisses without a reload — makes the
  // tracker eligible on the next render. Starts `false` so SSR and the first
  // client render emit no script.
  const [consented, setConsented] = React.useState(false);

  React.useEffect(() => {
    const choice = parseConsent(readConsentCookie(document.cookie));
    // Deferred to the next frame so it is not a synchronous setState inside the
    // effect body (React Compiler `set-state-in-effect` rule).
    if (choice === 'accepted') {
      const id = requestAnimationFrame(() => setConsented(true));
      return () => cancelAnimationFrame(id);
    }
  }, []);

  // No host configured (local / dev / CI / preview) → hard no-op. No tracker is
  // ever shipped where analytics is not explicitly enabled.
  if (!host) {
    return null;
  }

  // Not consented → no script, no network. This is the consent gate.
  if (!consented) {
    return null;
  }

  // `host` is a validated absolute URL; strip any trailing slash so the script
  // path concatenates cleanly. The provider script path is fixed by us.
  const normalizedHost = host.replace(/\/+$/, '');

  return (
    <Script
      // Deferred, non-blocking: never delays first paint.
      strategy="afterInteractive"
      src={`${normalizedHost}/script.js`}
      // `data-site` is the provider's opaque site identifier (e.g. a Plausible
      // domain / Umami site id). Optional — omitted when unset.
      {...(siteId ? { 'data-site': siteId } : {})}
      data-testid="analytics-script"
    />
  );
}

AnalyticsLoader.displayName = 'AnalyticsLoader';
