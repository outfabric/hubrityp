# authentication Specification

## Purpose
Define the public auth surface of the platform: the `/login` page, the `signIn`
and `signOut` Server Actions, the root middleware that gates authenticated
routes, and the shared validators (`loginInputSchema`, `mapSupabaseUser`) that
flow auth payloads between the form, the action, and the consuming pages.
Created by archiving change `smoke-health-feature`.
## Requirements
### Requirement: Login page is publicly reachable and renders the form

The system SHALL provide a `/login` route under the `(auth)` route group that renders an email + password form for unauthenticated users.

#### Scenario: Anonymous user can reach `/login`

- **WHEN** an anonymous client visits `/login`
- **THEN** the response is HTTP 200, the page renders an email input, a password input, and a submit button, and the page does not redirect

#### Scenario: Authenticated user is redirected away from `/login`

- **WHEN** a user with a valid session visits `/login`
- **THEN** the middleware redirects them to `/dashboard`

#### Scenario: Form fields use stable test ids

- **WHEN** the page is inspected
- **THEN** the email input exposes `data-testid="login-form-email"`, the password input exposes `data-testid="login-form-password"`, the submit button exposes `data-testid="login-form-submit"`, and any inline error region exposes `data-testid="login-form-error"`

### Requirement: `signIn` Server Action authenticates via Supabase and redirects

The system SHALL implement a Server Action `signIn(formData)` that validates input via Zod, enforces lockout state, calls `supabase.auth.signInWithPassword`, loads the active user's `profiles` row via `getCurrentProfile`, and redirects based on `profile.status`, `requires_password_reset`, and the `keepLoggedIn` flag. The action MUST keep the response shape uniform across the email-exists / email-does-not-exist axes (anti-enumeration) by performing constant-time work on the negative path.

When Supabase email confirmation is enabled and the account's email is not yet confirmed, `supabase.auth.signInWithPassword` returns the `email_not_confirmed` error (HTTP 422) — and GoTrue returns it ONLY after the password is validated, so a WRONG password on an unconfirmed account still returns `invalid_credentials` (and is handled by the failed-credentials path). On the `email_not_confirmed` outcome the action MUST treat the attempt as a legitimate (correct-password) login that is merely blocked on confirmation: it MUST NOT call `applyFailedLoginAttempt`, MUST NOT increment `failed_login_count`/`consecutive_lockouts`, MUST NOT set `requires_password_reset`, MUST set the signed `pending-email` cookie (see `public-email-confirmation` spec) so the confirmation page and resend work, and MUST return `{ ok: false, error: 'email_not_confirmed' }`.

The action MUST emit one of the following typed results when not redirecting:

- `{ ok: false, error: 'invalid_credentials' }`
- `{ ok: false, error: 'email_not_confirmed' }`
- `{ ok: false, error: 'locked_out', lockoutUntil: string }`
- `{ ok: false, error: 'requires_password_reset' }`
- `{ ok: false, error: 'account_unavailable' }`
- `{ ok: false, error: 'unknown' }`

The action MUST log `login_success` (with `metadata.keepLoggedIn`) or `login_failure` in `auth_logs` for every attempt, capturing `ip` and `userAgent` from the request headers. On the lockout transition (an UPDATE that newly sets `lockout_until`), the action MUST also log `lockout_started` and trigger a notification email to the user.

#### Scenario: Valid credentials and active profile redirect to dashboard

- **WHEN** the form is submitted with valid credentials, Supabase succeeds, `profile.status = 'active'`, `requires_password_reset = false`, and `lockout_until IS NULL OR lockout_until <= NOW()`
- **THEN** the action sets the session cookies via `@supabase/ssr`, applies the keep-logged-in cookie strategy (Requirement: "`signIn` honours the `keepLoggedIn` flag via cookie sidecar"), resets `failed_login_count` and `consecutive_lockouts` to 0 on `profiles`, logs `login_success`, and redirects the browser to `/dashboard` (or to a same-origin `redirectTo` query param if provided)

#### Scenario: Valid credentials and pending-CRP profile redirect to onboarding

