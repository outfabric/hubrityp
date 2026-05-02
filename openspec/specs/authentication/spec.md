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

The system SHALL implement a Server Action `signIn(formData)` that validates input via Zod, calls `supabase.auth.signInWithPassword`, and redirects to the dashboard on success.

#### Scenario: Valid credentials succeed and redirect

- **WHEN** the form is submitted with valid credentials and the call to Supabase succeeds
- **THEN** the action sets the session cookies via `@supabase/ssr` and redirects the browser to `/dashboard` (or to a same-origin `redirectTo` query param if provided)

#### Scenario: Invalid credentials surface a typed result

- **WHEN** the form is submitted with credentials Supabase rejects
- **THEN** the action returns `{ ok: false, error: 'invalid_credentials' }` and the page renders an error message

#### Scenario: Malformed input is rejected before calling Supabase

- **WHEN** the form is submitted with an invalid email format or a password shorter than 8 characters
- **THEN** the action returns `{ ok: false, error: 'invalid_credentials' }` without calling Supabase

#### Scenario: Action never throws across the boundary

- **WHEN** any unexpected error occurs during the call (network, Supabase 5xx)
- **THEN** the action returns `{ ok: false, error: 'unknown' }` and does not propagate the exception to the client

#### Scenario: `redirectTo` is validated before use

- **WHEN** the form is submitted with `redirectTo=https://evil.example.com` (or any non-same-origin value)
- **THEN** the action ignores the parameter and redirects to `/dashboard`

### Requirement: `signOut` Server Action clears the session and redirects

The system SHALL implement a Server Action `signOut()` that calls `supabase.auth.signOut` and redirects the browser to `/login`.

#### Scenario: Logout clears cookies

- **GIVEN** a request with a valid session cookie
- **WHEN** `signOut` is invoked via a `<form action={signOut}>` POST
- **THEN** the response clears the Supabase session cookies and redirects to `/login`

### Requirement: Middleware enforces auth gating for `(app)` routes

The system SHALL extend the root `middleware.ts` (introduced in wave 2) to redirect unauthenticated requests for any path under `/dashboard` to `/login?redirectTo=<originalPath>`. It SHALL also redirect authenticated requests for `/login` to `/dashboard`.

#### Scenario: Anonymous request to `/dashboard` is redirected

- **WHEN** an anonymous client requests `/dashboard`
- **THEN** the middleware returns HTTP 307 to `/login?redirectTo=%2Fdashboard`

#### Scenario: Anonymous request to `/dashboard/anything` is redirected and preserves the path

- **WHEN** an anonymous client requests `/dashboard/settings/profile`
- **THEN** the middleware returns HTTP 307 to `/login?redirectTo=%2Fdashboard%2Fsettings%2Fprofile`

#### Scenario: Authenticated request to `/login` is redirected

- **WHEN** a user with a valid session requests `/login`
- **THEN** the middleware returns HTTP 307 to `/dashboard`

#### Scenario: Public routes pass through unchanged

- **WHEN** an anonymous client requests `/`, `/api/health`, or any other route outside `/dashboard` and `/login`
- **THEN** the middleware refreshes the session cookie (per wave 2) but does not redirect

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
