## Context

Supabase email confirmation is enabled (`supabase/config.toml:225 enable_confirmations = true`). Therefore `supabase.auth.signUp()` returns **no session** and `supabase.auth.signInWithPassword()` is rejected with `email_not_confirmed` (HTTP 422) until the email is confirmed. The current flow (`sign-up.ts:326 redirect('/onboarding/pending')`) sends the anonymous, just-registered client to a session-gated route; `middleware.ts:classifyPath()` returns `'onboarding'` for it, the anonymous decision (`middleware.ts:285-294`) redirects to `/login?redirectTo=…`, and the user lands on login with no explanation. At login, `login.ts` treats the `email_not_confirmed` error as a failed credential attempt (`applyFailedLoginAttempt`, `login.ts:228-272`), incrementing the lockout counter for a user who typed the **correct** password.

This change adds a public confirmation surface (`/verifique-email`), carries the email server-side in a signed cookie, makes login surface a non-punitive confirm-email state, and prunes the now-unreachable `pending_verification`-with-session code paths.

Reference points already in the repo we will mirror:
- Cookie helper pattern: `src/shared/lib/cookies/keep-logged-in.ts` (hardened `BASE_OPTIONS`: `path:'/'`, `httpOnly:true`, `secure:true`, `sameSite:'lax'`).
- Env funnel: `src/shared/env/schemas.ts` (`serverEnvSchema`, e.g. `SIGNATURE_HASH_SALT: z.string().min(32)`), consumed via `@/shared/env`.
- Middleware `public` class with explicit exact-match routes (`middleware-gating` spec) and the strict prefix+separator check.
- `SignInResult` union in `src/modules/auth/lib/sign-in-result.ts`.

## Goals / Non-Goals

**Goals**
- A just-signed-up (anonymous) user reaches `/verifique-email` and sees clear guidance + a working resend, with their email never in the URL.
- An unconfirmed user logging in with the correct password sees the same guidance and is **not** penalized by the lockout counter.
- Resend cannot be used to enumerate accounts or to send confirmation emails to arbitrary addresses.
- Remove the dead `pending_verification`-with-session branches and the orphaned authenticated resend.

**Non-Goals**
- No change to the `/auth/callback` verification handler (owned by the in-flight `fix-auth-dead-session-and-callback-copy` change).
- No DB / migration / RLS changes; no new external integrations.
- No switch to custom SMTP (MVP stays on built-in SMTP — documented limitation).
- No change to OAuth/Google signup (it already yields a session).

## Decisions

### 1. Route placement and classification
`/verifique-email` lives at `src/app/(auth)/verifique-email/page.tsx` (co-located with `login`/`signup` in the auth funnel; the `(auth)` group is organizational only). Gating is by URL: add `'/verifique-email'` as an **exact-match** entry to the `public` set in `middleware.ts:classifyPath()`, using the existing strict exact/prefix+separator check so `/verifique-emailx` does not match. The page is a Server Component; a small `'use client'` leaf owns the resend button + `aria-live` feedback.

### 2. Signed `pending-email` cookie
New helper `src/shared/lib/cookies/pending-email.ts` (mirrors `keep-logged-in.ts`):
- **Name** `pending-email`. **Attributes** `HttpOnly`, `SameSite=Lax`, `Secure` (prod), `Path=/`, `Max-Age = 1800` (30 min).
- **Value** `base64url(email) + "." + base64url(HMAC_SHA256(email, secret))`. Read path recomputes the HMAC and rejects on mismatch (timing-safe compare) → treated as absent.
- **Secret** new server env `PENDING_EMAIL_COOKIE_SECRET: z.string().min(32)` added to `serverEnvSchema`, read via `serverEnv`. A dedicated secret (not `SIGNATURE_HASH_SALT`) keeps purposes separate.
- **Why signed:** the resend target is read from this cookie, so an unsigned cookie would let an attacker set `pending-email=victim@x.com` and trigger confirmation emails to arbitrary inboxes (email-bombing / enumeration). HMAC makes the value unforgeable.
- **Runtime:** written/read only in Server Actions and the RSC page (Node runtime) via `node:crypto` — never in the Edge middleware (the middleware does not read it), so no Edge-safety concern.
- Helper exports: `setPendingEmailCookie(store, email)`, `readPendingEmail(store): string | null` (verifies signature), `clearPendingEmailCookie(store)`, and `maskEmail(email): string` (first local char + `@domain`, e.g. `m**********@gmail.com`).

### 3. `signUp` change
After the existing success path (`sign-up.ts`): set the `pending-email` cookie with the submitted email, then `redirect('/verifique-email')` instead of `/onboarding/pending`. The cookie set must happen before `redirect()` (which throws `NEXT_REDIRECT`). Failure branches (`duplicate_email`, `duplicate_crp`, `unknown`) do **not** set the cookie.

