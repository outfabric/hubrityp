import { NextResponse, type NextRequest } from 'next/server';

import { type AccountStatus, getAccountStatus } from '@/modules/account-lifecycle';
import { logger } from '@/shared/lib/logger';
import { clearSupabaseAuthCookies, createMiddlewareClient } from '@/shared/supabase/middleware';

// Root middleware: refresh the Supabase session cookie on every navigation,
// then route the request based on (a) the presence of an authenticated
// session and (b) the lifecycle status of the associated psychologist
// profile. The two contracts implemented here come from
// `specs/authentication/spec.md` (auth gating) and
// `specs/account-lifecycle/spec.md` (status drives access).
//
// Routing matrix (auth + status × path) — fully spelled out in the test
// `middleware-status.int.test.ts`. High-level signal:
//
//   • Anonymous on `(app)` → `/login?redirectTo=<encoded path+search>`.
//   • Anonymous on `/login`, `/signup`, `/auth/*` → passthrough.
//   • Authenticated `active` on `/dashboard*` → passthrough.
//   • Authenticated `pending_*` on `/dashboard*` → redirect to the matching
//     bloqueante page.
//   • Authenticated `suspended` / `cancelled` on `/dashboard*` → clear
//     Supabase auth cookies and redirect to `/login?reason=<status>`.
//   • Authenticated user on `/login` or `/signup` → status-routed away from
//     the form (active → /dashboard, pending_* → bloqueante,
//     suspended/cancelled → cookie clear + /login?reason=).
//   • Authenticated user on the wrong bloqueante page → redirect to the
//     correct one for the actual status.
//   • `/auth/callback` is always passthrough — status routing has to wait
//     until AFTER the OAuth/email exchange, which is the handler's job.
//
// Cookie-refresh side effects from `createMiddlewareClient` are written to
// the `response` object the helper returns. When we replace that response
// with a `NextResponse.redirect`, we transplant any Set-Cookie headers from
// the original response onto the redirect via `buildRedirect`, otherwise a
// token rotation that happened during `getUser()` would be silently dropped
// — the user would be redirected with a stale cookie and the next request
// might log them out spuriously.
export async function middleware(request: NextRequest) {
  const { supabase, response } = createMiddlewareClient(request);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  // ─── Always-passthrough surfaces ─────────────────────────────────────
  // These paths must NOT be redirected for either authenticated or
  // anonymous requests. The cookie-refresh response still goes back so any
  // token rotation that happened during `getUser()` is preserved.
  if (isAlwaysPassthrough(pathname)) {
    return response;
  }

  // ─── Anonymous branch ────────────────────────────────────────────────
  if (!user) {
    if (isAppRoute(pathname)) {
      // Preserve the original path + query so a successful sign-in can hand
      // the user back to where they were trying to go. encodeURIComponent
      // ensures slashes become `%2F` and the value round-trips through
      // Next's URL parser cleanly.
      const target = pathname + (search ?? '');
      const url = new URL(`/login?redirectTo=${encodeURIComponent(target)}`, request.url);
      return buildRedirect(url, response);
    }
    // Anonymous on `/login`, `/signup`, `/auth/verify-email`, etc. — let
    // the page render. The bloqueante pages defensively redirect to /login
    // themselves when no session is present (with a `redirectTo` so a
    // successful login lands the user back on the right gate).
    return response;
  }

  // ─── Authenticated branch — consult status ───────────────────────────
  // `getAccountStatus` may throw (DB outage, malformed row). We log and
  // fail open as ANONYMOUS so the user gets a deterministic experience
  // (login form) instead of a 500. This is conservative: a real anonymous
  // would just see the login form, and a real authenticated will retry on
  // the next nav once the DB recovers.
  let status: AccountStatus | null;
  try {
    const result = await getAccountStatus(user.id);
    status = result.status;
  } catch (error) {
    logger.error(
      { event: 'middleware_status_lookup_failed', userId: user.id, error: serialiseError(error) },
      'getAccountStatus threw inside middleware — treating request as anonymous',
    );
    if (isAppRoute(pathname)) {
      const target = pathname + (search ?? '');
      const url = new URL(`/login?redirectTo=${encodeURIComponent(target)}`, request.url);
      return buildRedirect(url, response);
    }
    return response;
  }

  // Orphaned session: the auth user exists but no profile row. This should
  // be impossible post-signup (the same Server Action inserts the auth
  // user AND the profile in one transaction), but a half-state must never
  // reach the dashboard. Clear the cookies and bounce to login with a
  // dedicated reason so support can identify the case in logs.
  if (status === null) {
    return buildClearCookiesRedirect(
      new URL('/login?reason=profile_missing', request.url),
      request,
      response,
    );
  }

  // ─── Authenticated × app route (`/dashboard*`) ───────────────────────
  if (isAppRoute(pathname)) {
    return routeByStatusForApp(request, response, status);
  }

  // ─── Authenticated × `/login` or `/signup` ───────────────────────────
  if (isLoginOrSignup(pathname)) {
    return routeByStatusForAuthForm(request, response, status);
  }

  // ─── Authenticated × bloqueante pages ────────────────────────────────
  if (pathname === '/auth/verify-email' || pathname === '/auth/crp-review') {
    return routeByStatusForBloqueante(request, response, status, pathname);
  }

  // Anything else (unknown path) — passthrough with the cookie-refresh
  // response. This should be rare given the matcher excludes static assets
  // and Next internals, but a passthrough is the safe default.
  return response;
}

