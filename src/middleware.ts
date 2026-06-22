import type { User } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

// IMPORTANT: import from the Edge-only barrel, NOT `@/modules/registration`.
// The canonical barrel transitively pulls Drizzle (`postgres-js` ->
// `node:crypto`), which the Edge runtime does not expose -- bundling it
// crashes the worker at module-evaluation time. The `/edge` entrypoint
// re-exports the same `getCurrentProfileEdge`, `ProfileStatus`, and
// `Profile` symbols without touching Node-only deps.
import { getCurrentProfileEdge, ProfileStatus, type Profile } from '@/modules/registration/edge';
import { edgeLogger } from '@/shared/lib/edge-logger';
import { createMiddlewareClient } from '@/shared/supabase/middleware';

// Root middleware: refresh the Supabase session cookie on every navigation
// AND gate every route inside the matcher according to the decision table
// in `specs/authentication/spec.md` ("Requirement: Middleware enforces auth
// gating for `(app)` routes").
//
// Decision table (path x session state -- `null` represents "no session"):
//
// The `active + !rpr` column is split into two sub-columns by onboarding
// completion: `onb!` (onboarding INCOMPLETE -- onboarding_step != 'done' AND
// onboarding_completed_at IS NULL) and `onb✓` (onboarding COMPLETE). An active
// user who has not finished (or skipped) the first-run wizard is funneled into
// it; once complete, the historical behavior applies.
//
//   Path requested              | null        | OAuth, no profile        | pending_*             | active+!rpr onb! | active+!rpr onb✓ | active + rpr        | suspended/cancelled (*)
//   ----------------------------|-------------|--------------------------|----------------------|------------------|------------------|---------------------|------------------------
//   /login, /signup             | pass        | ->/onboarding/c-p         | ->/onboarding/pending | ->/onb/welcome    | ->/dashboard      | ->/forgot-password   | pass + signOut
//   /forgot-password            | pass        | ->/onboarding/c-p         | pass                 | ->/onb/welcome    | ->/dashboard      | pass                | ->/login + signOut
//   /reset-password             | pass        | ->/onboarding/c-p         | pass                 | pass             | pass             | pass                | ->/login + signOut
//   /auth/link-account          | pass        | pass                     | ->/onboarding/pending | ->/onb/welcome    | ->/dashboard      | ->/forgot-password   | ->/login + signOut
//   /onboarding/complete-profile| ->/login?...| pass                     | ->/onboarding/pending | ->/onb/welcome    | ->/dashboard      | ->/forgot-password   | ->/login + signOut
//   /onboarding/pending         | ->/login?...| ->/onboarding/c-p         | pass                 | ->/onb/welcome    | ->/dashboard      | ->/forgot-password   | ->/login + signOut
//   /onboarding/welcome,        | ->/login?...| ->/onboarding/c-p         | ->/onboarding/pending | pass             | ->/dashboard      | ->/forgot-password   | ->/login + signOut
//     /onboarding/setup*        |             |                          |                      |                  |                  |                     |
//   /dashboard*, /sessao*,      | ->/login?...| ->/onboarding/c-p         | ->/onboarding/pending | ->/onb/welcome    | pass             | ->/forgot-password   | ->/login + signOut
//     other (app)               |             |                          |                      |                  |                  |                     |
//   /auth/callback              | pass        | pass                     | pass                 | pass             | pass             | pass                | pass
//   /, /api/health, public      | pass        | pass                     | pass                 | pass             | pass             | pass                | pass
//
// Legend: rpr = requires_password_reset, c-p = complete-profile,
//   /onb/welcome = /onboarding/welcome, onb! = onboarding incomplete,
//   onb✓ = onboarding complete.
//
// The onboarding wizard routes (`/onboarding/welcome`, `/onboarding/setup*`)
// form their own `'onboarding-wizard'` path class so the active-incomplete
// branch can `pass` on them WITHOUT looping (an incomplete user redirected to
// /onboarding/welcome must then pass on /onboarding/welcome). For anon/pending/
// suspended/cancelled the class behaves identically to the `'app'` class.
//
// (*) Suspended/cancelled with a live cookie MUST have the session cleared
// before any redirect is emitted -- otherwise the next request still carries
// the old JWT and the same row resolves the same status, looping forever.
// `/login` and `/signup` for suspended users intentionally pass through
// (rather than self-redirecting) so the visible login form is what greets
// the user after `signOut` clears the cookie.
//
// Why this lives in middleware (Edge), not in a layout (RSC):
//   - Cookie refresh MUST happen at the edge -- the Server Components below
//     read the refreshed cookie via `createServerClient(await cookies())`.
//   - An RSC layout cannot redirect before the cookie write commits, which
//     would force a double round-trip on every navigation.
//
// Why Edge and not Node: the Next.js 16 `middleware.ts` file convention
// runs on the Edge runtime (per Next.js 16 docs -- only the new `proxy.ts`
// convention defaults to Node.js). Drizzle (`postgres-js`) doesn't run on
// Edge -- that's why we use `getCurrentProfileEdge`, which goes through the
// Supabase REST surface authenticated by the user's JWT (RLS-scoped,
// single-row PK lookup).
//
// `null` profile semantics: an authenticated user whose `profiles` row
// hasn't been materialized yet depends on the auth provider:
//   - OAuth user (non-email provider) -> directed to `/onboarding/complete-profile`
//     to fill in CRP and consent fields that the trigger doesn't populate.
//   - Email user -> race window (trigger hasn't committed). Treated as
//     anonymous; the next request applies the correct status row.
//
// Cookie-set transplant: `createMiddlewareClient` writes refreshed cookies
// onto its `response` object via the `@supabase/ssr` cookie adapter. When
// we replace that response with a redirect, we MUST copy those cookies onto
// the redirect -- otherwise a token rotation that happened during
// `getUser()` would be silently dropped, and the redirect would arrive
// with a stale cookie.

