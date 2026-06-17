## 1. Middleware: detect invalid refresh token and break the loop

- [ ] 1.1 In `src/shared/supabase/middleware.ts`, surface whether the last session resolution failed with an invalid/missing refresh token. Add an Edge-safe helper that resolves the user via `supabase.auth.getUser()` and classifies the outcome as `{ user, invalidRefreshToken: boolean }`, matching `error.code === 'refresh_token_not_found'` OR an `AuthApiError` whose message contains "Invalid Refresh Token". Do NOT classify generic network/5xx errors or thrown errors as invalid-refresh-token. No Node-only deps.
- [ ] 1.2 In `src/middleware.ts`, when the resolved user is null AND the invalid-refresh-token flag is set, build the anonymous decision but as `clear-and-pass` (public paths) / `clear-and-redirect` to `/login?redirectTo=<path>` (gated paths), reusing `clearSupabaseCookies` + `buildRedirect`. Ensure the existing `clearSupabaseCookies` (prefix-match on `sb-`) covers the chunked `sb-<ref>-auth-token.N` cookies. Log only the error name/code + decision via `edgeLogger` (no token values).
- [ ] 1.3 Integration/middleware negative-auth test in `src/__tests__/integration/middleware/`: a request to a gated path (`/dashboard`) carrying a revoked refresh token gets HTTP 307 to `/login?redirectTo=%2Fdashboard` AND `Set-Cookie` deletions for every `sb-*` cookie; a request to a public path (`/`) passes through but still emits the `sb-*` deletions; chunked cookies (`.0`, `.1`) are each deleted. Assert against the REAL GoTrue `refresh_token_not_found` error shape so a wording drift fails in CI.
- [ ] 1.4 Test (same suite) that a transient `getUser()` network/5xx error does NOT delete cookies and falls through to normal anonymous-pass (no logout on a blip).

## 2. signOut: explicit sb-* cookie deletion

- [ ] 2.1 In `src/modules/auth/server/logout.ts` (`signOutImpl`), after `signOut({ scope: 'global' })`, explicitly delete the `sb-*` cookies via the request cookie store, best-effort, before the existing `redirect('/login')` — independent of whether the remote `signOut` succeeded or wrote deletions.
- [ ] 2.2 Integration test: invoking `signOut` when the remote `signOut` returns an error / throws still deletes the `sb-*` cookies and redirects to `/login` (negative path proves the browser cannot retain a revoked refresh token).

## 3. Callback route: dedicated oauth_failed reason

- [ ] 3.1 In `src/app/(auth)/auth/callback/route.ts`, extend `FailureReason` to `'missing' | 'invalid' | 'unknown' | 'oauth_failed'`. Map the OAuth `exchange_failed` branch in `handleCodeExchange` to `redirectToError(request, 'oauth_failed')`; keep token-hash `verifyOtp` failures on `'invalid'`, missing params on `'missing'`, and other throws on `'unknown'`.
- [ ] 3.2 Route-handler test: an OAuth `exchange_failed` redirects to `/auth/callback/error?reason=oauth_failed`; a token-hash verify failure still redirects to `?reason=invalid`; missing params → `?reason=missing`.

## 4. Callback error page: copy differentiated by reason

- [ ] 4.1 Read `docs/design-system/rules.md` (once) for pt-BR copy guidelines. In `src/modules/registration/components/auth-callback-error.tsx`, extend `AuthCallbackError` to accept a `reason` prop and select pt-BR title/description per reason; keep `resendAction` optional (CTA renders only when present). `oauth_failed` copy references social/Google login and offers a "voltar ao login" path; the email reasons keep the existing email-verification copy. Preserve `data-testid="auth-callback-error"` and `data-testid="auth-callback-resend"`.
- [ ] 4.2 In `src/app/(auth)/auth/callback/error/page.tsx`, read `searchParams.reason`, pass it to `AuthCallbackError`, and pass `resendAction` ONLY for email-verification reasons (`missing` | `invalid` | `unknown`) — omit it for `oauth_failed`. Unknown/absent reason falls back to the generic email copy.
- [ ] 4.3 Unit/integration test: the error page renders distinct copy per `reason`; the resend CTA (`auth-callback-resend`) is present for `missing`/`invalid`/`unknown` and ABSENT for `oauth_failed`; an unknown/absent reason falls back to generic email copy without crashing.

## 5. Docs

- [ ] 5.1 If any new `data-testid` is introduced by the copy changes, document it in `docs/design-system/testid.md` (the existing `auth-callback-error` / `auth-callback-resend` ids are reused, so update only if new ids appear).
