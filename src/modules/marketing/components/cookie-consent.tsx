'use client';

// First-visit LGPD cookie-consent banner (leaf).
// --------------------------------------------------------------------------
// Shown only when the `cookie_consent` cookie is ABSENT. On mount it reads the
// cookie from `document.cookie`; if a decision already exists the banner never
// renders (no flash — the initial state is `false` and we only flip to visible
// after confirming the cookie is missing).
//
// "Aceitar" → writes `cookie_consent=accepted`; "Recusar" → `=rejected`.
// Both dismiss the banner via React state WITHOUT a full page reload. The
// analytics loader independently re-reads the cookie, so accepting here makes
// the tracker eligible on the next render without a navigation.
//
// Design-system constraints (see docs/design-system/rules.md and the public
// pages handoff `132:2`): bottom card, `radius/2xl`, `shadow-lg`, max ~460px,
// surface background, no blur/glassmorphism. Buttons use the DS primary +
// secondary variants. The "Saiba mais" link is the only underlined element.

import Link from 'next/link';
import * as React from 'react';

import {
  parseConsent,
  readConsentCookie,
  serializeConsentCookie,
  type ConsentChoice,
} from '@/modules/marketing/lib/cookie-consent';
import { Button } from '@/shared/ui/button';

const BANNER_TEXT = 'Usamos cookies para melhorar sua experiência e medir o desempenho do site.';

export function CookieConsent(): React.JSX.Element | null {
  // Start hidden: the banner only appears after we confirm (client-side, on
  // mount) that no decision cookie exists. This avoids a flash for returning
  // visitors who have already chosen, and keeps SSR output banner-free.
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const existing = readConsentCookie(document.cookie);
    // Per spec: hide whenever the cookie EXISTS (any value). Only show when
    // there is genuinely no prior decision. The `setVisible` is deferred to the
    // next frame so it is not a synchronous setState inside the effect body
    // (React Compiler `set-state-in-effect` rule) — same pattern as BrowserCheck.
    if (existing === null) {
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }
  }, []);

  const decide = React.useCallback((choice: ConsentChoice) => {
    document.cookie = serializeConsentCookie(choice);
    // Dismiss without a reload; the analytics loader re-reads the cookie on
    // its own render and starts/stays off accordingly.
    setVisible(false);
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="Consentimento de cookies"
      data-testid="cookie-consent-banner"
      className="border-border bg-surface text-text-primary fixed inset-x-4 bottom-4 z-50 mx-auto max-w-[460px] rounded-2xl border p-6 shadow-lg"
    >
      <p className="text-text-secondary text-sm">{BANNER_TEXT}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="default"
          data-testid="cookie-consent-accept"
          onClick={() => decide('accepted')}
        >
          Aceitar
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="default"
          data-testid="cookie-consent-reject"
          onClick={() => decide('rejected')}
        >
          Recusar
        </Button>
        <Button asChild variant="link" size="default" data-testid="cookie-consent-learn-more">
          <Link href="/politica-de-privacidade">Saiba mais</Link>
        </Button>
      </div>
    </div>
  );
}

CookieConsent.displayName = 'CookieConsent';

// Re-export the parser for callers that need to gate behavior on the stored
// choice (e.g. the analytics loader) without importing the lib directly.
export { parseConsent };
