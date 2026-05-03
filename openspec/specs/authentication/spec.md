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

The system SHALL implement a Server Action `signIn(formData)` that validates input via Zod, calls `supabase.auth.signInWithPassword`, and redirects the user according to their account status: `active` users go to `/dashboard` (or to a same-origin `redirectTo` query param if provided), `pending_verification` users go to `/auth/verify-email`, `pending_crp_validation` users go to `/auth/crp-review`, `suspended` users are signed out and shown `/login?reason=suspended`, and `cancelled` users are signed out and shown `/login?reason=cancelled`.

#### Scenario: Active user is redirected to dashboard

- **WHEN** the form is submitted with valid credentials for a user with `status='active'`
- **THEN** the action sets the session cookies and redirects to `/dashboard` (or to a same-origin `redirectTo` if provided)

#### Scenario: Pending-verification user is redirected to the email page

- **WHEN** the form is submitted with valid credentials for a user with `status='pending_verification'`
- **THEN** the action sets the session cookies and redirects to `/auth/verify-email`, even if `redirectTo` was supplied (the bloqueante page wins until the user is `active`)

#### Scenario: Pending-CRP user is redirected to the CRP review page

- **WHEN** the form is submitted with valid credentials for a user with `status='pending_crp_validation'`
- **THEN** the action sets the session cookies and redirects to `/auth/crp-review`, even if `redirectTo` was supplied

#### Scenario: Suspended user is signed out at login

- **WHEN** the form is submitted with valid credentials for a user with `status='suspended'`
- **THEN** the action calls `supabase.auth.signOut`, clears the cookies, and redirects to `/login?reason=suspended`

#### Scenario: Cancelled user is signed out at login

- **WHEN** the form is submitted with valid credentials for a user with `status='cancelled'`
- **THEN** the action calls `supabase.auth.signOut`, clears the cookies, and redirects to `/login?reason=cancelled`

#### Scenario: Invalid credentials surface a typed result

- **WHEN** the form is submitted with credentials Supabase rejects
- **THEN** the action returns `{ ok: false, error: 'invalid_credentials' }` and the page renders an error message

#### Scenario: Malformed input is rejected before calling Supabase

- **WHEN** the form is submitted with an invalid email format or a password shorter than 8 characters
- **THEN** the action returns `{ ok: false, error: 'invalid_credentials' }` without calling Supabase

#### Scenario: Action never throws across the boundary

- **WHEN** any unexpected error occurs during the call (network, Supabase 5xx, missing profile row)
- **THEN** the action returns `{ ok: false, error: 'unknown' }` and does not propagate the exception to the client

#### Scenario: `redirectTo` is validated before use

- **WHEN** the form is submitted with `redirectTo=https://evil.example.com` (or any non-same-origin value)
- **THEN** the action ignores the parameter and applies the status-based redirect (defaulting to `/dashboard` for `active` users)

### Requirement: `signOut` Server Action clears the session and redirects

The system SHALL implement a Server Action `signOut()` that calls `supabase.auth.signOut` and redirects the browser to `/login`.

#### Scenario: Logout clears cookies

- **GIVEN** a request with a valid session cookie
- **WHEN** `signOut` is invoked via a `<form action={signOut}>` POST
- **THEN** the response clears the Supabase session cookies and redirects to `/login`

### Requirement: Middleware enforces auth gating for `(app)` routes

The system SHALL extend the root `middleware.ts` to redirect unauthenticated requests for any path under `/dashboard` to `/login?redirectTo=<originalPath>`. For authenticated requests it MUST consult `getAccountStatus(userId)` (from `@/modules/account-lifecycle`) and route by status: `active` passes through, `pending_verification` redirects to `/auth/verify-email`, `pending_crp_validation` redirects to `/auth/crp-review`, `suspended` and `cancelled` clear the session cookies and redirect to `/login?reason=<status>`. It MUST also redirect authenticated requests for `/login` and `/signup` according to the same status-based map (active → `/dashboard`, pending → corresponding bloqueante page).

#### Scenario: Anonymous request to `/dashboard` is redirected

- **WHEN** an anonymous client requests `/dashboard`
- **THEN** the middleware returns HTTP 307 to `/login?redirectTo=%2Fdashboard`

#### Scenario: Anonymous request to `/dashboard/anything` is redirected and preserves the path

- **WHEN** an anonymous client requests `/dashboard/settings/profile`
- **THEN** the middleware returns HTTP 307 to `/login?redirectTo=%2Fdashboard%2Fsettings%2Fprofile`