// Auth surfaces -- login + signup share the same redirect rules per the
// decision table. `/forgot-password` and `/reset-password` have distinct
// rules and are classified separately.
const AUTH_PATHS: ReadonlySet<string> = new Set(['/login', '/signup']);
const FORGOT_PASSWORD_PATH = '/forgot-password';
const RESET_PASSWORD_PATH = '/reset-password';

// `/auth/callback` is a flow intermediary that always passes through;
// `/auth/link-account` has its own row in the decision table.
const CALLBACK_PATH = '/auth/callback';
const LINK_ACCOUNT_PATH = '/auth/link-account';
const COMPLETE_PROFILE_PATH = '/onboarding/complete-profile';

const ONBOARDING_PATH = '/onboarding/pending';
// First-run wizard entrypoint. An `active` user with incomplete onboarding is
// funneled here from every gated/auth surface (see `decideWithProfile`).
const WELCOME_PATH = '/onboarding/welcome';
const DASHBOARD_PATH = '/dashboard';
const LOGIN_PATH = '/login';

// Public marketing + legal routes (the `(public)` route group). Classified
// with exact-or-prefix+separator semantics so a near-miss substring such as
// `/precos-internos` is NOT matched. The homepage `/` is matched separately
// (exact only) because a bare-prefix check on `/` would match every path.
const PUBLIC_MARKETING_PREFIXES = [
  '/precos',
  '/politica-de-privacidade',
  '/termos-de-uso',
] as const;

// Each distinct row in the decision table maps to one PathClass value.
type PathClass =
  | 'auth'
  | 'forgot-password'
  | 'reset-password'
  | 'link-account'
  | 'complete-profile'
  | 'callback'
  | 'onboarding'
  | 'onboarding-wizard'
  | 'app'
  | 'public';