- **WHEN** the form is submitted with valid credentials, Supabase succeeds, and `profile.status` is `pending_crp_validation`
- **THEN** the action sets the session cookies, resets the lockout counters as above, logs `login_success`, and redirects the browser to `/onboarding/pending`, ignoring any `redirectTo` query param

#### Scenario: Unconfirmed email returns `email_not_confirmed` without touching lockout

- **WHEN** the form is submitted with a CORRECT password for an account whose email is not yet confirmed, and Supabase returns `email_not_confirmed` (HTTP 422)
- **THEN** the action does NOT call `applyFailedLoginAttempt` and does NOT modify `failed_login_count`, `consecutive_lockouts`, `lockout_until`, or `requires_password_reset`; it sets the signed `pending-email` cookie; logs `login_failure` with `metadata.reason='email_not_confirmed'`; and returns `{ ok: false, error: 'email_not_confirmed' }`

#### Scenario: Wrong password on an unconfirmed account is still invalid_credentials

- **WHEN** the form is submitted with an INCORRECT password for an account whose email is not yet confirmed
- **THEN** Supabase returns `invalid_credentials` (not `email_not_confirmed`), the action follows the failed-credentials path (increments the lockout counter), and the response does not reveal that the account exists or is unconfirmed

#### Scenario: Valid credentials but suspended or cancelled profile clears the session

- **WHEN** the form is submitted with valid credentials, Supabase succeeds, and `profile.status` is `suspended` or `cancelled`
- **THEN** the action calls `supabase.auth.signOut({ scope: 'global' })`, returns `{ ok: false, error: 'account_unavailable' }`, logs `login_failure` with `metadata.reason='account_unavailable'`, and the page renders pt-BR copy explaining the account state

#### Scenario: Account flagged `requires_password_reset` blocks login

- **WHEN** the form is submitted with valid credentials but `profile.requires_password_reset = true`
- **THEN** the action calls `supabase.auth.signOut({ scope: 'global' })`, returns `{ ok: false, error: 'requires_password_reset' }`, logs `login_failure` with `metadata.reason='requires_password_reset'`, and the UI renders pt-BR copy with a strong link to `/forgot-password?email=<encoded>`

#### Scenario: Account currently in lockout window rejects the attempt

- **WHEN** the form is submitted for a user whose `profile.lockout_until > NOW()`
- **THEN** the action does NOT call `supabase.auth.signInWithPassword`, returns `{ ok: false, error: 'locked_out', lockoutUntil }`, logs `login_failure` with `metadata.reason='locked_out'`, and the UI renders pt-BR copy with the remaining time and a link to `/forgot-password`

#### Scenario: Failed credentials increment counter atomically

- **WHEN** the form is submitted with valid input but Supabase rejects the credentials with `invalid_credentials` and `profile` exists for that email
- **THEN** the action runs the atomic UPDATE on `profiles` that resets `failed_login_count` to 1 if the previous attempt was older than 15 minutes (otherwise increments by 1), updates `last_failed_login_at = NOW()`, and applies the lockout side-effects when the count reaches 5 (sets `lockout_until = NOW() + 30 minutes`, increments `consecutive_lockouts`, sets `requires_password_reset = true` if the post-increment `consecutive_lockouts >= 3`); the action returns `{ ok: false, error: 'invalid_credentials' }` (or `'locked_out'` if the same UPDATE just transitioned into lockout), and logs `login_failure` followed by `lockout_started` if applicable

#### Scenario: Failed credentials for non-existing email are anti-enumeration

- **WHEN** the form is submitted with credentials that Supabase rejects AND no `profiles` row matches the email
- **THEN** the action performs a dummy bcrypt-compare (or equivalent constant-time delay) so the response time is comparable to the existing-email path, logs `login_failure` with `userId=NULL` and `metadata.reason='no_account'`, and returns `{ ok: false, error: 'invalid_credentials' }`

#### Scenario: Lockout transition sends a notification email

- **WHEN** the atomic UPDATE in a failed-login path newly sets `lockout_until` (i.e., the user just hit the 5th failure in the window)
- **THEN** the action enqueues or sends a "Sua conta foi temporariamente bloqueada" notification email to the user (best-effort: failure to send must not propagate as `unknown` to the client)

