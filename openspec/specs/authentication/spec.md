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

### Requirement: `signOut` Server Action clears the session and redirects

The system SHALL implement a Server Action `signOut()` that calls `supabase.auth.signOut` and redirects the browser to `/login`.

#### Scenario: Logout clears cookies

- **GIVEN** a request with a valid session cookie
- **WHEN** `signOut` is invoked via a `<form action={signOut}>` POST
- **THEN** the response clears the Supabase session cookies and redirects to `/login`

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

### Requirement: `loginInputSchema` validates the form payload

The system SHALL define `loginInputSchema` (Zod) that validates `email` (RFC-compliant string) and `password` (minimum 8 characters). The schema MUST be the single source of truth for both server and client validation in the login form.

#### Scenario: Schema accepts valid input

- **WHEN** `loginInputSchema.safeParse({ email: 'a@b.co', password: '12345678' })` runs
- **THEN** the result has `success: true`

#### Scenario: Schema rejects empty fields

- **WHEN** `loginInputSchema.safeParse({ email: '', password: '' })` runs
- **THEN** the result has `success: false` with errors on both fields

#### Scenario: Schema rejects short password

- **WHEN** `loginInputSchema.safeParse({ email: 'a@b.co', password: 'short' })` runs
- **THEN** the result has `success: false` with an error on the `password` field

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