// Pure path classifier. Each distinct row in the decision table gets its own
// path class so `decide()` can apply fine-grained redirect rules. Public
// paths fall through to the default `pass` branch.
function classifyPath(pathname: string): PathClass {
  if (pathname === CALLBACK_PATH || pathname.startsWith(`${CALLBACK_PATH}/`)) {
    return 'callback';
  }
  if (pathname === LINK_ACCOUNT_PATH || pathname.startsWith(`${LINK_ACCOUNT_PATH}/`)) {
    return 'link-account';
  }
  if (pathname === COMPLETE_PROFILE_PATH || pathname.startsWith(`${COMPLETE_PROFILE_PATH}/`)) {
    return 'complete-profile';
  }
  if (pathname === FORGOT_PASSWORD_PATH) {
    return 'forgot-password';
  }
  if (pathname === RESET_PASSWORD_PATH) {
    return 'reset-password';
  }
  if (AUTH_PATHS.has(pathname)) {
    return 'auth';
  }
  if (pathname === ONBOARDING_PATH || pathname.startsWith(`${ONBOARDING_PATH}/`)) {
    return 'onboarding';
  }
  // `/onboarding/welcome` and `/onboarding/setup*` are the onboarding WIZARD
  // (first-run) routes. They get their OWN path class (`'onboarding-wizard'`)
  // rather than folding into `'app'`, because an `active` user with INCOMPLETE
  // onboarding is redirected TO the wizard and must then `pass` ON the wizard
  // (otherwise we loop). The dedicated class lets `decideWithProfile()` split
  // the active branch cleanly: incomplete -> pass on wizard, complete -> bounce
  // wizard to /dashboard. For anon/pending/suspended/cancelled the class is
  // handled identically to `'app'` at the decision sites (anon ->
  // /login?redirectTo=, pending -> /onboarding/pending, suspended/cancelled ->
  // clear+redirect). The strict prefix+separator check (exact OR prefix + `/`)
  // rejects near-miss paths like `/onboarding/welcomex` -- see
  // onboarding-wizard-gating.int.test.ts.
  const ONBOARDING_WIZARD_PREFIXES = ['/onboarding/welcome', '/onboarding/setup'] as const;
  for (const prefix of ONBOARDING_WIZARD_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return 'onboarding-wizard';
    }
  }
  // `(app)` shell: all authenticated route prefixes. The strict prefix check
  // (exact match OR prefix + `/` separator) prevents false matches like
  // `/pacientes-info` or `/dashboardnews` -- see the matcher-boundary tests.
  // `/dashboard/transcricoes` (AI transcription review UI) is intentionally
  // NOT a separate entry: the `/dashboard` prefix already subsumes every
  // `/dashboard/...` subpath via the strict prefix+separator check below, so
  // `/dashboard/transcricoes` and `/dashboard/transcricoes/<id>/revisar`
  // resolve to the `'app'` (gated) class. A dedicated entry would be dead
  // code -- see transcricoes-gating.int.test.ts for the negative-auth proof.
  const APP_PREFIXES = [
    '/pacientes',
    '/agenda',
    '/caixa-de-entrada',
    '/configuracoes',
    '/dashboard',
    '/sessao',
  ] as const;
  for (const prefix of APP_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return 'app';
    }
  }
  // Public patient-facing routes: explicit classification prevents accidental
  // gating if the classifier is ever refactored to default-deny instead of
  // default-public. Same pattern as /confirmar-sessao and /termo — the token
  // in the URL is the authorization credential, not a Supabase session.
  if (pathname.startsWith('/escala/') || pathname === '/escala') {
    return 'public';
  }
  // Public patient video join page — token in URL is the auth credential, not a Supabase session
  if (pathname === '/v' || pathname.startsWith('/v/')) {
    return 'public';
  }
  // Public marketing + legal routes (the `(public)` route group). Explicit
  // classification prevents accidental gating if the classifier is ever
  // refactored to default-deny instead of default-public. These routes serve
  // anonymous and authenticated visitors alike: an active user on `/` or
  // `/precos` stays on the page (the `'public'` class never redirects), so
  // marketing pages are reachable from inside the app without bouncing to
  // /dashboard. The exact-match for `/` plus the exact-or-prefix+separator
  // check for the named routes rejects near-miss substrings like
  // `/precos-internos` -- see public-routes-gating.int.test.ts.
  if (pathname === '/') {
    return 'public';
  }
  for (const prefix of PUBLIC_MARKETING_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return 'public';
    }
  }
  return 'public';
}

/**
 * Edge-compatible check: does the Supabase `User` have a non-email OAuth
 * identity? Used to distinguish "OAuth user without profile" (directed to
 * complete-profile) from "email signup race window" (treated as anonymous).
 *
 * Checks `app_metadata.providers` (array of provider names stored by
 * GoTrue). If any entry is not `'email'`, the user signed up via OAuth.
 */
export function hasOAuthIdentity(authUser: User): boolean {
  const { providers } = authUser.app_metadata;
  if (Array.isArray(providers)) {
    return providers.some((p) => p !== 'email');
  }
  // Fallback: check the single `provider` field (older GoTrue versions)
  const { provider } = authUser.app_metadata;
  return provider !== undefined && provider !== 'email';
}

