import 'server-only';

import { createServerClient as createSsrServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { clientEnv } from '@/shared/env';

// Construct a per-request Supabase client for use in RSC, Server Actions, and
// Route Handlers. We deliberately do NOT memoize across requests — each
// request must read its own cookies to avoid session bleed between users.
export async function createServerClient() {
  const cookieStore = await cookies();

  return createSsrServerClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll(): { name: string; value: string }[] {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]): void {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // `cookies().set` throws when called from a Server Component
            // (cookies are immutable there). Mutations must happen in a
            // Server Action, Route Handler, or middleware. Swallowing here
            // matches the official `@supabase/ssr` example.
          }
        },
      },
    },
  );
}
