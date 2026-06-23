# Tasks

> Ordering rule: each test sits immediately after the code change it covers, so the implementing agent keeps full context. Backend before frontend within each slice. Validate with `npm run lint` + `npm run type-check` as you go; do not use `--no-verify`.

## 1. Foundations — env + signed cookie helper

- [x] 1.1 Add `PENDING_EMAIL_COOKIE_SECRET: z.string().min(32)` to `serverEnvSchema` in `src/shared/env/schemas.ts`; export via `@/shared/env`. Add it to the env example/docs and to all CI/test env setups so signing never fails silently.
- [x] 1.2 Create `src/shared/lib/cookies/pending-email.ts` mirroring `keep-logged-in.ts`: `setPendingEmailCookie(store, email)`, `readPendingEmail(store): string | null` (HMAC-SHA256 verify via `node:crypto`, timing-safe compare; invalid → `null`), `clearPendingEmailCookie(store)`, `maskEmail(email): string` (first local char + `@domain`). Cookie attrs: `HttpOnly`, `SameSite=Lax`, `Secure` (prod), `Path=/`, `Max-Age=1800`. Value `base64url(email).base64url(hmac)`.
- [x] 1.3 Unit test `src/__tests__/unit/shared/lib/cookies/pending-email.test.ts`: round-trip set→read; tampered value → `null`; wrong-secret signature → `null`; `maskEmail` preserves first char + full domain and never the rest of the local part; cookie options are hardened (HttpOnly/Lax/Secure/Path/Max-Age).

## 2. Shared confirm-email copy

- [x] 2.1 Add `src/modules/registration/lib/confirm-email-copy.ts` exporting the shared pt-BR title/body ("Confirme seu cadastro, através de um link que enviamos para seu email. Se não encontrar, busque na caixa de Spam ou Lixeira.") and the generic resend acknowledgement ("Se houver um cadastro com este email, reenviamos o link de confirmação."). Export from the module barrel if consumed outside `registration`.

## 3. Backend — signUp redirect + cookie

- [x] 3.1 In `sign-up.ts`, on the success path set the `pending-email` cookie from the submitted email (before `redirect`) and change the redirect target to `/verifique-email` (drop `PENDING_REDIRECT`/`/onboarding/pending`). Failure branches must NOT set the cookie.
- [x] 3.2 Integration test (registration suite): a valid signup sets a hardened, signature-valid `pending-email` cookie and returns a redirect to `/verifique-email`; `duplicate_email`/`duplicate_crp`/`unknown` set no cookie and do not redirect there. (Maps to `account-registration` → "`signUp` … redirects to the public confirmation page".)

## 4. Backend — login `email_not_confirmed` (no lockout)

- [x] 4.1 Add `'email_not_confirmed'` to the `SignInResult` union in `src/modules/auth/lib/sign-in-result.ts`.
- [x] 4.2 In `login.ts`, inside the `if (supabaseError)` block branch FIRST on `supabaseError.code === 'email_not_confirmed' || supabaseError.status === 422`: do NOT call `applyFailedLoginAttempt` / touch lockout counters; set the `pending-email` cookie from the submitted email; log `login_failure` with `metadata.reason='email_not_confirmed'`; return `{ ok: false, error: 'email_not_confirmed' }`. All other errors keep the existing failed-credentials/lockout path.
- [x] 4.3 Unit test `src/__tests__/unit/modules/auth/server/login.test.ts` (or extend existing): when Supabase returns `email_not_confirmed` (422), `applyFailedLoginAttempt` is NOT invoked, no counter mutation occurs, the cookie is set, and the result is `email_not_confirmed`.
- [x] 4.4 Integration test (auth-hardening/data-layer suite, real Postgres): repeated `email_not_confirmed` outcomes leave `failed_login_count`, `consecutive_lockouts`, `lockout_until`, `requires_password_reset` unchanged (proves the lockout bug is fixed). (Maps to `authentication` → "Unconfirmed email returns `email_not_confirmed` without touching lockout".)

## 5. Backend — public resend action

- [x] 5.1 Create `src/modules/registration/server/resend-public.ts` + `'use server'` shell: read email via `readPendingEmail` (verified cookie, NEVER client input); if absent/invalid → return generic `{ ok: true }` WITHOUT calling Supabase; else call `supabase.auth.resend({ type: 'signup', email })` (anon server client) and return the SAME generic result for 200/422/429; never throw; no `profiles` lookup; no custom throttle.
- [x] 5.2 Integration test (registration suite, MSW or stubbed Supabase): identical result + identical copy for Supabase 200 vs 422 vs 429; no-cookie path performs no Supabase call; tampered cookie behaves as no-cookie. (Maps to `public-email-confirmation` → "Anonymous resend is enumeration-safe…".)

