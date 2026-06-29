# oauth-google Specification

## Purpose

Defines the Google OAuth sign-in flow for HubrityP: the Google button on the login page, the `/auth/callback` branching logic for OAuth sessions, the `/onboarding/complete-profile` route for first-time OAuth users, the `completeOAuthProfile` Server Action, the `/auth/link-account` route for email collision resolution, the module layout under `src/modules/oauth/`, and the E2E stub for testing without real Google credentials.

## Requirements

### Requirement: Login page exposes a Google sign-in entry point

The system SHALL render an "Entrar com Google" button on `/login` that initiates the OAuth flow via `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: '<origin>/auth/callback', queryParams: { prompt: 'select_account' } } })`. The button MUST live inside `LoginForm` and use the design system's secondary button variant; the click MUST call the Supabase client from a Client Component (no Server Action involved). The button MUST be positioned **above** the email/password fields ("Google-first"), with an "ou" divider separating it from the credential fields below it. The button MUST render the official multi-color Google "G" glyph; the glyph MUST keep Google's brand colors (it MUST NOT be recolored to `currentColor` or any single tone), per Google's brand guidelines.

#### Scenario: Click on Google button starts OAuth flow

- **WHEN** an unauthenticated user clicks the button on `/login`
- **THEN** the browser navigates to Google's consent screen for the configured client; on success Google redirects to `<origin>/auth/callback?code=…`

#### Scenario: Google button uses a stable test id

- **WHEN** the page is inspected
- **THEN** the button exposes `data-testid="login-form-google-button"` and renders the multi-color Google "G" glyph as an inline SVG

#### Scenario: Google button is positioned first

- **WHEN** `/login` is rendered
- **THEN** the Google button appears above the email and password fields, followed by an "ou" divider, then the credential fields and the submit button

### Requirement: Signup page exposes a Google sign-up entry point

The system SHALL render a "Cadastrar com Google" button on `/signup` that initiates the exact same OAuth flow as the login button via `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: '<origin>/auth/callback', queryParams: { prompt: 'select_account' } } })`. The button MUST reuse the shared `GoogleButton` Client Component (imported directly from its leaf component file, not via the `@/modules/oauth` barrel, so that server-only code is not dragged into the client bundle), MUST use the design system's secondary button variant, and MUST render the official multi-color Google "G" glyph with brand colors preserved. The button MUST be positioned **above** the signup form fields ("Google-first"), with an "ou" divider separating it from the fields below. Clicking it MUST NOT submit the signup form. No new backend, callback, or RLS behavior is introduced — a first-time Google user reaching `/auth/callback` is handled by the existing branching (profile completion at `/onboarding/complete-profile`; email collision at `/auth/link-account`).

#### Scenario: Click on Google button from signup starts OAuth flow

- **WHEN** an unauthenticated user clicks the "Cadastrar com Google" button on `/signup`
- **THEN** the browser navigates to Google's consent screen for the configured client; on success Google redirects to `<origin>/auth/callback?code=…` and is resolved by the existing callback branching

#### Scenario: Signup Google button uses a distinct, stable test id