#### Scenario: Malformed input is rejected before calling Supabase

- **WHEN** the form is submitted with an invalid email format or a password shorter than 8 characters (legacy minimum kept for backwards compatibility)
- **THEN** the action returns `{ ok: false, error: 'invalid_credentials' }` without calling Supabase or touching the lockout counters

#### Scenario: Action never throws across the boundary

- **WHEN** any unexpected error occurs during the call (network, Supabase 5xx, profile lookup error, lockout UPDATE error)
- **THEN** the action returns `{ ok: false, error: 'unknown' }` and does not propagate the exception to the client

#### Scenario: `redirectTo` is validated before use

- **WHEN** the form is submitted with `redirectTo=https://evil.example.com` (or any non-same-origin value)
- **THEN** the action ignores the parameter and applies the status-based redirect (`/dashboard` for active, `/onboarding/pending` for pending-CRP)

### Requirement: `signOut` Server Action clears the session and redirects

The system SHALL implement a Server Action `signOut()` that calls `supabase.auth.signOut({ scope: 'global' })` (revoking the refresh token on the Supabase Auth server and invalidating every active session for the user), updates `auth_sessions.revokedAt = NOW()` for every row matching the user, logs `logout` in `auth_logs`, clears the `hp_keep_logged_in` cookie, and redirects the browser to `/login`.

#### Scenario: Logout clears cookies and revokes refresh token globally

- **GIVEN** a request with a valid session cookie
- **WHEN** `signOut` is invoked via a `<form action={signOut}>` POST
- **THEN** the response clears the Supabase session cookies, calls `supabase.auth.signOut({ scope: 'global' })` so subsequent requests with the previously valid refresh token are rejected, UPDATEs all rows in `auth_sessions` for the user setting `revokedAt = NOW()`, clears the `hp_keep_logged_in` cookie, logs `logout` in `auth_logs`, and redirects to `/login`

#### Scenario: Concurrent device logout takes effect on next request

- **GIVEN** the same user has two browser tabs (or two devices) authenticated against the same refresh token chain
- **WHEN** the user clicks "Sair" on tab A and then makes any request from tab B
- **THEN** tab B's middleware sees the refresh token rejected by Supabase and redirects to `/login?redirectTo=…`

#### Scenario: Action never throws across the boundary

- **WHEN** any unexpected error occurs (network, Supabase 5xx)
- **THEN** the action still clears local cookies and redirects to `/login` (best-effort revocation; failure to reach Supabase must not strand the user logged in locally)

### Requirement: Middleware enforces auth gating for `(app)` routes

The system SHALL extend the root `middleware.ts` so that gating is driven by the Supabase session, the user's `profile.status`, the `profile.requires_password_reset` flag, and (for OAuth flows) the absence of `profiles` for an authenticated user. The middleware MUST resolve the active profile via `getCurrentProfile` and apply the following decision table on every request inside the configured matcher:

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

### Requirement: `loginInputSchema` validates the form payload

The system SHALL define `loginInputSchema` (Zod) that validates `email` (RFC-compliant string), `password` (minimum 8 characters; legacy minimum kept for backwards compatibility), and `keepLoggedIn` (boolean, defaults to `false`). The schema MUST be the single source of truth for both server and client validation in the login form.

#### Scenario: Schema accepts valid input with keepLoggedIn=true

- **WHEN** `loginInputSchema.safeParse({ email: 'a@b.co', password: '12345678', keepLoggedIn: true })` runs
- **THEN** the result has `success: true`

#### Scenario: Schema accepts valid input with default keepLoggedIn

- **WHEN** `loginInputSchema.safeParse({ email: 'a@b.co', password: '12345678' })` runs
- **THEN** the result has `success: true` and `data.keepLoggedIn === false`

#### Scenario: Schema rejects empty fields

- **WHEN** `loginInputSchema.safeParse({ email: '', password: '' })` runs
- **THEN** the result has `success: false` with errors on both fields

#### Scenario: Schema rejects short password

- **WHEN** `loginInputSchema.safeParse({ email: 'a@b.co', password: 'short' })` runs
- **THEN** the result has `success: false` with an error on the `password` field

