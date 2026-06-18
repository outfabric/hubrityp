import * as React from 'react';

import { MAIN_CONTENT_ID, PublicFooter, PublicHeader, SkipLink } from '@/modules/marketing';

/**
 * Public layout — wraps every page in the `(public)` route group with the
 * marketing chrome: skip link, header (banner), `<main>`, footer (contentinfo).
 *
 * Server Component by design. It MUST NOT:
 *   - import a service-role Supabase client,
 *   - fetch or render any authenticated app surface, or
 *   - leak user data (email / id / CRP).
 * The header may later read a boolean "is authenticated" flag (section 6), but
 * the layout itself never renders user-specific content.
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
    <div className="flex min-h-svh flex-col">
      <SkipLink />
      <PublicHeader />
      <main id={MAIN_CONTENT_ID} className="flex-1">
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}
