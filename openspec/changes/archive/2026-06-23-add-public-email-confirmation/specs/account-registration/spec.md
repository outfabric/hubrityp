## MODIFIED Requirements

### Requirement: Signup page is publicly reachable and renders the registration form

The system SHALL provide a `/signup` route under the `(auth)` route group that renders the full professional registration form for unauthenticated users. The page MUST be a Server Component that composes a `'use client'` form leaf, follow the design system tokens, and never render for users with an active session (the middleware redirects them).

#### Scenario: Anonymous user can reach `/signup`

- **WHEN** an anonymous client visits `/signup`
- **THEN** the response is HTTP 200 and the page renders inputs for full name, email, password, password confirmation, CRP number, CRP UF, and three required consent checkboxes (Terms, Privacy, Sensitive Data Treatment)

#### Scenario: Authenticated active user is redirected away from `/signup`

- **WHEN** a user whose `profile.status = 'active'` visits `/signup`
- **THEN** the middleware redirects them to `/dashboard`

#### Scenario: Authenticated pending user is redirected to onboarding

- **WHEN** a user whose `profile.status` is `pending_crp_validation` visits `/signup`
- **THEN** the middleware redirects them to `/onboarding/pending`

#### Scenario: Form fields use stable test ids

- **WHEN** the page is inspected
- **THEN** the inputs expose `data-testid="signup-form-name"`, `signup-form-email`, `signup-form-password`, `signup-form-password-confirm`, `signup-form-crp-number`, `signup-form-crp-uf`, the consent checkboxes expose `signup-form-terms`, `signup-form-privacy`, `signup-form-sensitive-data`, the submit button exposes `signup-form-submit`, and any inline error region exposes `signup-form-error`

### Requirement: `signUp` Server Action creates account and dispatches verification email

The system SHALL implement a Server Action `signUp(formData)` exposed at `app/(auth)/signup/actions.ts` (`'use server'` shell delegating to `@/modules/registration`). The action MUST validate input via `signupInputSchema`, call `supabase.auth.signUp` with the verified payload, and rely on the database trigger (Requirement: "Database trigger creates `profiles` row on `auth.users` insert" in `data-layer`) to materialize `profiles` with `status = 'pending_verification'`. Because Supabase email confirmation is enabled, `supabase.auth.signUp` returns NO session; the just-registered client is therefore anonymous. On success, the action MUST log a `signup_success` event, set the signed `pending-email` cookie (see `public-email-confirmation` spec), and redirect to the public `/verifique-email` page (NOT the session-gated `/onboarding/pending`, which an anonymous request cannot reach). On failure, the action MUST return a typed result and NEVER throw across the boundary.

#### Scenario: Valid payload succeeds and redirects to the public confirmation page

- **WHEN** the form is submitted with input that passes `signupInputSchema` and Supabase accepts the signup
- **THEN** the action calls `supabase.auth.signUp({ email, password, options: { data: { fullName, crpNumber, crpUf, acceptedTerms, acceptedPrivacy, acceptedSensitiveData }, emailRedirectTo: '<origin>/auth/callback' } })`, logs `signup_success` in `auth_logs` with `metadata: { crpNumber, crpUf }`, sets the signed `pending-email` cookie, and redirects the browser to `/verifique-email`

#### Scenario: Invalid payload is rejected before calling Supabase

- **WHEN** the form is submitted with any field failing `signupInputSchema`
- **THEN** the action returns `{ ok: false, error: 'invalid_input', fieldErrors: { ...flatErrors } }` without calling Supabase or writing to the database

#### Scenario: Duplicate email returns typed error and logs the failure

- **WHEN** Supabase responds with "User already registered"
- **THEN** the action returns `{ ok: false, error: 'duplicate_email' }`, logs `signup_failure_duplicate_email` in `auth_logs` with `user_id: null` and `metadata.emailHash`, does not set the `pending-email` cookie, and does not redirect

#### Scenario: Duplicate CRP/UF rolls back the auth.user and returns typed error

- **WHEN** Supabase signup succeeds but the trigger detects a `UNIQUE (crp_number, crp_uf)` violation
- **THEN** the action invokes `supabase.auth.admin.deleteUser(userId)` via the service-role client, logs `signup_failure_duplicate_crp` in `auth_logs` with `metadata.crpNumber` and `metadata.crpUf`, and returns `{ ok: false, error: 'duplicate_crp' }`

#### Scenario: Action never throws across the boundary

- **WHEN** any unexpected error occurs (Supabase 5xx, network, database unreachable)
- **THEN** the action returns `{ ok: false, error: 'unknown' }` and does not propagate the exception to the client

### Requirement: Onboarding pending screen blocks `(app)` until profile is active

The system SHALL provide an `/onboarding/pending` page under the `(app)` route group that renders a centered card explaining the current account status. The page serves exclusively users in `pending_crp_validation` — the post-confirmation state in which a valid session exists. Users in `pending_verification` never hold a session (signup returns none and login is blocked), so they are routed to the public `/verifique-email` page instead and never reach this screen. Any attempt to access another `(app)` route while in `pending_crp_validation` MUST be redirected to `/onboarding/pending` by the middleware. The screen MUST render a read-only message about the CRP validation queue and MUST NOT render a verification-email resend control (email confirmation is already complete in this state). An `active` user reaching `/onboarding/pending` MUST be redirected to `/dashboard`.

#### Scenario: `pending_crp_validation` user sees waiting message

- **WHEN** a user with `profile.status = 'pending_crp_validation'` visits `/onboarding/pending`
- **THEN** the page renders the card with copy explaining the CRP validation queue and the expected SLA (24h), without any resend button

#### Scenario: Active user is redirected to dashboard

- **WHEN** a user with `profile.status = 'active'` visits `/onboarding/pending`
- **THEN** the middleware redirects them to `/dashboard` (HTTP 307)

#### Scenario: No session resolves to login (defense-in-depth)

- **WHEN** a request reaches `/onboarding/pending` with no session or no `profiles` row
- **THEN** the page redirects to `/login` (the middleware is the authoritative gate; this re-check guards against bypass)

#### Scenario: Pending-CRP user attempting `/dashboard` is redirected to onboarding

- **WHEN** a user with `profile.status = 'pending_crp_validation'` visits `/dashboard` or any other `(app)` route except `/onboarding/pending`
- **THEN** the middleware redirects them to `/onboarding/pending` (HTTP 307)

## REMOVED Requirements

### Requirement: `resendVerificationEmail` Server Action is rate-aware and idempotent

**Reason**: This Server Action required an authenticated user in `pending_verification` status, but with Supabase email confirmation enabled such a user can never hold a session — `supabase.auth.signUp` returns no session and `supabase.auth.signInWithPassword` is blocked with `email_not_confirmed` until the email is confirmed (at which point the status is already `pending_crp_validation`). The action therefore has no reachable caller once the `/onboarding/pending` `pending_verification` rendering is removed.

**Migration**: Email-confirmation resend is now handled exclusively by the public, session-less resend action on `/verifique-email` (see `public-email-confirmation` spec: "Anonymous resend is enumeration-safe and Supabase-rate-limited"). It sources the email from the signed `pending-email` cookie and relies on Supabase's native per-user (60s) and per-hour email-send rate limits instead of the profile-row throttle. The `resend-verification.ts` module file and its `'use server'` shell SHALL be deleted.
