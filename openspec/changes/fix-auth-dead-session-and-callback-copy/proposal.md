## Why

A psychologist who logged in with Google hit the error page "Não foi possível verificar seu email. O link de verificação expirou ou é inválido." The immediate trigger was stale browser cookie/cache state (clearing the cache resolved it), but the investigation (Supabase Auth + Vercel runtime logs) exposed **two latent bugs** that any user can hit and cannot self-recover from:

1. **Dead-session loop.** After a `/logout`, the browser stayed pinned to a revoked session for 30+ minutes: every SSR navigation (`/`, `/login`, `/dashboard`) and `/user` poll failed with `session_not_found` / `refresh_token_not_found` / `AuthApiError: Invalid Refresh Token: Refresh Token Not Found`. The logout and middleware did not actually delete the Supabase auth cookies in the browser, so the user looped on an invalid refresh token until they manually cleared cache — something an end-user psychologist does not know how to do.
2. **Misleading callback error copy.** `/auth/callback/error` shows the same "email verification expired" message for **every** callback failure — including OAuth/PKCE failures (in this incident `exchangeCodeForSession` failed with an empty `code_verifier`). This sent support/debug down the wrong path. The page already receives `?reason=missing|invalid|unknown` but ignores it.

## What Changes

- **Break the dead-session loop in the middleware.** When the per-request session resolution detects an invalid/missing refresh token (`refresh_token_not_found` / "Invalid Refresh Token"), the middleware MUST treat the user as anonymous, delete the `sb-*` auth cookies on the response (covering the chunked `sb-<ref>-auth-token.N` family), and apply the normal anonymous decision (pass on public, `→/login?redirectTo=…` on gated). It MUST NOT keep retrying the refresh.
- **Make `signOut` explicitly delete the `sb-*` cookies.** Beyond `signOut({ scope: 'global' })`, the action MUST explicitly clear the Supabase session cookies so a GoTrue 5xx (or any path where `signOut` does not write the deletions) can never strand the browser on a revoked refresh token.
- **Differentiate the callback error copy by `reason`.** `/auth/callback/error` MUST render copy coherent with `?reason` and distinguish an **email-verification** failure from an **OAuth/social login (PKCE)** failure. The route handler MUST emit a new `reason` value `oauth_failed` for the OAuth code-exchange path (instead of reusing `invalid`), and the resend-verification CTA MUST be shown only for the email-verification reasons — not for `oauth_failed`.
- **No domain rename and no Site URL change.** Both were considered and explicitly discarded; they are out of scope.

## Capabilities

### New Capabilities

- `auth-session-recovery`: Middleware + `signOut` behavior that detects an invalid/missing Supabase refresh token, deletes the `sb-*` session cookies (including chunked variants), and treats the request as anonymous — breaking the dead-session loop without weakening any auth gating.

### Modified Capabilities

- `authentication`: The `signOut` requirement and the middleware-gating requirement gain explicit obligations to clear `sb-*` cookies and to handle the invalid-refresh-token state as anonymous + cookie-clear (rather than looping). No change to the public/gated routing decisions themselves.
- `account-registration`: The "Email verification callback transitions account status" requirement is extended so the error page differentiates copy by `reason` and the route emits a dedicated `oauth_failed` reason for OAuth/PKCE failures, with the resend CTA gated to email-verification reasons only.

## Impact

- **Code**
  - `src/middleware.ts` — detect invalid-refresh-token state and emit `clear-and-pass` / `clear-and-redirect` for the anonymous-with-stale-cookie case; reuse the existing `clearSupabaseCookies` helper (already prefix-matches `sb-`, so chunked cookies are covered).
  - `src/shared/supabase/middleware.ts` — surface the refresh error from the cookie adapter / `getUser()` so the middleware can branch on it (Edge-safe; no Node-only deps).
  - `src/modules/auth/server/logout.ts` (`signOutImpl`) — explicit `sb-*` cookie deletion after `signOut`.
  - `src/app/(auth)/auth/callback/route.ts` — add `oauth_failed` to the failure-reason union and map the OAuth `exchange_failed` path to it (keep `invalid` for token-hash verify failures).
  - `src/app/(auth)/auth/callback/error/page.tsx` + `src/modules/registration/components/auth-callback-error.tsx` (`AuthCallbackError`) — branch pt-BR copy on `reason` and conditionally render the resend CTA.
- **Tests**
  - Integration/middleware negative-auth test: a request carrying a stale/invalid refresh token on a gated route is cleared (`Set-Cookie` deletions for `sb-*`) and redirected to `/login` — never looped.
  - Unit/integration test: `/auth/callback/error` copy varies by `reason` (`missing` | `invalid` | `unknown` | `oauth_failed`) and the resend CTA is hidden for `oauth_failed`.
  - Route-handler test: an OAuth `exchange_failed` redirects to `…/error?reason=oauth_failed`.
- **Security/LGPD**: no auth gating is loosened; cookie clearing is delete-only on the `sb-` prefix (no open-redirect, no PII in logs). Refresh-token error names are logged without values, per existing edge-logger policy.
- **No DB/migration impact.** No schema, RLS, or external-integration changes.
