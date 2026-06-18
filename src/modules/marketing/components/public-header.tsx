import * as React from 'react';

import { createServerClient } from '@/shared/supabase/server';

import { PublicHeaderClient } from './public-header-client';

/**
 * PublicHeader — server wrapper for the public marketing header.
 *
 * Its sole server responsibility is to resolve a single boolean: "is the
 * visitor authenticated?". It does so via `supabase.auth.getUser()` (NEVER
 * `getSession()`, which trusts the unverified cookie), then hands the boolean
 * — and nothing else — to the {@link PublicHeaderClient} leaf.
 *
 * Security / LGPD posture:
 *   - Only a boolean crosses the server→client boundary. No email, id, CRP, or
 *     any other user field reaches the public HTML, so an authenticated render
 *     of a public page leaks no PII.
 *   - This is a public surface: an authenticated visitor is NOT redirected. The
 *     header simply swaps its CTA to "Acessar plataforma" → `/dashboard`.
 *   - Uses the cookie-bound anon client (`createServerClient`), never the
 *     service-role client — there is no privileged read here.
 *
 * The single `role="banner"` (implicit on the client's `<header>`) remains the
 * only banner landmark on the page.
 */
export async function PublicHeader(): Promise<React.JSX.Element> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Coerce to a strict boolean — the client component never sees the user
  // object, only whether a verified session exists.
  const isAuthenticated = Boolean(user);

  return <PublicHeaderClient isAuthenticated={isAuthenticated} />;
}

PublicHeader.displayName = 'PublicHeader';