type Decision =
  | { kind: 'pass' }
  | { kind: 'redirect'; to: string; reason: string }
  // `clear-and-pass` and `clear-and-redirect` apply to suspended/cancelled
  // sessions: the middleware MUST clear the auth cookies before letting the
  // user proceed (otherwise the next request resolves the same status and
  // we ping-pong forever). The auth pages (`/login`, `/signup`) and other
  // public surfaces become the user's only landing zone once cleared.
  | { kind: 'clear-and-pass'; reason: string }
  | { kind: 'clear-and-redirect'; to: string; reason: string };

// Session context passed to `decide()`. Covers three states:
//   1. No session: `authUser` is null, `profile` is null.
//   2. Authenticated but no profile: `authUser` is non-null, `profile` is null
//      (either OAuth pending complete-profile, or email signup race window).
//   3. Authenticated with profile: both non-null.
interface SessionContext {
  readonly authUser: User | null;
  readonly profile: Profile | null;
}

// Decide what to do for the (path, session) pair. The `profile` field is
// `null` either when there is no session, when the trigger hasn't
// materialized the row yet (email signup race window), or when the user is
// an OAuth user who needs to complete their profile.
function decide(pathClass: PathClass, ctx: SessionContext, requestPath: string): Decision {
  // /auth/callback ALWAYS passes through, regardless of session state.
  if (pathClass === 'callback') {
    return { kind: 'pass' };
  }

  // When profile exists, skip directly to the status switch regardless of
  // whether `authUser` was populated (the middleware only fetches `authUser`
  // when profile is null, so `authUser` is always null here).
  if (ctx.profile) {
    return decideWithProfile(pathClass, ctx.profile);
  }

  // No profile. Two sub-cases:
  //   a) No session at all (authUser is null) -- "anonymous" column.
  //   b) Authenticated but no profile row -- depends on provider.
  if (!ctx.authUser) {
    // Truly anonymous -- no session cookie or expired session. The wizard
    // (`'onboarding-wizard'`) is gated like the `'app'` shell for anon users.
    if (
      pathClass === 'app' ||
      pathClass === 'onboarding-wizard' ||
      pathClass === 'onboarding' ||
      pathClass === 'complete-profile'
    ) {
      const target = `${LOGIN_PATH}?redirectTo=${encodeURIComponent(requestPath)}`;
      return { kind: 'redirect', to: target, reason: 'anon-on-gated' };
    }
    return { kind: 'pass' };
  }

  // Authenticated user but no profile row. Distinguish OAuth from email race.
  {
    if (hasOAuthIdentity(ctx.authUser)) {
      // OAuth user without profile -> direct to complete-profile form.
      // Three path classes pass: complete-profile itself, link-account
      // (OAuth intermediary), and public routes (cookie refresh only).
      if (
        pathClass === 'complete-profile' ||
        pathClass === 'link-account' ||
        pathClass === 'public'
      ) {
        return { kind: 'pass' };
      }
      return {
        kind: 'redirect',
        to: COMPLETE_PROFILE_PATH,
        reason: 'oauth-needs-complete-profile',
      };
    }
    // Email signup race window -- treat exactly like "no session".
    if (
      pathClass === 'app' ||
      pathClass === 'onboarding-wizard' ||
      pathClass === 'onboarding' ||
      pathClass === 'complete-profile'
    ) {
      const target = `${LOGIN_PATH}?redirectTo=${encodeURIComponent(requestPath)}`;
      return { kind: 'redirect', to: target, reason: 'anon-on-gated' };
    }
    return { kind: 'pass' };
  }
}

