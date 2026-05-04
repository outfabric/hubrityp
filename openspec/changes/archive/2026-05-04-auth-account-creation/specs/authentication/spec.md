## MODIFIED Requirements

### Requirement: `signIn` Server Action authenticates via Supabase and redirects

The system SHALL implement a Server Action `signIn(formData)` that validates input via Zod, calls `supabase.auth.signInWithPassword`, loads the active user's `profiles` row via `getCurrentProfile`, and redirects based on `profile.status`. Active profiles redirect to `/dashboard` (or to a same-origin `redirectTo` query param if provided); pending profiles redirect to `/onboarding/pending`; suspended or cancelled profiles return a typed error and the session cookie is cleared.

#### Scenario: Valid credentials and active profile redirect to dashboard

- **WHEN** the form is submitted with valid credentials, Supabase succeeds, and `profile.status = 'active'`
- **THEN** the action sets the session cookies via `@supabase/ssr` and redirects the browser to `/dashboard` (or to a same-origin `redirectTo` query param if provided)

#### Scenario: Valid credentials and pending profile redirect to onboarding

- **WHEN** the form is submitted with valid credentials, Supabase succeeds, and `profile.status` is `pending_verification` or `pending_crp_validation`
- **THEN** the action sets the session cookies and redirects the browser to `/onboarding/pending`, ignoring any `redirectTo` query param

#### Scenario: Valid credentials but suspended or cancelled profile clears the session

- **WHEN** the form is submitted with valid credentials, Supabase succeeds, and `profile.status` is `suspended` or `cancelled`
- **THEN** the action calls `supabase.auth.signOut`, returns `{ ok: false, error: 'account_unavailable' }`, and the page renders pt-BR copy explaining the account state

#### Scenario: Invalid credentials surface a typed result

- **WHEN** the form is submitted with credentials Supabase rejects
- **THEN** the action returns `{ ok: false, error: 'invalid_credentials' }` and the page renders an error message

#### Scenario: Malformed input is rejected before calling Supabase

- **WHEN** the form is submitted with an invalid email format or a password shorter than 8 characters
- **THEN** the action returns `{ ok: false, error: 'invalid_credentials' }` without calling Supabase

#### Scenario: Action never throws across the boundary

- **WHEN** any unexpected error occurs during the call (network, Supabase 5xx, profile lookup error)
- **THEN** the action returns `{ ok: false, error: 'unknown' }` and does not propagate the exception to the client

#### Scenario: `redirectTo` is validated before use

- **WHEN** the form is submitted with `redirectTo=https://evil.example.com` (or any non-same-origin value)
- **THEN** the action ignores the parameter and applies the status-based redirect (`/dashboard` for active, `/onboarding/pending` for pending)

### Requirement: Middleware enforces auth gating for `(app)` routes

The system SHALL extend the root `middleware.ts` so that gating is driven by both the presence of a Supabase session and the user's `profile.status`. The middleware MUST resolve the active profile via `getCurrentProfile` and apply the following decision table on every request inside the configured matcher:

| Path requested | No session | `pending_verification` | `pending_crp_validation` | `active` | `suspended` / `cancelled` |
|---|---|---|---|---|---|
| `/login`, `/signup` | pass | →`/onboarding/pending` | →`/onboarding/pending` | →`/dashboard` | →`/login` |
| `/onboarding/pending` | →`/login?redirectTo=…` | pass | pass | →`/dashboard` | →`/login` |
| `/dashboard*`, other `(app)` paths | →`/login?redirectTo=<path>` | →`/onboarding/pending` | →`/onboarding/pending` | pass | →`/login` |
| `/auth/callback` | pass | pass | pass | pass | pass |
| `/`, `/api/health`, public marketing | pass (cookie refresh) | pass | pass | pass | pass |

#### Scenario: Anonymous request to `/dashboard` is redirected to login with redirectTo

- **WHEN** an anonymous client requests `/dashboard`
- **THEN** the middleware returns HTTP 307 to `/login?redirectTo=%2Fdashboard`

#### Scenario: Anonymous request to a deep `(app)` path preserves the path

- **WHEN** an anonymous client requests `/dashboard/settings/profile`
- **THEN** the middleware returns HTTP 307 to `/login?redirectTo=%2Fdashboard%2Fsettings%2Fprofile`

#### Scenario: Active user request to `/login` redirects to dashboard

- **WHEN** a user with `profile.status = 'active'` requests `/login`
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

#### Scenario: `/auth/callback` always passes through

- **WHEN** any client requests `/auth/callback?code=…`
- **THEN** the middleware passes the request through to the route handler regardless of session state

#### Scenario: Public routes pass through with cookie refresh only

- **WHEN** an anonymous client requests `/`, `/api/health`, or any other route outside `/dashboard`, `/login`, `/signup`, and `/onboarding/pending`
- **THEN** the middleware refreshes the session cookie (per wave 2) but does not redirect

#### Scenario: Authenticated user without a profile row is treated as anonymous for gating

- **WHEN** a request arrives with a valid Supabase session but `getCurrentProfile` returns `null` (race window before the trigger commits)
- **THEN** the middleware applies the "no session" column of the decision table for that request (the next request, after the trigger commits, applies the correct status row)