### 4. `signIn` change — detect `email_not_confirmed`, no lockout
In `login.ts`, inside the `if (supabaseError)` block, branch FIRST on the unconfirmed signal:
```
const unconfirmed = supabaseError.code === 'email_not_confirmed' || supabaseError.status === 422;
```
(Match defensively on both `code` and `status` so a GoTrue wording drift still trips.) On that branch: do NOT call `applyFailedLoginAttempt`; set the `pending-email` cookie from the submitted email; log `login_failure` with `metadata.reason='email_not_confirmed'`; return `{ ok: false, error: 'email_not_confirmed' }`. All other Supabase errors keep the existing failed-credentials/lockout path. Because GoTrue validates the password before returning 422, a wrong password yields `invalid_credentials` (401) and never reaches this branch — so account existence is not disclosed. Add `'email_not_confirmed'` to the `SignInResult` union.

### 5. Public resend action — enumeration-safe, cookie-sourced
New Server Action `src/modules/registration/server/resend-public.ts` + `'use server'` shell (called by the `/verifique-email` client leaf). It:
- reads the email via `readPendingEmail` (verified cookie) — **never** from client input;
- if absent/invalid → returns the generic success-shaped result WITHOUT calling Supabase;
- otherwise calls `supabase.auth.resend({ type: 'signup', email })` using the anon server client (`createServerClient`), and returns the SAME generic result regardless of 200 / 422 / 429 (swallow errors, never throw);
- performs NO `profiles` lookup and implements NO custom throttle — Supabase's native per-user 60s window + per-hour email-send limit are the rate control.
Return shape: `{ ok: true }` always (the UI renders generic copy). The action must never branch copy on outcome.

### 6. Shared confirm-email copy
Extract the agreed pt-BR message to a single constant (e.g. `src/modules/registration/lib/confirm-email-copy.ts`) reused by `/verifique-email` and the login `email_not_confirmed` state: title + body "Confirme seu cadastro, através de um link que enviamos para seu email. Se não encontrar, busque na caixa de Spam ou Lixeira." Generic resend acknowledgement: "Se houver um cadastro com este email, reenviamos o link de confirmação."

### 7. Login page rendering
`LoginForm` renders, for `error === 'email_not_confirmed'`, an **informational** (not `danger`) feedback region `data-testid="login-confirm-email"` with the shared copy and a `link`/`secondary` control to `/verifique-email`. The generic `invalid_credentials` path is unchanged (`login-form-error`). No other result reveals the unconfirmed state.

### 8. Pruning
- Delete `src/modules/registration/server/resend-verification.ts` and its `'use server'` shell + the action wiring in `onboarding/pending/page.tsx`.
- Remove the `pending_verification` case from `onboarding/pending/page.tsx` and from `OnboardingPendingCard` (now serves only `pending_crp_validation`); keep the `!profile` → `/login` and `active` → `/dashboard` guards.
- Remove the `pending_verification` arm of the success-path switch in `login.ts` (the remaining arm handles `pending_crp_validation` only).
- Delete the unit/integration tests that assert the removed behavior; the spec deltas are the source of truth for what replaces them.

### 9. Design System mapping for `/verifique-email`
- `Card` (`default`, radius `xl`, padding `space-6`, single level) centered; `Mail` Lucide icon (20px, `aria-hidden`).
- Title h3 (18px/600); body `body` (15px/400) `text-secondary`; masked email `body-sm`/`text-tertiary`.
- Resend = `Button` `primary`, `md`, full-width on mobile, mandatory loading state (async > 300ms).
- Feedback line in info/neutral styling, `aria-live="polite"`; no `danger` color (resend is reassurance, not error).
- Tokens only, dark-mode parity, 375px + 200% zoom, `prefers-reduced-motion`, focus ring `shadow-focus`.

## Risks / Trade-offs

- **[Login reveals an account is unconfirmed]** Showing `email_not_confirmed` discloses that the email exists and is unconfirmed — but only to a caller who already supplied the correct password (GoTrue checks password first). → Mitigation: encode "wrong password → `invalid_credentials`" as a `@auth-real` E2E assertion so a GoTrue ordering change fails CI rather than silently leaking.
- **[Forged resend target]** Without signing, the cookie could redirect confirmation emails to arbitrary addresses. → Mitigation: HMAC-signed cookie + cookie-sourced email + always-generic response.
- **[Built-in SMTP throttle]** MVP built-in SMTP caps email sends project-wide per hour (`auth.rate_limits.email.inbuilt_smtp_per_hour`); heavy resend usage can silently throttle. → Mitigation: documented limitation; custom SMTP planned post-MVP; resend copy is generic so a throttled send is not surfaced as a distinct state.
- **[New required env]** `PENDING_EMAIL_COOKIE_SECRET` must exist in all environments or signing fails. → Mitigation: add to env schema (min 32) and to the env example/docs; the read path treats a verification failure as "no cookie" (degrades to generic guidance, never crashes).
- **[Cookie absent on confirmation page]** Direct navigation to `/verifique-email` (no cookie) shows generic guidance without the masked email. → Accepted: the page still functions; resend no-ops generically.

## Migration Plan

Forward-only, no data migration. Deploy order is irrelevant (no schema/state). Rollback is a straight revert. Set `PENDING_EMAIL_COOKIE_SECRET` in each environment before/with deploy. An old client mid-flight that lands on the old `/onboarding/pending` while `pending_verification` simply gets the defense-in-depth `→/login` (page guard), which is acceptable during the rollout window.

## Open Questions

- None blocking. Final pt-BR wording follows `docs/design-system/rules.md` microcopy rules and may be tuned during implementation without changing behavior.
