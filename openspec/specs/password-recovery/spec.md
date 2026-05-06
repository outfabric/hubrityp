# password-recovery Specification

## Purpose

Defines the password recovery flow for HubrityP: the `/forgot-password` page for requesting a reset, the `requestPasswordReset` Server Action with anti-enumeration guarantees, the `/reset-password` page for setting a new password, the `resetPassword` Server Action with strong-password enforcement and session invalidation, the notification email on password change, the module layout under `src/modules/password-recovery/`, and the `data-testid` documentation for all new elements.

## Requirements

### Requirement: Forgot-password page is publicly reachable and renders the request form

The system SHALL provide a `/forgot-password` route under the `(auth)` route group that renders a single-field form (email) for unauthenticated users to request a password reset.

#### Scenario: Anonymous user can reach `/forgot-password`

- **WHEN** an anonymous client visits `/forgot-password`
- **THEN** the response is HTTP 200 and the page renders an email input, a submit button, and a back-link to `/login`

#### Scenario: Authenticated active user is redirected away

- **WHEN** a user with `profile.status = 'active'` and `requires_password_reset = false` visits `/forgot-password`
- **THEN** the middleware redirects them to `/dashboard`

#### Scenario: Form fields use stable test ids

- **WHEN** the page is inspected
- **THEN** the email input exposes `data-testid="forgot-password-form-email"`, the submit button exposes `forgot-password-form-submit`, and the success message region exposes `forgot-password-form-success-message`

### Requirement: `requestPasswordReset` Server Action returns a generic response regardless of email existence

The system SHALL implement a Server Action `requestPasswordReset(formData)` that accepts an `email` field, validates it as RFC-compliant, and returns the same success-shaped response (`{ ok: true }`) and the same UI copy whether or not the email corresponds to an existing account. When the email exists, the action MUST call `supabase.auth.resetPasswordForEmail(email, { redirectTo: '<origin>/auth/callback?next=/reset-password' })` and log `password_reset_requested` in `auth_logs` with the matching `userId`. When the email does NOT exist, the action MUST log `password_reset_requested` with `userId: null` and `metadata.emailHash` and perform a constant-time delay so response timing does not reveal account existence.

#### Scenario: Existing email triggers Supabase reset email

- **WHEN** the form is submitted with an email that matches an existing `auth.users` row
- **THEN** the action calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: '<origin>/auth/callback?next=/reset-password' })`, logs `password_reset_requested` in `auth_logs` with the matching `userId`, and returns `{ ok: true }` with the generic success copy

#### Scenario: Non-existing email returns the same response shape and copy

- **WHEN** the form is submitted with an email that does NOT match any `auth.users` row
- **THEN** the action does not call `supabase.auth.resetPasswordForEmail`, logs `password_reset_requested` with `userId: null` and `metadata.emailHash`, and returns `{ ok: true }` with copy "Se este email estiver cadastrado, enviaremos um link em alguns instantes."

#### Scenario: Response timing is uniform for existing vs non-existing email

- **WHEN** the action handles 100 sequential submissions, half with existing emails and half with non-existing
- **THEN** the median response time of the two groups differs by less than 50ms (timing leak budget)

#### Scenario: Malformed email is rejected before any backend call

- **WHEN** the form is submitted with `email: 'not-an-email'`
- **THEN** the action returns `{ ok: false, error: 'invalid_input' }` and does not call Supabase or write to `auth_logs`

#### Scenario: Action never throws across the boundary

- **WHEN** any unexpected error occurs (Supabase 5xx, network, database unreachable)
- **THEN** the action returns `{ ok: false, error: 'unknown' }` and the page renders pt-BR copy "Algo deu errado. Tente novamente."

#### Scenario: Supabase rate limiting is hidden from the client

- **WHEN** Supabase responds with HTTP 429 (rate-limit)
- **THEN** the action still returns `{ ok: true }` with the generic success copy (the user does not need to know rate-limiting is involved); the rate-limit event is logged via pino for ops

### Requirement: Reset-password page exchanges the recovery session for a password change form

The system SHALL provide a `/reset-password` route under the `(auth)` route group, reachable only after the user clicks the email link and the `/auth/callback?next=/reset-password` flow has established a recovery session. The page MUST render two fields (new password, confirm password) and a submit button. If the page is reached without a valid recovery session, it MUST render an error state with a link back to `/forgot-password`.

#### Scenario: User with valid recovery session sees the form

- **WHEN** a user clicks the password-reset link, the callback exchanges the code for a session, and the browser arrives at `/reset-password`
- **THEN** the page renders the new-password field (`data-testid="reset-password-form-password"`), the confirmation field (`reset-password-form-confirm`), the submit button (`reset-password-form-submit`), and a list of password policy requirements

#### Scenario: User without recovery session sees friendly error

- **WHEN** an unauthenticated user navigates directly to `/reset-password`
- **THEN** the page renders an error region (`data-testid="reset-password-form-error"`) with copy "Link invalido ou expirado." and a button to request a new link

### Requirement: `resetPassword` Server Action enforces strong password and invalidates all sessions

The system SHALL implement a Server Action `resetPassword(formData)` that validates the new password against the strong-password policy (`passwordPolicy` from `@/modules/registration`), confirms the two fields match, calls `supabase.auth.updateUser({ password })`, then invalidates ALL sessions for the user via `supabase.auth.admin.signOut(userId, 'global')` (service-role) and resets the lockout state on `profiles` (`requires_password_reset = false`, `failed_login_count = 0`, `consecutive_lockouts = 0`, `lockout_until = NULL`). After persistence, the action MUST send a "Senha alterada" notification email and log `password_reset_completed` in `auth_logs`. The action MUST redirect to `/login` with a banner state.

#### Scenario: Strong password is accepted and sessions are invalidated

- **WHEN** the form is submitted with two matching strong passwords by a user with a valid recovery session
- **THEN** the action calls `supabase.auth.updateUser({ password })`, then `supabase.auth.admin.signOut(userId, 'global')`, then UPDATEs `profiles` setting `requires_password_reset=false, failed_login_count=0, consecutive_lockouts=0, lockout_until=NULL`, sends the notification email (or logs the no-op in dev), logs `password_reset_completed`, and redirects to `/login?banner=password_changed`

#### Scenario: Weak password is rejected before calling Supabase

- **WHEN** the form is submitted with a password that fails any rule of `passwordPolicy`
- **THEN** the action returns `{ ok: false, error: 'invalid_input', missing: PasswordRule[] }` without calling Supabase

#### Scenario: Mismatched confirmation is rejected before calling Supabase

- **WHEN** the form is submitted with `password` and `confirm` differing
- **THEN** the action returns `{ ok: false, error: 'invalid_input' }` with the field error keyed on `confirm`, without calling Supabase

#### Scenario: Action requires a valid recovery session

- **WHEN** the form is submitted by an unauthenticated client (no session cookie)
- **THEN** the action returns `{ ok: false, error: 'invalid_session' }` and does not call Supabase

#### Scenario: Action never throws across the boundary

- **WHEN** any unexpected error occurs (Supabase 5xx, mail provider failure)
- **THEN** the action returns `{ ok: false, error: 'unknown' }` and does not propagate the exception to the client

### Requirement: Notification email is sent on every successful password change

The system SHALL send an email notification "Sua senha foi alterada" to the account email immediately after `resetPassword` (and any future password-change paths) succeeds. The email MUST be sent via Resend HTTP API in production. In development, when `RESEND_API_KEY` is unset, the helper MUST log a warning via pino and return success without making a network call (so dev does not require email infra).

#### Scenario: Production environment sends via Resend

- **GIVEN** `RESEND_API_KEY` is configured
- **WHEN** the helper `sendPasswordChangedEmail({ to, fullName })` is called
- **THEN** the helper issues a POST to `https://api.resend.com/emails` with the proper headers and a pt-BR template, returning `{ ok: true }` on HTTP 200

