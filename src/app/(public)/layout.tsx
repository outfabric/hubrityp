import * as React from 'react';

import {
  AnalyticsLoader,
  CookieConsent,
  MAIN_CONTENT_ID,
  PublicFooter,
  PublicHeader,
  SkipLink,
  ThemeProvider,
} from '@/modules/marketing';

/**
 * Public layout — wraps every page in the `(public)` route group with the
 * marketing chrome: skip link, header (banner), `<main>`, footer (contentinfo).
 *
 * Server Component by design. It MUST NOT:
 *   - import a service-role Supabase client,
 *   - fetch or render any authenticated app surface, or
 *   - leak user data (email / id / CRP).
 * The header (`PublicHeader`) is itself an async Server Component that resolves
 * a boolean "is authenticated" flag via `supabase.auth.getUser()` and renders
 * only that boolean into its client leaf — the layout never handles or renders
 * user-specific content.
 *
 * Landmark contract (asserted by the integration test): exactly one banner,
 * one main, one contentinfo — in document order. The skip link is the first
 * focusable element and targets the `<main id="conteudo">` content.
 */
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    // ThemeProvider wraps the public subtree so the header's ThemeToggle has a
    // theme context. It carries no user data — only the light/dark choice the
    // no-flash script already applied to <html>.
    <ThemeProvider>
      <div className="flex min-h-svh flex-col">
        <SkipLink />
        <PublicHeader />
        <main id={MAIN_CONTENT_ID} className="flex-1">
          {children}
        </main>
        <PublicFooter />
      </div>
      {/* LGPD cookie-consent banner (shown until a choice is stored) + the
          consent-gated analytics loader. Both are client leaves; the loader
          is a no-op until consent is `accepted` and an analytics host is
          configured, and is deferred so it never blocks first paint. */}
      <CookieConsent />
      <AnalyticsLoader />
    </ThemeProvider>
  );
}
