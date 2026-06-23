## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Login page renders the confirm-email state with a path to resend

The system SHALL render, when `signIn` returns `{ ok: false, error: 'email_not_confirmed' }`, the shared confirm-email message (see `public-email-confirmation` spec: "Confirm-email copy is shared between the public page and the login page") together with a clear control to reach `/verifique-email` (where the user can resend the confirmation link). This state MUST be visually distinct from the generic `invalid_credentials` error (it is informational, not an error), MUST follow the Design System (info/neutral feedback styling, not `danger`), and MUST expose `data-testid="login-confirm-email"`. The login page MUST NOT reveal the unconfirmed state for any other result.

#### Scenario: Unconfirmed login shows the confirm-email guidance

- **WHEN** `signIn` returns `email_not_confirmed`
- **THEN** the login page renders the shared confirm-email copy in a non-danger feedback region (`data-testid="login-confirm-email"`) with a control linking to `/verifique-email`

#### Scenario: Invalid credentials still shows the generic error

- **WHEN** `signIn` returns `invalid_credentials`
- **THEN** the login page renders the existing generic error in `data-testid="login-form-error"` and does NOT render the `login-confirm-email` region (no account-existence disclosure)