#### Scenario: Development without API key logs and no-ops

- **GIVEN** `RESEND_API_KEY` is unset
- **WHEN** `sendPasswordChangedEmail` is called
- **THEN** pino logs a warning with `event: 'mail.skipped', reason: 'no_api_key', to`, and the helper returns `{ ok: true, skipped: true }`

#### Scenario: Helper never throws

- **WHEN** Resend returns a non-2xx response or the network call fails
- **THEN** the helper returns `{ ok: false, error: 'send_failed' }` and the calling Server Action proceeds with the success path (the password change is already persisted; email failure must not block the user)

### Requirement: `password-recovery` module follows the standard module layout

The system SHALL place all password-recovery code under `src/modules/password-recovery/` with the following layout:

- `components/` — `forgot-password-form.tsx`, `reset-password-form.tsx`
- `server/` — `request-password-reset.ts`, `reset-password.ts`
- `lib/` — `forgot-password-input-schema.ts`, `reset-password-input-schema.ts`
- `index.ts` — public API exporting `requestPasswordReset`, `resetPassword`, `ForgotPasswordForm`, `ResetPasswordForm`, the input schemas

The module MUST NOT carry `'use server'` at the barrel level. Route shells under `app/(auth)/forgot-password/actions.ts` and `app/(auth)/reset-password/actions.ts` MUST be the only files declaring `'use server'`, and each MUST re-export the module's Server Action implementations as thin wrappers.

#### Scenario: Public API is the only legal import surface

- **WHEN** any file outside `src/modules/password-recovery/` needs `requestPasswordReset` or `ForgotPasswordForm`
- **THEN** it imports from `@/modules/password-recovery` (the module's `index.ts`), not from internal paths

#### Scenario: Route shells delegate Server Actions

- **WHEN** a contributor reads `src/app/(auth)/forgot-password/actions.ts`
- **THEN** the file declares `'use server'` and re-exports `requestPasswordReset` as a wrapper around `@/modules/password-recovery`

### Requirement: Documentation registers new `data-testid` values

The system SHALL update `docs/design-system/testid.md` to add a "Wave-5 IDs (auth-login-hardening-and-recovery)" section listing every new testid introduced by password recovery, OAuth, lockout, and keep-logged-in features in this change.

#### Scenario: Documentation lists all new password-recovery IDs

- **WHEN** the change merges
- **THEN** `docs/design-system/testid.md` contains entries for `forgot-password-form-email`, `forgot-password-form-submit`, `forgot-password-form-success-message`, `reset-password-form-password`, `reset-password-form-confirm`, `reset-password-form-submit`, `reset-password-form-error`