## 6. Middleware — classify `/verifique-email` as public

- [x] 6.1 In `src/middleware.ts:classifyPath()`, add `'/verifique-email'` as an exact-match `public` route using the existing strict exact/prefix+separator check.
- [x] 6.2 Integration test in `src/__tests__/integration/middleware/`: anonymous GET `/verifique-email` → `pass` (no redirect to `/login`); `pending_*`, `active`, `active`+rpr → `pass`; `/verifique-emailx` does not match the public classification. (Maps to `middleware-gating` → "Middleware classifies `/verifique-email` as public".)

## 7. Frontend — `/verifique-email` page + resend leaf

- [x] 7.1 Create `src/app/(auth)/verifique-email/page.tsx` (RSC): read `pending-email` via `readPendingEmail`, render the DS `Card` with `Mail` icon, shared title/body, masked email when present (omit line when absent — no crash), and the resend client leaf. Test ids: `verifique-email-card`, `verifique-email-address`, `verifique-email-resend`, `verifique-email-feedback` (`aria-live="polite"`). DS tokens only; dark mode; 375px + 200% zoom; `prefers-reduced-motion`.
- [x] 7.2 Create the `'use client'` resend leaf calling the public resend action; `Button` `primary` with mandatory loading state; render the generic acknowledgement in the `aria-live` feedback region (info/neutral, never `danger`).
- [x] 7.3 Unit test (RTL) `src/__tests__/unit/app/verifique-email/`: renders card + masked email from a valid cookie; renders generic guidance with NO masked line when cookie absent; resend click shows loading then the generic acknowledgement; correct test ids present.
- [x] 7.4 Document the new `data-testid` values in `docs/design-system/testid.md`.

## 8. Frontend — login confirm-email state

- [x] 8.1 In `LoginForm`, render for `error === 'email_not_confirmed'` the shared copy in an informational (non-`danger`) region `data-testid="login-confirm-email"` with a `link`/`secondary` control to `/verifique-email`; leave the `invalid_credentials` → `login-form-error` path unchanged; no other result reveals the unconfirmed state.
- [x] 8.2 Unit test (RTL): `email_not_confirmed` renders `login-confirm-email` (non-danger) + link to `/verifique-email`; `invalid_credentials` renders `login-form-error` and NOT `login-confirm-email`. (Maps to `authentication` → "Login page renders the confirm-email state…".)

## 9. Pruning — remove dead `pending_verification`-with-session code

- [x] 9.1 Delete `src/modules/registration/server/resend-verification.ts` and its `'use server'` shell; remove its barrel export and the action wiring in `onboarding/pending/page.tsx`.
- [x] 9.2 Remove the `pending_verification` case from `src/app/(app)/onboarding/pending/page.tsx` and from `OnboardingPendingCard` (serve only `pending_crp_validation`); keep the `!profile → /login` and `active → /dashboard` guards. Add a brief comment noting unconfirmed users now live on the public `/verifique-email` page.
- [x] 9.3 Remove the `pending_verification` arm of the success-path switch in `login.ts` (remaining arm handles `pending_crp_validation` only).
- [x] 9.4 Delete unit/integration tests that assert the removed behavior (authenticated resend, `pending_verification` rendering, `pending_verification` login redirect). Update any signup/pending tests that referenced the old `/onboarding/pending` redirect to expect `/verifique-email`.

## 10. E2E — real GoTrue (`@auth-real`)

- [x] 10.1 In `src/__tests__/e2e/real/`, add a spec (tag `@auth-real`): sign up a fresh email → lands on `/verifique-email` (not `/login`), card visible, URL carries no email param.
- [x] 10.2 Same suite: logging in on that unconfirmed account with the CORRECT password shows the confirm-email state (`login-confirm-email`) and does NOT lock the account after repeated attempts; with a WRONG password returns the generic `invalid_credentials` (proves GoTrue validates password before `email_not_confirmed`, so no enumeration leak).
- [x] 10.3 Same suite: clicking resend on `/verifique-email` (anonymous) succeeds with generic copy.

## 11. Docs

- [x] 11.1 Note the built-in-SMTP per-hour email-send limitation (`auth.rate_limits.email.inbuilt_smtp_per_hour`) and the post-MVP custom-SMTP plan in the relevant runbook/auth doc. Update the project structure/docs if a new module file or route group entry warrants it.

## 12. Final verification

- [x] 12.1 `npm run lint`, `npm run type-check`, and the unit + integration + `@auth-real` E2E suites pass. Run `openspec validate add-public-email-confirmation --strict`. Confirm no remaining references to `resend-verification` or a `pending_verification` session path.