#### Scenario: Authenticated active request to `/login` is redirected to dashboard

- **WHEN** a user with a valid session and `status='active'` requests `/login`
- **THEN** the middleware returns HTTP 307 to `/dashboard`

#### Scenario: Authenticated pending-verification request to `/login` is redirected to verify-email page

- **WHEN** a user with a valid session and `status='pending_verification'` requests `/login`
- **THEN** the middleware returns HTTP 307 to `/auth/verify-email`

#### Scenario: Authenticated pending-CRP request to `/dashboard` is redirected to CRP review

- **WHEN** a user with a valid session and `status='pending_crp_validation'` requests `/dashboard`
- **THEN** the middleware returns HTTP 307 to `/auth/crp-review`

#### Scenario: Authenticated suspended request is signed out

- **WHEN** a user with a valid session and `status='suspended'` requests any `(app)/*` route
- **THEN** the middleware clears the Supabase session cookies and returns HTTP 307 to `/login?reason=suspended`

#### Scenario: Public routes pass through unchanged

- **WHEN** an anonymous client requests `/`, `/api/health`, or any other route outside `/dashboard`, `/login`, `/signup`, `/auth/*`
- **THEN** the middleware refreshes the session cookie but does not redirect

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
- `src/modules/auth/components/signup-form.tsx` — the `<SignupForm/>` Client Component
- `src/modules/auth/server/login.ts` — the `signInImpl(formData)` server function
- `src/modules/auth/server/logout.ts` — the `signOutImpl()` server function
- `src/modules/auth/server/signup.ts` — the `signUpImpl(formData)` server function
- `src/modules/auth/lib/login-input-schema.ts` — `loginInputSchema` (Zod)
- `src/modules/auth/lib/signup-input-schema.ts` — `signupInputSchema` (Zod)
- `src/modules/auth/lib/map-supabase-user.ts` — `mapSupabaseUser`
- `src/modules/auth/lib/safe-redirect.ts` — `safeRedirect` (validates `redirectTo`)
- `src/modules/auth/lib/post-login-redirect.ts` — `postLoginRedirect(status, requestedRedirect)` returning the status-aware redirect target
- `src/modules/auth/index.ts` — public API: re-exports `LoginForm`, `SignupForm`, `signIn`, `signOut`, `signUp`, `loginInputSchema`, `signupInputSchema`, `mapSupabaseUser`, `safeRedirect`, `postLoginRedirect`

Route shells under `src/app/(auth)/login/`, `src/app/(auth)/signup/`, and `src/app/(app)/` MUST delegate to these module entries. The Supabase clients consumed by the server functions MUST come from `@/shared/supabase/server` (not from a module-local helper).

#### Scenario: Module exposes the documented public API

- **WHEN** any code outside `src/modules/auth/` needs `signIn`, `signOut`, `signUp`, `LoginForm`, `SignupForm`, `loginInputSchema`, `signupInputSchema`, `mapSupabaseUser`, or `postLoginRedirect`
- **THEN** it imports from `@/modules/auth`; no consumer imports from `@/modules/auth/server/*` or `@/modules/auth/components/*` directly

#### Scenario: Route shell wires `signIn` to the module implementation

- **WHEN** a contributor reads `src/app/(auth)/login/actions.ts`
- **THEN** the file declares `'use server'` and exports `signIn` as a wrapper around `signInImpl` imported from `@/modules/auth`; the wrapper is at most one or two lines that pass `formData` through

#### Scenario: Route shell wires `signUp` to the module implementation

- **WHEN** a contributor reads `src/app/(auth)/signup/actions.ts`
- **THEN** the file declares `'use server'` and exports `signUp` as a wrapper around `signUpImpl` imported from `@/modules/auth`

#### Scenario: Route shell wires `signOut` similarly

- **WHEN** a contributor reads `src/app/(app)/actions.ts`
- **THEN** the file declares `'use server'` and exports `signOut` as a wrapper around `signOutImpl` imported from `@/modules/auth`

#### Scenario: Login page imports `<LoginForm/>` from the module

- **WHEN** a contributor reads `src/app/(auth)/login/page.tsx`
- **THEN** the page is a Server Component that imports `<LoginForm/>` from `@/modules/auth`

#### Scenario: Signup page imports `<SignupForm/>` from the module