// Status-based decision when the profile row exists. Extracted from `decide()`
// so the control flow is linear: decide() handles the null-profile paths,
// then delegates here for the status switch.
function decideWithProfile(pathClass: PathClass, profile: Profile): Decision {
  switch (profile.status) {
    case ProfileStatus.PendingVerification:
    case ProfileStatus.PendingCrpValidation:
      // Pending users see only the onboarding page. /auth/callback was
      // handled above. Auth pages (login, signup) bounce to onboarding.
      // /forgot-password, /reset-password, and public paths pass through.
      if (
        pathClass === 'onboarding' ||
        pathClass === 'forgot-password' ||
        pathClass === 'reset-password' ||
        pathClass === 'public'
      ) {
        return { kind: 'pass' };
      }
      return { kind: 'redirect', to: ONBOARDING_PATH, reason: 'pending-needs-onboarding' };

    case ProfileStatus.Active:
      // Active users with `requires_password_reset` MUST reset their
      // password before accessing anything except the password-reset flow
      // itself and public routes.
      if (profile.requiresPasswordReset) {
        if (
          pathClass === 'forgot-password' ||
          pathClass === 'reset-password' ||
          pathClass === 'public'
        ) {
          return { kind: 'pass' };
        }
        return {
          kind: 'redirect',
          to: FORGOT_PASSWORD_PATH,
          reason: 'requires-password-reset',
        };
      }
      // Active users (no password reset needed) split by onboarding state.
      // `onboardingComplete` is true once the user finishes OR explicitly skips
      // the first-run wizard (step advances to 'done') OR the completion
      // timestamp is stamped. Either signal alone marks the soft gate as
      // satisfied.
      {
        const onboardingComplete =
          profile.onboardingStep === 'done' || profile.onboardingCompletedAt !== null;

        if (!onboardingComplete) {
          // Incomplete onboarding: keep the user inside the first-run wizard.
          // The wizard itself and the voluntary password-change flow pass; every
          // other authenticated/auth surface funnels into /onboarding/welcome.
          // `'onboarding-wizard'` MUST pass here -- otherwise the redirect below
          // would target a path that itself redirects, looping forever.
          if (pathClass === 'onboarding-wizard' || pathClass === 'reset-password') {
            return { kind: 'pass' };
          }
          if (
            pathClass === 'app' ||
            pathClass === 'onboarding' ||
            pathClass === 'auth' ||
            pathClass === 'complete-profile' ||
            pathClass === 'link-account'
          ) {
            return {
              kind: 'redirect',
              to: WELCOME_PATH,
              reason: 'active-onboarding-incomplete',
            };
          }
          // `forgot-password` + `public` (and any future class) pass: the user
          // may change their password voluntarily, and marketing/legal pages
          // stay reachable from inside the wizard.
          return { kind: 'pass' };
        }

        // Onboarding complete -- historical behavior. The app shell and
        // /reset-password pass; auth + onboarding (incl. the now-finished
        // wizard) bounce to the dashboard.
        if (pathClass === 'app' || pathClass === 'reset-password') return { kind: 'pass' };
        if (
          pathClass === 'onboarding-wizard' ||
          pathClass === 'auth' ||
          pathClass === 'onboarding' ||
          pathClass === 'forgot-password' ||
          pathClass === 'link-account' ||
          pathClass === 'complete-profile'
        ) {
          return { kind: 'redirect', to: DASHBOARD_PATH, reason: 'active-already-in' };
        }
        return { kind: 'pass' };
      }

    case ProfileStatus.Suspended:
    case ProfileStatus.Cancelled:
      // Suspended/cancelled accounts must NOT keep their session cookie. We
      // call signOut + clear cookies regardless of which path they hit.
      // For /login and /signup we let the request through (so the form is
      // visible after the cookie is gone); for /onboarding and /(app) we
      // redirect to /login. Public paths still pass -- clearing the cookie
      // there is harmless and keeps the contract uniform.
      if (pathClass === 'auth' || pathClass === 'public') {
        return { kind: 'clear-and-pass', reason: 'account-unavailable' };
      }
      return {
        kind: 'clear-and-redirect',
        to: LOGIN_PATH,
        reason: 'account-unavailable',
      };
  }
}

