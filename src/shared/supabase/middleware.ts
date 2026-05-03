import 'server-only';

import { createServerClient as createSsrServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { clientEnv } from '@/shared/env/client';

// Construct a Supabase client suited to Next.js root middleware. The caller
// receives both the response (with refreshed cookies) and the client itself,
// in case the caller wants to call `supabase.auth.getUser()` to gate a route.
export function createMiddlewareClient(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createSsrServerClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll(): { name: string; value: string }[] {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]): void {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  return { supabase, response };
}

// Match the Supabase-managed auth cookie names. `@supabase/ssr` writes the
// session as either:
//   • `sb-<projectRef>-auth-token` — small payloads (single cookie), OR
//   • `sb-<projectRef>-auth-token.0`, `…1`, … — chunked payloads (large JWTs).
// This regex catches both shapes so we delete every part of a chunked
// session in one pass. A plain `startsWith('sb-')` check would over-match
// on unrelated Supabase cookies (e.g. realtime), and a plain
// `endsWith('-auth-token')` would miss the chunk variants.
const SUPABASE_AUTH_COOKIE = /^sb-.*-auth-token(\.\d+)?$/;

// Find every Supabase auth cookie present on the request. Used by the
// middleware when a status transition (suspended/cancelled) requires a hard
// session clear — we cannot call `signOut()` from edge middleware without a
// network round-trip to GoTrue, so we delete the cookies directly instead.
export function findSupabaseAuthCookieNames(request: NextRequest): string[] {
  return request.cookies
    .getAll()
    .map((c) => c.name)
    .filter((name) => SUPABASE_AUTH_COOKIE.test(name));
}

// Mutate `response` so that every Supabase auth cookie present on the
// request is sent back as a deletion (`Max-Age=0`). The browser drops the
// cookie immediately, leaving the next request fully anonymous.
//
// Called only on suspended/cancelled transitions — the status itself
// represents an intent to lock the user out, so a fail-closed posture is
// correct: even if the status read raced and the row flipped back to
// `active` between the read and the next request, the user will simply
// re-authenticate to recover.
export function clearSupabaseAuthCookies(request: NextRequest, response: NextResponse): void {
  for (const name of findSupabaseAuthCookieNames(request)) {
    response.cookies.delete(name);
  }
}
