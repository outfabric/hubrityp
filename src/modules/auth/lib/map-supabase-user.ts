/**
 * Adapter from a Supabase `User` (or `null`) to the minimal app-user shape
 * we expose to the rest of the app.
 *
 * Supabase's `User` carries metadata, identities, timestamps, etc. The app
 * only needs `{ id, email }` to render UI and authorize requests, and we
 * intentionally drop everything else to keep the surface narrow and to
 * avoid leaking PII fields by accident.
 *
 * The input is structurally typed (rather than imported from
 * `@supabase/supabase-js`) so this helper stays a pure module that can be
 * used from any layer without pulling in the auth SDK type graph.
 */
type SupabaseUserLike = {
  id?: string | null;
  email?: string | null;
};

export type AppUser = {
  id: string;
  email: string;
};

export function mapSupabaseUser(user: SupabaseUserLike | null | undefined): AppUser | null {
  if (!user) {
    return null;
  }

  const { id, email } = user;

  if (typeof id !== 'string' || id === '') {
    return null;
  }

  if (typeof email !== 'string' || email === '') {
    return null;
  }

  return { id, email };
}