- **WHEN** `/signup` is inspected
- **THEN** the button exposes `data-testid="signup-form-google-button"` (distinct from the login button's id) and renders the multi-color Google "G" glyph as an inline SVG

#### Scenario: Signup Google button is positioned first and does not submit the form

- **WHEN** `/signup` is rendered
- **THEN** the Google button appears above the name/email/password/CRP/consent fields, followed by an "ou" divider; the button is `type="button"` and clicking it does not trigger native signup form submission

#### Scenario: First-time Google sign-up from signup reuses the existing flow

- **WHEN** a user with no existing account signs up via the `/signup` Google button and consents
- **THEN** the existing `/auth/callback` branching sends them to `/onboarding/complete-profile` to provide CRP, UF, and the three LGPD consents, exactly as a Google sign-up initiated from `/login` would

### Requirement: `/auth/callback` branches by identity status after the code exchange

The system SHALL extend the existing `/auth/callback` Route Handler (introduced in `auth-account-creation`) to inspect the resulting session after `exchangeCodeForSession` and decide the next destination based on the user's identities, profile presence, and email collision. The branching table is:

| Outcome of `exchangeCodeForSession` and lookups | Action |
|---|---|
| Session exists, `profile` exists, `status = 'active'` | Redirect to `/dashboard` |
| Session exists, `profile` exists, `status` in (`pending_verification`, `pending_crp_validation`) | Redirect to `/onboarding/pending` |
| Session exists, `profile` does NOT exist, this user has only the Google identity, no other `auth.users` row shares the email | Redirect to `/onboarding/complete-profile` |
| Session exists, `profile` does NOT exist, another `auth.users` row already has this email | Redirect to `/auth/link-account?pendingUserId=<new-user-id>` |
| `next=/reset-password` query param present and session is a recovery session | Redirect to `/reset-password` (existing password-recovery flow) |
| Code exchange fails (expired, invalid, missing) | Render the existing `auth-callback-error` UI |

#### Scenario: First-time Google user with no email collision goes to complete-profile

- **WHEN** a user signs in with Google for the first time, no `auth.users` row exists with their email, and the trigger does not insert a `profiles` row (per the OAuth-aware trigger)
- **THEN** the callback handler redirects to `/onboarding/complete-profile` (HTTP 307)

#### Scenario: Google email collides with an existing traditional account

- **WHEN** a user signs in with Google whose email is `maria@ex.com`, and an `auth.users` row already exists with email `maria@ex.com` (created via traditional signup)
- **THEN** the callback handler redirects to `/auth/link-account?pendingUserId=<id>` and the new Google-side `auth.users` row is held open until the link-account flow either confirms or aborts it

#### Scenario: Returning Google user with active profile goes to dashboard

- **WHEN** a user with `profile.status = 'active'` re-authenticates via Google
- **THEN** the callback handler redirects to `/dashboard`

#### Scenario: Code exchange failure renders error UI

- **WHEN** the `code` query parameter is invalid, expired, or missing
- **THEN** the callback handler renders the existing error UI with `data-testid="auth-callback-error"` and the resend control

### Requirement: `/onboarding/complete-profile` collects CRP/UF/aceites for first-time OAuth users

The system SHALL provide an `/onboarding/complete-profile` route under the `(app)` route group that renders a form for users authenticated via OAuth who do not yet have a `profiles` row. The form MUST include full name (pre-filled from `user.user_metadata.full_name` when available), CRP number, CRP UF, and the three required consent checkboxes (Terms, Privacy, Sensitive Data). The form MUST reuse the validators from `@/modules/registration` (CRP format + UF coherence + 3-consents). On success, the page MUST redirect to `/onboarding/pending`.

#### Scenario: OAuth user without profile sees the form

- **WHEN** a user authenticated via Google with no `profiles` row visits `/onboarding/complete-profile`
- **THEN** the page renders inputs for full name, CRP number, CRP UF, and the three consent checkboxes; the email field is read-only and pre-filled from the session

#### Scenario: Form fields use stable test ids

- **WHEN** the page is inspected
- **THEN** the inputs expose `data-testid="complete-profile-form-name"`, `complete-profile-form-crp-number`, `complete-profile-form-crp-uf`, `complete-profile-form-terms`, `complete-profile-form-privacy`, `complete-profile-form-sensitive-data`, `complete-profile-form-submit`, `complete-profile-form-error`

#### Scenario: User with profile is redirected to dashboard or onboarding/pending

- **WHEN** an OAuth user whose `profiles` row already exists visits `/onboarding/complete-profile`
- **THEN** the middleware redirects to `/dashboard` (if `active`) or `/onboarding/pending` (if pending)

#### Scenario: Anonymous user is redirected to login

- **WHEN** an unauthenticated client visits `/onboarding/complete-profile`
- **THEN** the middleware redirects to `/login?redirectTo=%2Fonboarding%2Fcomplete-profile`

### Requirement: `completeOAuthProfile` Server Action persists the profile and OAuth identity

The system SHALL implement a Server Action `completeOAuthProfile(formData)` that validates input via a Zod schema reusing CRP/UF/consent validators from `@/modules/registration`, INSERTs the `profiles` row via the service-role Drizzle client (with `status = 'pending_crp_validation'`, `email_verified_at = NOW()` because the email is verified by Google), INSERTs the matching `oauth_identities` row (`provider = 'google'`, `provider_user_id` from `auth.users.identities`, `is_primary = true`), logs `oauth_signup` in `auth_logs`, and redirects to `/onboarding/pending`.

#### Scenario: Valid input persists profile and identity, redirects to onboarding pending

- **WHEN** the form is submitted with valid CRP/UF/consents by an authenticated OAuth user without a profile
- **THEN** the action INSERTs `profiles` with `status='pending_crp_validation'` and `email_verified_at` set, INSERTs `oauth_identities` with `provider='google'` and `is_primary=true`, logs `oauth_signup` in `auth_logs` with `metadata.provider='google'`, and redirects to `/onboarding/pending`

#### Scenario: Duplicate CRP returns typed error

- **WHEN** the form is submitted with `(crpNumber, crpUf)` that already exists in `profiles`
- **THEN** the action returns `{ ok: false, error: 'duplicate_crp' }` and does not INSERT

#### Scenario: Invalid input is rejected

- **WHEN** the form is submitted with malformed CRP, unknown UF, missing consents, or name outside 3–120
- **THEN** the action returns `{ ok: false, error: 'invalid_input', fieldErrors: {...} }` and does not INSERT

#### Scenario: Action requires authenticated session

- **WHEN** the form is submitted by an unauthenticated client
- **THEN** the action returns `{ ok: false, error: 'invalid_session' }`

#### Scenario: Action never throws

- **WHEN** any unexpected error occurs
- **THEN** the action returns `{ ok: false, error: 'unknown' }` and does not propagate the exception

### Requirement: `/auth/link-account` confirms account linking via traditional password

The system SHALL provide an `/auth/link-account` route under the `(auth)` route group that renders a form requesting the traditional password for the email associated with a pending OAuth signup. On submission, the system MUST validate the password against the existing traditional account (using a fresh, isolated Supabase client to avoid disturbing the active OAuth session), and on success: (a) delete the pending OAuth-side `auth.users` row via service-role admin API, (b) link the Google identity to the traditional account via service-role admin API, (c) INSERT a row in `oauth_identities`, (d) log `social_linked`, (e) redirect to `/login?banner=account_linked`. On failure, the system MUST log `login_failure` against the traditional account, return `{ ok: false, error: 'invalid_credentials' }`, and surface a generic message.

#### Scenario: Correct password links Google to the traditional account

- **WHEN** the form is submitted at `/auth/link-account?pendingUserId=<gid>` with the correct traditional password for the email
- **THEN** the action confirms the password via an isolated `signInWithPassword`, calls `supabase.auth.admin.deleteUser(<gid>)`, calls `supabase.auth.admin.linkIdentity(<traditionalUserId>, 'google', <providerUserId>)` (or the documented equivalent), INSERTs `oauth_identities` for the traditional user, logs `social_linked` with `metadata.provider='google'`, and redirects to `/login?banner=account_linked`

#### Scenario: Wrong password is rejected with generic error

- **WHEN** the form is submitted with an incorrect password
- **THEN** the action logs `login_failure` against the traditional account (incrementing its `failed_login_count` per the lockout policy), returns `{ ok: false, error: 'invalid_credentials' }`, and the UI renders pt-BR copy "Senha incorreta."

#### Scenario: Stale or missing pendingUserId is rejected

- **WHEN** the form is submitted without `pendingUserId`, or with one that no longer maps to an `auth.users` row
- **THEN** the action returns `{ ok: false, error: 'invalid_link_request' }` and the UI offers a link to retry the Google sign-in

#### Scenario: Form fields use stable test ids

- **WHEN** the page is inspected
- **THEN** the password input exposes `data-testid="link-account-form-password"`, the submit button exposes `link-account-form-submit`, and the error region exposes `link-account-form-error`

### Requirement: `oauth-google` module follows the standard module layout

The system SHALL place all OAuth-related code under `src/modules/oauth/` with the following layout:

- `components/` — `google-button.tsx`, `complete-profile-form.tsx`, `link-account-form.tsx`
- `server/` — `complete-oauth-profile.ts`, `link-oauth-identity.ts`, `resolve-oauth-callback.ts` (helper used by the callback route)
- `lib/` — `complete-profile-input-schema.ts`, `link-account-input-schema.ts`, `oauth-providers.ts`
- `index.ts` — public API: `completeOAuthProfile`, `linkOAuthIdentity`, `resolveOAuthCallback`, `GoogleButton`, `CompleteProfileForm`, `LinkAccountForm`, the input schemas

The module MUST NOT carry `'use server'` at the barrel level. Route shells in `app/(app)/onboarding/complete-profile/actions.ts` and `app/(auth)/auth/link-account/actions.ts` MUST be the only files declaring `'use server'`.

#### Scenario: Public API is the only legal import surface

- **WHEN** any file outside `src/modules/oauth/` needs `completeOAuthProfile` or `GoogleButton`
- **THEN** it imports from `@/modules/oauth`, not from internal paths

#### Scenario: Module reuses validators from registration

- **WHEN** a contributor reads `src/modules/oauth/lib/complete-profile-input-schema.ts`
- **THEN** the schema imports `passwordPolicy` is NOT used (no password field), but CRP format, UF set, regional coherence, full-name length, and consent flags are validated by reusing exports from `@/modules/registration`

### Requirement: E2E coverage of OAuth uses a stub, not real Google credentials

The system SHALL implement Playwright e2e seeded coverage of the Google flow by stubbing the OAuth provider. A shared helper `src/__tests__/e2e/seeded/_shared/google-oauth-stub.ts` MUST intercept the navigation to `accounts.google.com` and return a controlled `code` to `/auth/callback`, with a controllable identity (email, provider_user_id, name). Real-credential e2e against Google is explicitly OUT OF SCOPE for this change.

#### Scenario: Stub drives a happy-path Google signup

- **WHEN** the e2e seeded suite runs the "first-time Google user" scenario
- **THEN** the stub intercepts the consent navigation, returns a deterministic code/identity, and the test asserts the redirect to `/onboarding/complete-profile` and the subsequent submit creates a `profiles` row with `status='pending_crp_validation'` and a row in `oauth_identities`

#### Scenario: Stub drives the link-account branch

- **WHEN** the e2e seeded suite runs the "Google email collides with traditional account" scenario
- **THEN** the stub returns an identity whose email matches a pre-seeded traditional account, the test asserts the redirect to `/auth/link-account?pendingUserId=…`, submitting the correct traditional password completes the link, and `oauth_identities` ends with one row for the traditional user