#### Scenario: Schema rejects non-boolean keepLoggedIn

- **WHEN** `loginInputSchema.safeParse({ email: 'a@b.co', password: '12345678', keepLoggedIn: 'yes' })` runs
- **THEN** the result has `success: false` with an error on the `keepLoggedIn` field (after Zod's coercion attempt)

### Requirement: `mapSupabaseUser` adapts Supabase user to app shape

The system SHALL provide `mapSupabaseUser(user)` that returns `{ id: string; email: string }` for a valid Supabase user object and `null` for `null`/`undefined` input.

#### Scenario: Maps a populated user

- **WHEN** `mapSupabaseUser({ id: 'abc', email: 'a@b.co', other: 'fields' })` is called
- **THEN** the result is `{ id: 'abc', email: 'a@b.co' }` with no extra keys

#### Scenario: Returns null for null input

- **WHEN** `mapSupabaseUser(null)` is called
- **THEN** the result is `null`

### Requirement: Auth domain code lives under `src/modules/auth/`

The system SHALL place the auth module at `src/modules/auth/` with this internal layout:

- `src/modules/auth/components/login-form.tsx` — the `<LoginForm/>` Client Component
- `src/modules/auth/server/login.ts` — the `signInImpl(formData)` server function (real action body)
- `src/modules/auth/server/logout.ts` — the `signOutImpl()` server function (real action body)
- `src/modules/auth/lib/login-input-schema.ts` — `loginInputSchema` (Zod)
- `src/modules/auth/lib/map-supabase-user.ts` — `mapSupabaseUser`
- `src/modules/auth/lib/safe-redirect.ts` — `safeRedirect` (validates `redirectTo`)
- `src/modules/auth/index.ts` — public API: re-exports `LoginForm`, `signIn`, `signOut`, `loginInputSchema`, `mapSupabaseUser`

Route shells under `src/app/(auth)/login/` and `src/app/(app)/` MUST delegate to these module entries (see the route-shell scenarios below). The Supabase clients consumed by `server/login.ts` and `server/logout.ts` MUST come from `@/shared/supabase/server` (not from a module-local helper).

#### Scenario: Module exposes the documented public API

- **WHEN** any code outside `src/modules/auth/` needs `signIn`, `signOut`, `LoginForm`, `loginInputSchema`, or `mapSupabaseUser`
- **THEN** it imports from `@/modules/auth` (the module's `index.ts`); no consumer imports from `@/modules/auth/server/*` or `@/modules/auth/components/*` directly

#### Scenario: Route shell wires `signIn` to the module implementation

- **WHEN** a contributor reads `src/app/(auth)/login/actions.ts`
- **THEN** the file declares `'use server'` and exports `signIn` (and any login-page actions) as wrappers around `signInImpl` imported from `@/modules/auth` (the module barrel — see `code-organization`); the wrapper is at most one or two lines that pass `formData` through

#### Scenario: Route shell wires `signOut` similarly

- **WHEN** a contributor reads `src/app/(app)/actions.ts`
- **THEN** the file declares `'use server'` and exports `signOut` as a wrapper around `signOutImpl` imported from `@/modules/auth` (the module barrel — see `code-organization`)

#### Scenario: Login page imports `<LoginForm/>` from the module

- **WHEN** a contributor reads `src/app/(auth)/login/page.tsx`
- **THEN** the page is a Server Component that imports `<LoginForm/>` from `@/modules/auth` and composes the route layout; no UI markup beyond layout-level composition lives in `page.tsx`

### Requirement: `signIn` honours the `keepLoggedIn` flag via cookie sidecar

The system SHALL persist the user's "Manter conectado" preference as a cookie `hp_keep_logged_in` (`Secure`, `HttpOnly`, `SameSite=Lax`) set by the `signIn` Server Action immediately after a successful authentication. The cookie MUST have `Max-Age=86400` when `keepLoggedIn = true` and MUST be a session cookie (no `Max-Age`) when `keepLoggedIn = false`. The wrapper `createServerClient` in `src/shared/supabase/server.ts` MUST inspect this cookie when writing Supabase session cookies and apply the matching `Max-Age` (or omit it) so refresh-token cookies follow the same lifetime policy.

#### Scenario: `keepLoggedIn=true` produces 1-day cookies

- **WHEN** the form is submitted with `keepLoggedIn=true` and Supabase succeeds
- **THEN** the response sets `hp_keep_logged_in=1; Max-Age=86400; Secure; HttpOnly; SameSite=Lax` and the Supabase session/refresh cookies also receive `Max-Age=86400`

#### Scenario: `keepLoggedIn=false` produces session cookies

- **WHEN** the form is submitted with `keepLoggedIn=false` (or the field omitted) and Supabase succeeds
- **THEN** the response sets `hp_keep_logged_in=0` (or clears it) without `Max-Age` and the Supabase session/refresh cookies also have no `Max-Age`, so the browser drops them when closed

#### Scenario: Subsequent refresh respects the original choice

- **GIVEN** a user signed in with `keepLoggedIn=true` whose Supabase session is being refreshed mid-page-render
- **WHEN** `createServerClient` rotates the session cookie
- **THEN** the rotated cookie carries `Max-Age=86400` (the wrapper read `hp_keep_logged_in=1` from the request)

#### Scenario: Logout clears the keep-logged-in cookie

- **WHEN** `signOut` is invoked
- **THEN** the response sets `hp_keep_logged_in=` with `Max-Age=0` (deletion) regardless of the previous value

### Requirement: LoginForm exposes the keep-logged-in checkbox and Google button

The system SHALL render a "Manter conectado" checkbox and an "Entrar com Google" button inside `LoginForm`. The checkbox MUST control the `keepLoggedIn` field of `loginInputSchema`. The Google button MUST initiate the OAuth flow (handled by the `oauth-google` capability).

#### Scenario: Checkbox is rendered and persists into the action payload

- **WHEN** an unauthenticated user visits `/login`
- **THEN** the form contains a checkbox `data-testid="login-form-keep-logged-in"` with the label "Manter conectado", default unchecked

#### Scenario: Submitting with checkbox checked sends `keepLoggedIn=true`

- **WHEN** the user checks the box and submits the form
- **THEN** the Server Action receives `keepLoggedIn=true` and applies the long-lived cookie strategy

#### Scenario: Login form copies render the new error states

- **WHEN** the form receives a result `{ ok: false, error: 'locked_out', lockoutUntil }`
- **THEN** the inline error region (`data-testid="login-form-error"`) renders pt-BR copy "Conta temporariamente bloqueada por excesso de tentativas. Tente novamente em XX min ou redefina sua senha." with a link to `/forgot-password`

#### Scenario: Login form renders requires_password_reset copy with prefilled link

- **WHEN** the form receives `{ ok: false, error: 'requires_password_reset' }`
- **THEN** the inline error region renders pt-BR copy "Por segurança, redefina sua senha antes de entrar." with a link to `/forgot-password?email=<encoded>` so the next page is prefilled

### Requirement: Login page renders the confirm-email state with a path to resend

The system SHALL render, when `signIn` returns `{ ok: false, error: 'email_not_confirmed' }`, the shared confirm-email message (see `public-email-confirmation` spec: "Confirm-email copy is shared between the public page and the login page") together with a clear control to reach `/verifique-email` (where the user can resend the confirmation link). This state MUST be visually distinct from the generic `invalid_credentials` error (it is informational, not an error), MUST follow the Design System (info/neutral feedback styling, not `danger`), and MUST expose `data-testid="login-confirm-email"`. The login page MUST NOT reveal the unconfirmed state for any other result.

#### Scenario: Unconfirmed login shows the confirm-email guidance

- **WHEN** `signIn` returns `email_not_confirmed`
- **THEN** the login page renders the shared confirm-email copy in a non-danger feedback region (`data-testid="login-confirm-email"`) with a control linking to `/verifique-email`

#### Scenario: Invalid credentials still shows the generic error

- **WHEN** `signIn` returns `invalid_credentials`
- **THEN** the login page renders the existing generic error in `data-testid="login-form-error"` and does NOT render the `login-confirm-email` region (no account-existence disclosure)

