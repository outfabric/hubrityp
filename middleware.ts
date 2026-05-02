import { NextResponse, type NextRequest } from 'next/server';

import { createMiddlewareClient } from './lib/supabase/middleware';

// Root middleware: refresh the Supabase session cookie on every navigation so
// the server-side renderer always sees an up-to-date session, AND gate the
// authenticated app surface so users land where they belong.
//
// Gating contract (see specs/authentication/spec.md):
//   • Anonymous request to `/dashboard*` → 307 to
//     `/login?redirectTo=<encoded path+search>`. The original path (and query
//     string) is preserved so a successful sign-in can hand the user back to
//     where they were trying to go.
//   • Authenticated request to `/login` → 307 to `/dashboard`. Prevents the
//     "I'm logged in but I see a login form" UX trap.
//   • Anything else (public routes such as `/`, `/api/health`, marketing
//     pages, etc.) is left alone — the cookie-refresh response is returned
//     unmodified.
//
// Cookie-refresh side effects from `createMiddlewareClient` are written to the
// `response` object the helper returns. When we replace that response with a
// fresh `NextResponse.redirect`, we must transplant any Set-Cookie headers
// from the original response onto the redirect, otherwise a token rotation
// that happened during `getUser()` would be silently dropped — the user would
// be redirected with a stale cookie and the next request might log them out
// spuriously.
export async function middleware(request: NextRequest) {
  const { supabase, response } = createMiddlewareClient(request);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  const isLogin = pathname === '/login';
  const isDashboard = pathname === '/dashboard' || pathname.startsWith('/dashboard/');

  // Authenticated user on /login → bounce to /dashboard.
  if (isLogin && user) {
    const url = new URL('/dashboard', request.url);
    return buildRedirect(url, response);
  }

  // Anonymous user on /dashboard* → bounce to /login with the original path
  // preserved as a same-origin redirectTo. encodeURIComponent ensures slashes
  // become `%2F` and the value round-trips through Next's URL parser cleanly.
  if (isDashboard && !user) {
    const target = pathname + (search ?? '');
    const url = new URL(`/login?redirectTo=${encodeURIComponent(target)}`, request.url);
    return buildRedirect(url, response);
  }

  return response;
}

// Construct a 307 redirect that inherits any Set-Cookie headers written by
// `createMiddlewareClient` during the session refresh. Using 307 (Temporary
// Redirect) is intentional: it preserves the request method, so a POST that
// hits a gated route doesn't get silently demoted to GET on the redirect.
function buildRedirect(url: URL, sourceResponse: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(url, 307);
  for (const cookie of sourceResponse.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  return redirect;
}

export const config = {
  matcher: [
    // Skip Next.js internals, static assets, and the favicon — middleware
    // would otherwise add cookie-set overhead to every fetched chunk.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
