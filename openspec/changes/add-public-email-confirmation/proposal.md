## Why

When a psychologist registers with email + password (not Google), Supabase email confirmation is enabled, so `supabase.auth.signUp()` returns **no session**. `sign-up.ts` then redirects to the session-gated `/onboarding/pending`, the middleware sees an anonymous request and bounces it to `/login` — with **no warning that the account needs email confirmation**. The carefully-written "Confirme seu email" card is unreachable on the signup path.

The same gap exists at login: an unconfirmed user who enters the **correct** password receives a misleading `invalid_credentials` error **and** has their lockout counter incremented on every attempt — so a legitimate user can be locked out (and even pushed to `requires_password_reset`) purely for not having confirmed their email. This happens because `login.ts` treats Supabase's `email_not_confirmed` (HTTP 422) error as a failed login attempt.

## What Changes

- **New public `/verifique-email` page.** A psychologist who just signed up (or who tries to log in unconfirmed) lands on a public page that clearly says "Confirme seu cadastro, através de um link que enviamos para seu email. Se não encontrar, busque na caixa de Spam ou Lixeira.", shows their (masked) email, and offers a resend button. Built with the Design System (`docs/design-system/rules.md`).
- **Signup redirects to `/verifique-email`** instead of `/onboarding/pending`, after setting a short-lived signed **HttpOnly `pending-email` cookie** carrying the email server-side (never `?email=` in the URL — PII/LGPD).
- **Anonymous resend.** `/verifique-email`'s resend calls `supabase.auth.resend({ type: 'signup', email })`, which requires no session. It relies on Supabase's native limits (60s per-user + per-hour email-send limit) and **always renders generic copy** (swallowing 200/422/429) so it cannot be used for email enumeration. The existing authenticated resend (`resend-verification.ts`) **keeps** its profile-row 60s throttle for the post-confirmation page.
- **Login handles `email_not_confirmed`.** `signIn` detects Supabase's `email_not_confirmed` (422), **does not** increment lockout counters (the password was correct), returns a new typed result `{ ok: false, error: 'email_not_confirmed' }`, and sets the `pending-email` cookie. The login page renders the same "confirme seu email" message with a link/resend to `/verifique-email`. A **wrong** password still returns `invalid_credentials` (401), so account existence is not leaked.
- **Prune dead code.** The `pending_verification` success-path branch in `login.ts` and the `pending_verification` case in `/onboarding/pending/page.tsx` become unreachable (unconfirmed users never obtain a session) and are **removed**. `/onboarding/pending` remains exclusively for `pending_crp_validation` (post-confirmation, has a session).

## Capabilities

### New Capabilities

- `public-email-confirmation`: The public `/verifique-email` surface — its route classification, masked-email rendering from the signed `pending-email` cookie, the anonymous resend action with enumeration-safe generic responses, and the shared "confirme seu email" copy reused by the login page.

### Modified Capabilities

- `account-registration`: The `signUp` Server Action sets the signed `pending-email` cookie and redirects to `/verifique-email` (not `/onboarding/pending`). The `/onboarding/pending` screen drops its `pending_verification` case and serves only `pending_crp_validation`. The "authenticated pending user is redirected to onboarding" expectations are re-scoped to `pending_crp_validation` only.
- `authentication`: `signIn` gains an `email_not_confirmed` result, must NOT touch lockout counters on that path, and sets the `pending-email` cookie; the login page renders the confirm-email message. The "valid credentials and pending profile redirect to onboarding" scenario is re-scoped to `pending_crp_validation` only (the `pending_verification` branch is removed, since such users can never hold a valid session).
- `middleware-gating`: `/verifique-email` is classified as a `public` path so anonymous (just-signed-up) users reach it without being bounced to `/login`.

## Impact

- **Code (backend):** `src/app/(auth)/signup/.../sign-up.ts` (cookie + redirect), `src/modules/auth/server/login.ts` (`email_not_confirmed` branch, no-lockout, cookie), `src/modules/auth/lib/sign-in-result.ts` (new error variant), `src/middleware.ts` (`classifyPath` → `public`), `src/app/(app)/onboarding/pending/page.tsx` (prune), a new public resend Server Action + signed-cookie helper under `src/modules/registration/`.
- **Code (frontend):** new `src/app/(public)/verifique-email/page.tsx` (or `(auth)` group, public-classified) + a resend client leaf reusing `ResendVerificationButton`; login page error rendering for `email_not_confirmed`; shared confirm-email copy extracted from `OnboardingPendingCard`. All Design-System-compliant.
- **Tests:** unit (login `email_not_confirmed` → no lockout; cookie signing/masking; enumeration-safe resend copy), integration (middleware classifies `/verifique-email` as public; resend swallows 200/422/429), E2E `@auth-real` (unconfirmed signup → `/verifique-email`; wrong password → `invalid_credentials`; correct password unconfirmed → confirm-email message; anonymous resend works). Each test authored immediately after the code change it covers.
- **No DB / migration / RLS changes.** No new external integrations.
- **Known MVP limitation (documented):** production uses Supabase built-in SMTP, which throttles email sends project-wide per hour (`auth.rate_limits.email.inbuilt_smtp_per_hour`); custom SMTP is planned post-MVP.