export async function middleware(request: NextRequest) {
  const { supabase, response } = createMiddlewareClient(request);

  // `getCurrentProfileEdge` calls `supabase.auth.getUser()` itself before
  // hitting the `profiles` table -- so we don't need to call it twice for
  // the common case (user has a profile). For the null-profile case, we
  // do a second `getUser()` call to check OAuth identity -- this is rare
  // enough that the extra round-trip is acceptable.
  const profile = await getCurrentProfileEdge(supabase);

  // When profile is null, we need the auth user to distinguish OAuth users
  // (-> complete-profile) from email signup race window (-> treat as anon).
  // When profile exists, we don't need the auth user for decisions.
  let authUser: User | null = null;
  if (!profile) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    authUser = user;
  }

  const { pathname, search } = request.nextUrl;
  const pathClass = classifyPath(pathname);
  const requestPath = pathname + (search ?? '');

  const decision = decide(pathClass, { authUser, profile }, requestPath);

  // Telemetry: minimal pino-shaped log line for debugging redirects in dev.
  // We log `status` as the resolved status string (or `anonymous`) so a
  // grep against the line is unambiguous; `decision` collapses to a few
  // human-readable strings so the cause-effect of a single request is
  // visible on one row. Per CLAUDE.md/LGPD policy, no PII (email, user id)
  // lands here.
  edgeLogger.debug(
    {
      path: pathname,
      status: profile?.status ?? (authUser ? 'oauth-no-profile' : 'anonymous'),
      decision: describeDecision(decision),
    },
    'mw-decision',
  );

  // Suspended/cancelled paths must clear the cookie. We call signOut on the
  // SSR client first (which writes Set-Cookie deletions onto `response` via
  // the cookie adapter), then either pass that response through or copy its
  // cookie deletions onto a redirect.
  if (decision.kind === 'clear-and-pass' || decision.kind === 'clear-and-redirect') {
    // Best-effort: a signOut failure (e.g. GoTrue 5xx) must not block the
    // user-facing flow -- the cookie clear below is the safety net that
    // breaks the loop even if the remote call never succeeds.
    try {
      await supabase.auth.signOut();
    } catch (err) {
      edgeLogger.warn(
        { event: 'mw_signout_failed', errorName: err instanceof Error ? err.name : 'unknown' },
        'middleware signOut threw -- continuing with explicit cookie clear',
      );
    }
    // Belt-and-suspenders: even if signOut succeeded and wrote deletions,
    // explicitly delete any remaining `sb-*` cookie. Edge runtime cookie
    // semantics differ subtly from Node, so we prefer the redundant write.
    clearSupabaseCookies(request, response);

    if (decision.kind === 'clear-and-pass') {
      return response;
    }

    const url = new URL(decision.to, request.nextUrl);
    return buildRedirect(url, response);
  }

  if (decision.kind === 'pass') {
    return withPathnameHeader(request, response, pathname);
  }

  // `request.nextUrl` (not `request.url`) is the user-facing URL with the
  // `Host` header preserved -- using `request.url` would produce
  // `0.0.0.0:3000` in dev (Next binds to all interfaces) and the wrong
  // hostname behind some proxies in prod.
  const url = new URL(decision.to, request.nextUrl);
  return buildRedirect(url, response);
}

// Re-emit the `pass` response with the resolved request pathname exposed as an
// `x-pathname` request header so downstream Server Components / layouts can read
// it via `next/headers` (Next.js does not expose the pathname to layouts by
// default). The path is the already-public request URL, so it carries no PII
// or secret. We rebuild the response from the incoming request with the cloned
// header set and copy over any Set-Cookie deletions/refreshes that the Supabase
// SSR client wrote onto the original response, so the session cookie refresh is
// preserved.
function withPathnameHeader(
  request: NextRequest,
  sourceResponse: NextResponse,
  pathname: string,
): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', pathname);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const cookie of sourceResponse.cookies.getAll()) {
    response.cookies.set(cookie);
  }
  return response;
}

// Construct a 307 redirect that inherits any Set-Cookie headers written by
// `createMiddlewareClient` during the session refresh. Using 307 (Temporary
// Redirect) is intentional and required by spec: it preserves the request
// method, so a POST that hits a gated route doesn't get silently demoted
// to GET on the redirect.
function buildRedirect(url: URL, sourceResponse: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(url, 307);
  for (const cookie of sourceResponse.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  return redirect;
}

// Delete all Supabase auth cookies (the `sb-*-auth-token*` family) on both
// the incoming request mirror and the outgoing response. The request mirror
// is what `@supabase/ssr` reads on the next pass; the response is what the
// browser stores. We delete by exact name (any present `sb-*` cookie) so
// we don't leak future cookie names -- the prefix match is conservative.
function clearSupabaseCookies(request: NextRequest, response: NextResponse): void {
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith('sb-')) {
      response.cookies.delete(cookie.name);
    }
  }
}

function describeDecision(decision: Decision): string {
  switch (decision.kind) {
    case 'pass':
      return 'pass';
    case 'clear-and-pass':
      return 'clear-and-pass';
    case 'redirect':
      return `redirect:${decision.to.split('?')[0] ?? decision.to}`;
    case 'clear-and-redirect':
      return `clear-and-redirect:${decision.to.split('?')[0] ?? decision.to}`;
  }
}

export const config = {
  matcher: [
    // Skip Next.js internals, static assets, and the favicon -- middleware
    // would otherwise add cookie-set overhead to every fetched chunk. The
    // negation pattern is the documented Next.js way to exclude path
    // prefixes; everything else (including `/auth/callback`) is matched.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
