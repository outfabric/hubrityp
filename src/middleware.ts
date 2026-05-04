import { NextResponse, type NextRequest } from 'next/server';

// IMPORTANT: import from the Edge-only barrel, NOT `@/modules/registration`.
// The canonical barrel transitively pulls Drizzle (`postgres-js` →
// `node:crypto`), which the Edge runtime does not expose — bundling it
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
// Decision table (path × profile.status — `null` represents "no session"):
//
//   Path requested              | null         | pending_*               | active     | suspended/cancelled
//   ----------------------------|--------------|-------------------------|------------|---------------------
//   /login, /signup             | pass         | →/onboarding/pending    | →/dashboard| →/login
//   /onboarding/pending         | →/login?...  | pass                    | →/dashboard| →/login
//   /dashboard*, other (app)    | →/login?...  | →/onboarding/pending    | pass       | →/login
//   /auth/callback              | pass         | pass                    | pass       | pass
//   /, /api/health, marketing   | pass (refresh)| pass                   | pass       | pass
//
// Why this lives in middleware (Edge), not in a layout (RSC):
//   • Cookie refresh MUST happen at the edge — the Server Components below
//     read the refreshed cookie via `createServerClient(await cookies())`.
//   • An RSC layout cannot redirect before the cookie write commits, which
//     would force a double round-trip on every navigation.
//
// Why Edge and not Node: the Next.js 16 `middleware.ts` file convention
// runs on the Edge runtime (the new `proxy.ts` convention is Node-default).
// Drizzle (`postgres-js`) doesn't run on Edge — that's why we use
// `getCurrentProfileEdge`, which goes through the Supabase REST surface
// authenticated by the user's JWT (RLS-scoped, single-row PK lookup).
//
// `null` profile semantics: an authenticated user whose `profiles` row
// hasn't been materialized yet (race window between `auth.signUp`
// returning and the SECURITY DEFINER trigger committing) is treated as
// anonymous for gating. The next request — after the trigger commits —
// applies the correct status row.
//
// Cookie-set transplant: `createMiddlewareClient` writes refreshed cookies
// onto its `response` object via the `@supabase/ssr` cookie adapter. When
// we replace that response with a redirect, we MUST copy those cookies onto
// the redirect — otherwise a token rotation that happened during
// `getUser()` would be silently dropped, and the redirect would arrive
// with a stale cookie.

// Auth surfaces — login + signup share the same redirect rules.
const AUTH_PATHS: ReadonlySet<string> = new Set(['/login', '/signup']);

// `/auth/callback` is the verification flow itself; gating it would deadlock
// users who clicked the email link before the trigger flipped their status.
// We classify it explicitly so a future refactor of the path patterns can't
// accidentally absorb it into a redirect rule.
const CALLBACK_PATH = '/auth/callback';

const ONBOARDING_PATH = '/onboarding/pending';
const DASHBOARD_PATH = '/dashboard';
const LOGIN_PATH = '/login';

type PathClass = 'auth' | 'callback' | 'onboarding' | 'app' | 'public';

// Pure path classifier. `(app)` paths are anything mounted under the
// authenticated shell — today that's `/dashboard*`, but the contract scales
// to any future `(app)` route except `/onboarding/pending` (which has its
// own row). Public paths fall through to the default `pass` branch.
function classifyPath(pathname: string): PathClass {
  if (pathname === CALLBACK_PATH || pathname.startsWith(`${CALLBACK_PATH}/`)) {
    return 'callback';
  }
  if (AUTH_PATHS.has(pathname)) {
    return 'auth';
  }
  if (pathname === ONBOARDING_PATH || pathname.startsWith(`${ONBOARDING_PATH}/`)) {
    return 'onboarding';
  }
  // `(app)` shell: today only `/dashboard*`. The strict prefix check (with
  // a separator or exact match) keeps `/some/dashboard-news` out of the
  // gated set — see the matcher-boundary regression test.
  if (pathname === DASHBOARD_PATH || pathname.startsWith(`${DASHBOARD_PATH}/`)) {
    return 'app';
  }
  return 'public';
}