- **WHEN** a contributor reads `src/app/(auth)/signup/page.tsx`
- **THEN** the page is a Server Component that imports `<SignupForm/>` from `@/modules/auth`

### Requirement: Signup page is publicly reachable and renders the cadastro form

The system SHALL provide a `/signup` route under the `(auth)` route group that renders the full PRD 01 cadastro form to unauthenticated users. The form MUST include fields for full name, email, password, password confirmation, CRP number, CRP UF (dropdown of 27 UFs), and three independent consent checkboxes (Termos de Uso, Política de Privacidade, Tratamento de Dados Sensíveis). All fields and checkboxes are required.

#### Scenario: Anonymous user can reach `/signup`

- **WHEN** an anonymous client visits `/signup`
- **THEN** the response is HTTP 200, the page renders all cadastro fields and the three consent checkboxes, and the page does not redirect

#### Scenario: Authenticated user is redirected away from `/signup`

- **WHEN** a user with a valid session visits `/signup`
- **THEN** the middleware redirects them to `/dashboard` (which the account-lifecycle middleware then routes by status)

#### Scenario: Form fields use stable test ids

- **WHEN** the page is inspected
- **THEN** every input exposes a `data-testid` of the form `signup-form-<field>`, where `<field>` is one of `full-name`, `email`, `password`, `password-confirm`, `crp-number`, `crp-uf`, `terms`, `privacy`, `sensitive-data`, `submit`, `error`

### Requirement: `signupInputSchema` validates the cadastro payload

The system SHALL define `signupInputSchema` (Zod) that validates the full PRD 01 §5.1 cadastro payload:

- `fullName`: string, 3–120 characters, trimmed
- `email`: RFC-compliant email, lower-cased before persistence
- `password`: string, minimum 10 characters, MUST contain at least one upper-case letter, one lower-case letter, one digit, and one special character from ``!@#$%^&*()_+-=[]{}|;:,.<>?`` (RF-01.04)
- `passwordConfirm`: string, MUST equal `password` (refinement at the schema level)
- `crpNumber`: validated via `crpNumberSchema` from `@/modules/crp-validation`
- `crpUf`: validated via `crpUfSchema` from `@/modules/crp-validation`
- `acceptedTerms`: literal `true`
- `acceptedPrivacy`: literal `true`
- `acceptedSensitiveData`: literal `true`

The schema is the single source of truth for both the React Hook Form resolver on the client and the Server Action on the server.

#### Scenario: Schema accepts a valid payload

- **WHEN** `signupInputSchema.safeParse({ fullName: 'Ana Silva', email: 'ana@example.com', password: 'Senha!Forte9', passwordConfirm: 'Senha!Forte9', crpNumber: '06/123456', crpUf: 'SP', acceptedTerms: true, acceptedPrivacy: true, acceptedSensitiveData: true })` runs
- **THEN** the result is `{ success: true }`

#### Scenario: Password without an upper-case letter is rejected

- **WHEN** the password is `'senha!forte9'` (no upper-case)
- **THEN** the schema returns a field error on `password` with a message that explicitly mentions the missing upper-case requirement

#### Scenario: Password shorter than 10 characters is rejected

- **WHEN** the password is `'Senha!9'` (7 characters)
- **THEN** the schema returns a field error on `password` mentioning the 10-character minimum

#### Scenario: Password confirmation mismatch is rejected

- **WHEN** `password='Senha!Forte9'` and `passwordConfirm='Senha!Forte0'`
- **THEN** the schema returns a field error on `passwordConfirm`

#### Scenario: Unchecked consent is rejected

- **WHEN** `acceptedSensitiveData=false`
- **THEN** the schema returns a field error on `acceptedSensitiveData`

#### Scenario: Invalid CRP format is rejected

- **WHEN** `crpNumber='abc'`
- **THEN** the schema returns a field error on `crpNumber` (delegating to `crpNumberSchema`)

### Requirement: `signUp` Server Action creates the user, profile, and queue row in a single transaction

The system SHALL implement a Server Action `signUp(formData)` that:

1. Validates `formData` against `signupInputSchema`. On failure returns `{ ok: false, error: 'validation_failed', fieldErrors }`.
2. Calls Supabase Auth `admin.createUser` (or `signUp`) to create the credential and trigger the verification email.
3. Inserts a `psychologist_profiles` row with the validated fields, `status='pending_verification'`, all three consent timestamps set to `NOW()`, and the corresponding `_version` strings from `documentVersions`.
4. Inserts a `crp_validation_queue` row with `status='pending'`.
5. Steps 2–4 MUST execute in the same DB transaction; any failure rolls all of them back including the Supabase user creation (compensating delete).
6. On success returns `{ ok: true, redirectTo: '/auth/verify-email' }` and the route shell redirects the browser there.

