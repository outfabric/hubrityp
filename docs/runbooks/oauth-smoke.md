# Google OAuth Smoke Test (manual, pre-release)

Manual checklist for validating the Google OAuth flow in a real (non-mocked) environment.
This is a smoke test -- it does not replace automated e2e tests but covers the parts that
cannot be automated without a real Google identity provider.

Run this checklist before every release that touches auth, OAuth, or the callback pipeline.

## Prerequisites

- [ ] Google Cloud project exists with an OAuth 2.0 Web Application credential (see
      `docs/runbooks/google-oauth-setup.md` for setup instructions).
- [ ] `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` are set in the target
      environment (`.env.local` for local, Vercel env vars for staging/production).
- [ ] Supabase Auth has Google enabled as a provider:
  - Local: `supabase/config.toml` has `[auth.external.google]` with `enabled = true`.
  - Staging/Prod: Supabase Dashboard > Authentication > Providers > Google is enabled.
- [ ] The authorized redirect URI in Google Cloud Console matches the Supabase auth callback
      URL for the target environment (e.g., `http://127.0.0.1:54321/auth/v1/callback` for local).
- [ ] You have access to at least two Google accounts:
  - **Account A**: a Google account whose email is NOT registered in the app (for first-time
    signup).
  - **Account B**: a Google account whose email IS already registered via email/password
    signup (for account linking).

## Scenario 1: First-time Google signup

Tests the happy path for a new user who signs up via Google and completes their profile.

1. [ ] Open `/login` in an incognito/private window.
2. [ ] Verify the "Entrar com Google" button is visible (`data-testid="login-form-google-button"`).
3. [ ] Click "Entrar com Google".
4. [ ] Google consent screen appears. Sign in with **Account A**.
5. [ ] After Google redirects back, verify you land on `/onboarding/complete-profile`.
6. [ ] Fill in the complete-profile form:
   - Full name
   - CRP number (e.g., `123456`)
   - CRP UF (e.g., `SP`)
   - Check all three consent boxes (Terms, Privacy, Sensitive Data)
7. [ ] Click "Completar cadastro".
8. [ ] Verify you are redirected to `/onboarding/pending` with `pending_crp_validation` status.
9. [ ] **Database check**: Query `auth.profiles` and confirm:
   - A row exists for Account A's `auth.users.id`.
   - `full_name`, `crp_number`, `crp_uf` are populated.
   - `status` is `pending_crp_validation`.
   - `accepted_terms_at`, `accepted_privacy_at`, `accepted_sensitive_data_at` are set.
10. [ ] **Auth check**: Confirm `auth.users` has the user with `email` = Account A's email and
        an `identities` entry with `provider = 'google'`.

## Scenario 2: Returning Google user (already completed profile)

Tests the happy path for a returning user who previously signed up via Google.

1. [ ] (Prerequisite: Account A completed Scenario 1 and was manually promoted to `active`
       status in `auth.profiles`, e.g., via `UPDATE auth.profiles SET status = 'active' WHERE ...`.)
2. [ ] Open `/login` in an incognito/private window.
3. [ ] Click "Entrar com Google" and sign in with **Account A**.
4. [ ] Verify you are redirected directly to `/dashboard`.
5. [ ] Verify the greeting shows Account A's email or name.
6. [ ] Click logout and confirm you return to `/login`.

## Scenario 3: Account linking (existing email/password account)

Tests the flow when a Google account's email matches an existing email/password registration.

1. [ ] (Prerequisite: Account B's email is registered in the app via `/signup` with
       email/password and has `active` status. If not, create the account first.)
2. [ ] Open `/login` in an incognito/private window.
3. [ ] Click "Entrar com Google" and sign in with **Account B**.
4. [ ] Verify you are redirected to `/auth/link-account`.
5. [ ] Enter Account B's existing password in the link-account form.
6. [ ] Click "Vincular conta".
7. [ ] Verify you are redirected to `/login` with the success banner
       (`data-testid="login-banner-account_linked"`) showing "Conta Google vinculada com sucesso."
8. [ ] Log in again (via Google or email/password) and verify you reach `/dashboard`.
9. [ ] **Database check**: Query `auth.users` for Account B's email and confirm `identities`
       now includes both `email` and `google` providers.

## Scenario 4: Error cases

Quick checks for common failure modes.

1. [ ] **Cancelled consent**: Click "Entrar com Google", then cancel on Google's consent
       screen. Verify you land on `/auth/callback` with an error message (not a blank page or
       crash).
2. [ ] **Wrong password on link-account**: In Scenario 3, enter an incorrect password. Verify
       the inline error (`data-testid="link-account-form-error"`) appears and the form does not
       submit.
3. [ ] **Missing env var**: Remove `GOOGLE_OAUTH_CLIENT_ID` from the environment and restart
       the dev server. Verify the Google button is NOT rendered on `/login`. Restore the env var
       after.

## Scenario 5: Verify logs

1. [ ] Check server logs (Vercel function logs or local terminal) during Scenarios 1-4.
2. [ ] Confirm no PII (emails, names, tokens) appears in log output.
3. [ ] Confirm structured log entries exist for:
   - OAuth callback received (with anonymized user reference, not email)
   - Profile completion action
   - Account linking action
4. [ ] Confirm no unhandled exceptions or 500 errors.

## Pass/fail criteria

| Criterion                                     | Pass                                                    |
| --------------------------------------------- | ------------------------------------------------------- |
| First-time Google signup reaches pending page | User lands on `/onboarding/pending` with correct status |
| Returning Google user reaches dashboard       | User lands on `/dashboard` without extra steps          |
| Account linking succeeds                      | User sees success banner, both identities in DB         |
| Cancelled consent shows error gracefully      | Error page renders, no crash or blank screen            |
| Wrong password shows inline error             | Error region visible, form stays on page                |
| Google button hidden when env var missing     | Button not rendered, no console errors                  |
| No PII in logs                                | Logs contain no emails, names, or tokens                |
| No 500 errors in any scenario                 | All server responses are 2xx or expected 4xx            |

All criteria must pass. If any fails, file a bug with the scenario number, expected behavior,
and actual behavior before proceeding with the release.