type Decision = { kind: 'pass' } | { kind: 'redirect'; to: string; reason: string };

// Decide what to do for the (path, profile) pair. The `profile` argument is
// `null` either when there is no session or when the trigger hasn't
// materialized the row yet — both cases use the "no session" column per
// the spec.
function decide(pathClass: PathClass, profile: Profile | null, requestPath: string): Decision {
  // /auth/callback ALWAYS passes through, regardless of session state.
  if (pathClass === 'callback') {
    return { kind: 'pass' };
  }

  // No session (or session-without-profile) — apply the leftmost column.
  if (!profile) {
    if (pathClass === 'app' || pathClass === 'onboarding') {
      const target = `${LOGIN_PATH}?redirectTo=${encodeURIComponent(requestPath)}`;
      return { kind: 'redirect', to: target, reason: 'anon-on-gated' };
    }
    return { kind: 'pass' };
  }

  // From here on, profile is non-null — switch on status. We narrow on the
  // closed `ProfileStatus` union so a future status (e.g. `archived`)
  // forces a compile-time exhaustiveness error here.
  switch (profile.status) {
    case ProfileStatus.PendingVerification:
    case ProfileStatus.PendingCrpValidation:
      // Pending users see only the onboarding page. /auth/callback was
      // handled above. Auth pages (login, signup) bounce to onboarding.
      if (pathClass === 'onboarding') return { kind: 'pass' };
      return { kind: 'redirect', to: ONBOARDING_PATH, reason: 'pending-needs-onboarding' };

    case ProfileStatus.Active:
      // Active users see the app. Auth + onboarding bounce to dashboard.
      if (pathClass === 'app') return { kind: 'pass' };
      if (pathClass === 'auth' || pathClass === 'onboarding') {
        return { kind: 'redirect', to: DASHBOARD_PATH, reason: 'active-already-in' };
      }
      return { kind: 'pass' };

    case ProfileStatus.Suspended:
    case ProfileStatus.Cancelled:
      // Suspended/cancelled accounts can't enter ANY surface except public.
      // The next sign-in attempt will be refused by `signIn` with
      // `account_unavailable`, which clears the cookie and shows the
      // explanation copy — the redirect-loop risk is bounded by that.
      if (pathClass === 'public') return { kind: 'pass' };
      return { kind: 'redirect', to: LOGIN_PATH, reason: 'account-unavailable' };
  }
}

export async function middleware(request: NextRequest) {
  const { supabase, response } = createMiddlewareClient(request);

  // `getCurrentProfileEdge` calls `supabase.auth.getUser()` itself before
  // hitting the `profiles` table — so we don't need to call it twice. This
  // also means the cookie refresh side-effect (managed inside
  // `createMiddlewareClient` via the cookie adapter) still runs.
  const profile = await getCurrentProfileEdge(supabase);

  const { pathname, search } = request.nextUrl;
  const pathClass = classifyPath(pathname);
  const requestPath = pathname + (search ?? '');

  const decision = decide(pathClass, profile, requestPath);

  // Telemetry: minimal pino-shaped log line for debugging redirects in dev.
  // We log `status` as the resolved status string (or `anonymous`) so a
  // grep against the line is unambiguous; `decision` is either `pass` or
  // `redirect:<target>` so the cause-effect of a single request is visible
  // on one row. Per CLAUDE.md/LGPD policy, no PII (email, user id) lands
  // here.
  edgeLogger.debug(
    {
      path: pathname,
      status: profile?.status ?? 'anonymous',
      decision:
        decision.kind === 'pass' ? 'pass' : `redirect:${decision.to.split('?')[0] ?? decision.to}`,
    },
    'mw-decision',
  );

  if (decision.kind === 'pass') {
    return response;
  }

  const url = new URL(decision.to, request.url);
  return buildRedirect(url, response);
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

export const config = {
  matcher: [
    // Skip Next.js internals, static assets, and the favicon — middleware
    // would otherwise add cookie-set overhead to every fetched chunk. The
    // negation pattern is the documented Next.js way to exclude path
    // prefixes; everything else (including `/auth/callback`) is matched.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
