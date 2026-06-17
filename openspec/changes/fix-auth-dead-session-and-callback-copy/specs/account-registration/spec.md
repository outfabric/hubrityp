## MODIFIED Requirements

### Requirement: Email verification callback transitions account status

The system SHALL provide a Route Handler at `src/app/(auth)/auth/callback/route.ts` (resolves to `/auth/callback`) that exchanges the Supabase verification code for a session via `supabase.auth.exchangeCodeForSession`, relies on the database trigger to transition `profile.status` from `pending_verification` to `pending_crp_validation`, logs an `email_verified` event, and redirects to `/onboarding/pending`. On error, the route MUST redirect to `/auth/callback/error?reason=<reason>` with a typed reason and the error page MUST render pt-BR copy coherent with that reason.

The failure-reason union MUST be `missing | invalid | unknown | oauth_failed`:
- `missing` — no `code` or `token_hash` parameter present.
- `invalid` — a token-hash email verification (`verifyOtp`) failed (expired/tampered email link).
- `oauth_failed` — the OAuth/social-login PKCE code exchange (`exchange_failed`) failed; copy MUST reference social login (not email verification).
- `unknown` — any other unexpected failure.

The error page MUST render the resend-verification CTA **only** for the email-verification reasons (`missing`, `invalid`, `unknown`); for `oauth_failed` the CTA MUST be hidden and the copy MUST direct the user back to the login screen instead of offering to resend an email. The page MUST not crash on an unknown/absent reason, falling back to the generic email-verification copy.

#### Scenario: Valid verification code transitions status and redirects

- **WHEN** the user clicks a valid verification link and the GET request hits `/auth/callback?code=<valid>`
- **THEN** the handler calls `exchangeCodeForSession`, the trigger has already updated `profile.status = 'pending_crp_validation'` (or does so as part of the same transaction), the handler logs `email_verified` in `auth_logs`, and the response is HTTP 307 to `/onboarding/pending`

#### Scenario: Expired or invalid email token shows recoverable error with resend

- **WHEN** the GET request hits `/auth/callback?token_hash=<expired or tampered>&type=email` and `verifyOtp` fails
- **THEN** the handler redirects to `/auth/callback/error?reason=invalid` and the page renders `data-testid="auth-callback-error"` with email-verification pt-BR copy AND a "Reenviar email de verificação" button (`data-testid="auth-callback-resend"`)

#### Scenario: OAuth/PKCE code exchange failure shows social-login error without resend

- **WHEN** the GET request hits `/auth/callback?code=<…>` and the OAuth code exchange fails (`exchange_failed`, e.g. empty `code_verifier`)
- **THEN** the handler redirects to `/auth/callback/error?reason=oauth_failed` and the page renders pt-BR copy about a failed social/Google login (NOT email verification), does NOT render the resend button (`auth-callback-resend` absent), and offers a path back to `/login`

#### Scenario: Missing code parameter renders error

- **WHEN** the GET request hits `/auth/callback` without a `code` or `token_hash` parameter
- **THEN** the handler redirects to `/auth/callback/error?reason=missing` and the page renders the error card (does not crash)

#### Scenario: Unknown or absent reason falls back to generic email copy

- **WHEN** the error page is rendered with `?reason=unknown` or with no `reason` parameter
- **THEN** it renders the generic email-verification copy with the resend CTA, without crashing