The action MUST NOT throw across the boundary. Unexpected errors return `{ ok: false, error: 'unknown' }`.

#### Scenario: Valid signup creates user, profile, and queue row

- **WHEN** the form is submitted with a valid payload
- **THEN** a Supabase Auth user exists, a `psychologist_profiles` row exists with `status='pending_verification'`, a `crp_validation_queue` row exists with `status='pending'`, and the action redirects to `/auth/verify-email`

#### Scenario: Duplicate email surfaces a typed error

- **GIVEN** a Supabase Auth user already exists with email `existing@example.com`
- **WHEN** the form is submitted with that email
- **THEN** the action returns `{ ok: false, error: 'email_already_registered' }` (PRD §8 explicitly chooses usability over enumeration prevention here) and no new rows are inserted

#### Scenario: Duplicate CRP/UF surfaces a typed error and rolls back the Supabase user

- **GIVEN** a `psychologist_profiles` row with `crp_number='06/123456', crp_uf='SP'`
- **WHEN** the form is submitted with the same `crp_number` and `crp_uf` and a fresh email
- **THEN** the action returns `{ ok: false, error: 'crp_already_registered' }`, no profile row is inserted, no queue row is inserted, and the freshly-created Supabase user is deleted (compensating action) so the email can be retried

#### Scenario: Malformed input is rejected before any side effects

- **WHEN** the form is submitted with a password missing the special-character class
- **THEN** the action returns `{ ok: false, error: 'validation_failed', fieldErrors: { password: <message> } }` without calling Supabase or touching the DB

#### Scenario: Action never throws across the boundary

- **WHEN** any unexpected error occurs (Supabase 5xx, network, DB error)
- **THEN** the action returns `{ ok: false, error: 'unknown' }`, the partial Supabase user (if any) is rolled back, and no exception propagates to the client

### Requirement: Signup form Client Component is wired through a route shell

The system SHALL place the signup form as `<SignupForm/>` in `src/modules/auth/components/signup-form.tsx` (Client Component) and the `signUpImpl` server function in `src/modules/auth/server/signup.ts` (regular module — no top-level `'use server'`). The route shell at `src/app/(auth)/signup/actions.ts` MUST be the Server Action surface that the Client Component imports — exactly mirroring the existing login shell pattern.

#### Scenario: Module exposes the signup surface via the barrel

- **WHEN** any server-side code outside `src/modules/auth/` needs the signup primitives
- **THEN** it imports `signUp`, `signupInputSchema`, `SignupForm`, and `SignUpResult` from `@/modules/auth`

#### Scenario: Client Component imports the action from the route shell

- **WHEN** `src/modules/auth/components/signup-form.tsx` is read
- **THEN** it imports `signUp` from `@/app/(auth)/signup/actions`, NOT from `@/modules/auth`, so the `'server-only'` chain (logger, supabase server client) does not leak into the browser bundle

### Requirement: `resendVerificationEmail` Server Action re-issues the verification mail

The system SHALL expose `resendVerificationEmail()` as a Server Action that:

- Authenticates the caller from the session.
- Refuses if the caller's status is not `pending_verification`.
- Refuses if more than 3 resend requests have been issued within the last 5 minutes for this user.
- Otherwise calls Supabase Auth's resend endpoint and returns `{ ok: true }`.

#### Scenario: Active user is refused

- **GIVEN** an authenticated user with `status='active'`
- **WHEN** they invoke `resendVerificationEmail`
- **THEN** the action returns `{ ok: false, error: 'forbidden' }`

#### Scenario: Pending user can resend within rate limits

- **GIVEN** an authenticated user with `status='pending_verification'` and 1 resend in the last 5 minutes
- **WHEN** they invoke `resendVerificationEmail`
- **THEN** the action returns `{ ok: true }` and Supabase Auth re-issues the email

#### Scenario: Rate limit blocks excess requests

- **GIVEN** an authenticated user with `status='pending_verification'` and 3 resends in the last 5 minutes
- **WHEN** they invoke `resendVerificationEmail` again
- **THEN** the action returns `{ ok: false, error: 'rate_limited' }` and no email is sent
