## MODIFIED Requirements

### Requirement: `signOut` Server Action clears the session and redirects

The system SHALL implement a Server Action `signOut()` that calls `supabase.auth.signOut({ scope: 'global' })` (revoking the refresh token on the Supabase Auth server and invalidating every active session for the user), explicitly deletes the `sb-*` Supabase session cookies on the response regardless of whether the remote `signOut` call succeeded, updates `auth_sessions.revokedAt = NOW()` for every row matching the user, logs `logout` in `auth_logs`, clears the `hp_keep_logged_in` cookie, and redirects the browser to `/login`. The explicit `sb-*` cookie deletion guarantees the browser cannot retain a revoked refresh token even when GoTrue is unreachable, preventing the dead-session loop.

#### Scenario: Logout clears cookies and revokes refresh token globally

- **GIVEN** a request with a valid session cookie
- **WHEN** `signOut` is invoked via a `<form action={signOut}>` POST
- **THEN** the response clears the Supabase session cookies (explicit `sb-*` deletion), calls `supabase.auth.signOut({ scope: 'global' })` so subsequent requests with the previously valid refresh token are rejected, UPDATEs all rows in `auth_sessions` for the user setting `revokedAt = NOW()`, clears the `hp_keep_logged_in` cookie, logs `logout` in `auth_logs`, and redirects to `/login`

#### Scenario: Concurrent device logout takes effect on next request

- **GIVEN** the same user has two browser tabs (or two devices) authenticated against the same refresh token chain
- **WHEN** the user clicks "Sair" on tab A and then makes any request from tab B
- **THEN** tab B's middleware sees the refresh token rejected by Supabase, deletes the `sb-*` cookies, and redirects to `/login?redirectTo=…` (no loop)

#### Scenario: Action never throws across the boundary

- **WHEN** any unexpected error occurs (network, Supabase 5xx)
- **THEN** the action still explicitly deletes the `sb-*` cookies and redirects to `/login` (best-effort revocation; failure to reach Supabase must not strand the user logged in locally nor leave a dead refresh token in the browser)

### Requirement: Middleware enforces auth gating for `(app)` routes

The system SHALL extend the root `middleware.ts` so that gating is driven by the Supabase session, the user's `profile.status`, the `profile.requires_password_reset` flag, and (for OAuth flows) the absence of `profiles` for an authenticated user. The middleware MUST resolve the active profile via `getCurrentProfile` and apply the following decision table on every request inside the configured matcher.

Additionally, when the per-request session resolution fails because the refresh token is missing or revoked (`refresh_token_not_found` / "Invalid Refresh Token"), the middleware MUST treat the request as the **No session** column AND delete the `sb-*` cookies on the response (clear-and-pass on public paths, clear-and-redirect to `/login?redirectTo=…` on gated paths), so the browser does not re-send the dead token on the next navigation. This invalid-refresh-token clearing MUST NOT trigger on transient network/5xx errors.

| Path requested | No session | Authenticated, no profile (OAuth pending complete-profile) | `pending_verification` | `pending_crp_validation` | `active` (and `requires_password_reset = false`) | `active` and `requires_password_reset = true` | `suspended` / `cancelled` |
|---|---|---|---|---|---|---|---|
| `/login`, `/signup` | pass | →`/onboarding/complete-profile` | →`/onboarding/pending` | →`/onboarding/pending` | →`/dashboard` | →`/forgot-password` | →`/login` |
| `/forgot-password` | pass | →`/onboarding/complete-profile` | pass | pass | →`/dashboard` | pass | →`/login` |
| `/reset-password` | pass | →`/onboarding/complete-profile` | pass | pass | pass | pass | →`/login` |
| `/auth/link-account` | pass | pass | →`/onboarding/pending` | →`/onboarding/pending` | →`/dashboard` | →`/forgot-password` | →`/login` |
| `/onboarding/complete-profile` | →`/login?redirectTo=…` | pass | →`/onboarding/pending` | →`/onboarding/pending` | →`/dashboard` | →`/forgot-password` | →`/login` |
| `/onboarding/pending` | →`/login?redirectTo=…` | →`/onboarding/complete-profile` | pass | pass | →`/dashboard` | →`/forgot-password` | →`/login` |
| `/dashboard*`, other `(app)` paths | →`/login?redirectTo=<path>` | →`/onboarding/complete-profile` | →`/onboarding/pending` | →`/onboarding/pending` | pass | →`/forgot-password` | →`/login` |
| `/auth/callback` | pass | pass | pass | pass | pass | pass | pass |
| `/`, `/api/health`, public marketing | pass (cookie refresh) | pass | pass | pass | pass | pass | pass |

#### Scenario: Anonymous request to `/dashboard` is redirected to login with redirectTo

- **WHEN** an anonymous client requests `/dashboard`
- **THEN** the middleware returns HTTP 307 to `/login?redirectTo=%2Fdashboard`

#### Scenario: Anonymous request to a deep `(app)` path preserves the path

- **WHEN** an anonymous client requests `/dashboard/settings/profile`
- **THEN** the middleware returns HTTP 307 to `/login?redirectTo=%2Fdashboard%2Fsettings%2Fprofile`

#### Scenario: Active user request to `/login` redirects to dashboard

- **WHEN** a user with `profile.status = 'active'` and `requires_password_reset = false` requests `/login`
- **THEN** the middleware returns HTTP 307 to `/dashboard`

#### Scenario: Pending user request to `/login` redirects to onboarding

- **WHEN** a user with `profile.status` in (`pending_verification`, `pending_crp_validation`) requests `/login` or `/signup`
- **THEN** the middleware returns HTTP 307 to `/onboarding/pending`

#### Scenario: Pending user request to `/dashboard` redirects to onboarding

- **WHEN** a user with `profile.status` in (`pending_verification`, `pending_crp_validation`) requests `/dashboard` or any other `(app)` path except `/onboarding/pending`
- **THEN** the middleware returns HTTP 307 to `/onboarding/pending`

#### Scenario: Suspended or cancelled user is sent back to login

- **WHEN** a user with `profile.status` in (`suspended`, `cancelled`) requests any path
- **THEN** the middleware returns HTTP 307 to `/login` (the `signIn` action will refuse the next attempt with `account_unavailable`)

#### Scenario: User flagged `requires_password_reset` is forced through forgot-password

- **WHEN** a user with `profile.status = 'active'` and `requires_password_reset = true` requests `/dashboard` or any other authenticated path except `/forgot-password` and `/reset-password`
- **THEN** the middleware returns HTTP 307 to `/forgot-password`

#### Scenario: OAuth user without profile is forced through complete-profile

- **WHEN** a request arrives with a valid Supabase session but `getCurrentProfile` returns `null` and the user has at least one OAuth identity (i.e., not the race window of email signup before trigger commits)
- **THEN** the middleware returns HTTP 307 to `/onboarding/complete-profile`

#### Scenario: `/auth/callback` always passes through

- **WHEN** any client requests `/auth/callback?code=…`
- **THEN** the middleware passes the request through to the route handler regardless of session state

#### Scenario: Public routes pass through with cookie refresh only

- **WHEN** an anonymous client requests `/`, `/api/health`, or any other public route
- **THEN** the middleware refreshes the session cookie (per wave 2) but does not redirect

#### Scenario: Invalid refresh token on a gated path clears cookies and redirects

- **WHEN** a request to a gated `(app)` path carries a revoked refresh token (GoTrue returns `refresh_token_not_found`)
- **THEN** the middleware treats it as the No-session column, deletes the `sb-*` cookies on the response, and returns HTTP 307 to `/login?redirectTo=<path>` — without re-attempting the refresh