// ─── Path classification helpers ───────────────────────────────────────
// Strict prefix match: `/dashboard` and `/dashboard/...` only. Paths that
// merely contain "dashboard" elsewhere (e.g. `/some/dashboard-news`) are
// NOT app routes.
function isAppRoute(pathname: string): boolean {
  return pathname === '/dashboard' || pathname.startsWith('/dashboard/');
}

function isLoginOrSignup(pathname: string): boolean {
  return pathname === '/login' || pathname === '/signup';
}

// Paths that bypass status routing entirely. `/auth/callback` is the
// post-exchange redirect target, so the handler — not the middleware —
// owns its routing. `/api/*` routes are gated by their own handlers (they
// validate the JWT directly via `createServerClient`). `/` is the public
// marketing page.
function isAlwaysPassthrough(pathname: string): boolean {
  if (pathname === '/auth/callback' || pathname.startsWith('/auth/callback/')) return true;
  if (pathname.startsWith('/api/')) return true;
  if (pathname === '/') return true;
  return false;
}

// ─── Status routing helpers ────────────────────────────────────────────
function routeByStatusForApp(
  request: NextRequest,
  response: NextResponse,
  status: AccountStatus,
): NextResponse {
  switch (status) {
    case 'active':
      return response;
    case 'pending_verification':
      return buildRedirect(new URL('/auth/verify-email', request.url), response);
    case 'pending_crp_validation':
      return buildRedirect(new URL('/auth/crp-review', request.url), response);
    case 'suspended':
      return buildClearCookiesRedirect(
        new URL('/login?reason=suspended', request.url),
        request,
        response,
      );
    case 'cancelled':
      return buildClearCookiesRedirect(
        new URL('/login?reason=cancelled', request.url),
        request,
        response,
      );
  }
}

function routeByStatusForAuthForm(
  request: NextRequest,
  response: NextResponse,
  status: AccountStatus,
): NextResponse {
  switch (status) {
    case 'active':
      return buildRedirect(new URL('/dashboard', request.url), response);
    case 'pending_verification':
      return buildRedirect(new URL('/auth/verify-email', request.url), response);
    case 'pending_crp_validation':
      return buildRedirect(new URL('/auth/crp-review', request.url), response);
    case 'suspended':
      return buildClearCookiesRedirect(
        new URL('/login?reason=suspended', request.url),
        request,
        response,
      );
    case 'cancelled':
      return buildClearCookiesRedirect(
        new URL('/login?reason=cancelled', request.url),
        request,
        response,
      );
  }
}

function routeByStatusForBloqueante(
  request: NextRequest,
  response: NextResponse,
  status: AccountStatus,
  pathname: '/auth/verify-email' | '/auth/crp-review',
): NextResponse {
  switch (status) {
    case 'active':
      // Already past both gates — no reason to render a bloqueante page.
      return buildRedirect(new URL('/dashboard', request.url), response);
    case 'pending_verification':
      // Render verify-email; redirect away from crp-review.
      return pathname === '/auth/verify-email'
        ? response
        : buildRedirect(new URL('/auth/verify-email', request.url), response);
    case 'pending_crp_validation':
      // Render crp-review; redirect away from verify-email.
      return pathname === '/auth/crp-review'
        ? response
        : buildRedirect(new URL('/auth/crp-review', request.url), response);
    case 'suspended':
      return buildClearCookiesRedirect(
        new URL('/login?reason=suspended', request.url),
        request,
        response,
      );
    case 'cancelled':
      return buildClearCookiesRedirect(
        new URL('/login?reason=cancelled', request.url),
        request,
        response,
      );
  }
}

// ─── Response builders ─────────────────────────────────────────────────
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

// Same as `buildRedirect`, but additionally enumerates every Supabase auth
// cookie present on the request and emits a delete (`Max-Age=0`) for each.
// The deletes are written AFTER the inherited Set-Cookie headers so they
// take precedence: any token-rotation cookie that the refresh wrote during
// `getUser()` is overridden by the delete on the same name. Callers use
// this for suspended/cancelled (intentional lockout) and the orphan-session
// case (`status === null`).
function buildClearCookiesRedirect(
  url: URL,
  request: NextRequest,
  sourceResponse: NextResponse,
): NextResponse {
  const redirect = NextResponse.redirect(url, 307);
  for (const cookie of sourceResponse.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  clearSupabaseAuthCookies(request, redirect);
  return redirect;
}

// Pino can serialise Errors via its built-in serializers, but the helper
// is invoked from middleware that already has a custom log shape (`event`
// + named fields). We pull the bare-minimum diagnostic info and never log
// stack traces from production — they routinely contain PII in URLs.
function serialiseError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: 'UnknownError', message: String(error) };
}

// Run on the Node.js runtime (not Edge). The status read inside
// `getAccountStatus` uses Drizzle ORM + `postgres-js`, both of which depend
// on the `pg` / Node socket APIs that the Edge runtime does not provide.
// Per the Next.js 16 docs, `middleware.ts` supports both runtimes and
// defaults to Edge — we opt into Node explicitly here. The new `proxy.ts`
// convention is also Node-only and would be the path of least resistance,
// but we keep `middleware.ts` for now so the existing import paths and
// CLAUDE.md references stay accurate; switching to `proxy.ts` is a
// follow-up cleanup.
export const config = {
  runtime: 'nodejs',
  matcher: [
    // Skip Next.js internals, static assets, and the favicon — middleware
    // would otherwise add cookie-set overhead to every fetched chunk.
    // Intentionally lets `/api/*` and `/auth/callback` reach the middleware
    // (so the session cookie can be refreshed even on those paths) — the
    // routing logic itself early-returns on those paths via
    // `isAlwaysPassthrough`.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
