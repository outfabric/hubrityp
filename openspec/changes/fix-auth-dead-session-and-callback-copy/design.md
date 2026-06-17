## Context

The root middleware (`src/middleware.ts`, Edge runtime) refreshes the Supabase session cookie on every navigation via `createMiddlewareClient` (`src/shared/supabase/middleware.ts`) and then gates the route. `getCurrentProfileEdge(supabase)` internally calls `supabase.auth.getUser()`; when the profile is null the middleware calls `getUser()` again to distinguish OAuth-without-profile from the email-signup race window.

When the browser holds a **revoked or expired refresh token**, `@supabase/ssr`'s lazy session load attempts a refresh against GoTrue, which returns `AuthApiError: Invalid Refresh Token: Refresh Token Not Found` (`code: refresh_token_not_found`). Today the middleware swallows this into a `null` user and treats the request as plain anonymous — but it does **not delete** the stale `sb-*` cookies. So the very next navigation re-sends the same dead token, GoTrue rejects it again, and the user loops on the auth screens until they manually clear cache. `signOut` has the same gap: `signOut({ scope: 'global' })` revokes the token server-side and is *supposed* to write cookie deletions through the adapter, but any failure path (GoTrue 5xx, adapter not flushing on the Edge) leaves the deletions unwritten.

Separately, the `/auth/callback` route handler maps every failure to `?reason=missing|invalid|unknown`, and `/auth/callback/error` (`AuthCallbackError` in `@/modules/registration`) renders one fixed "email verification expired" card regardless of `reason`. For an OAuth/PKCE failure (`exchangeCodeForSession` with empty `code_verifier`), the route currently emits `reason=invalid` and the user sees email-verification copy that does not match what they did (they clicked "Login with Google"), plus a resend-verification CTA that is meaningless for OAuth.

Per `@supabase/ssr` docs: cookies are named `sb-<project-ref>-auth-token` and chunk into `sb-<ref>-auth-token.0`, `.1`, … when large. The existing `clearSupabaseCookies` helper already deletes by `sb-` prefix, so it covers the chunked family. `getUser()` returns the failure in the `error` property (and can also throw on network errors) — both must be handled.

## Goals / Non-Goals

**Goals:**
- A request carrying an invalid/missing refresh token is recognized, its `sb-*` cookies are deleted on the response, and it is handled as anonymous (`pass` on public, `→/login?redirectTo=…` on gated) — never looped.
- `signOut` always deletes the `sb-*` cookies, even when the remote `signOut` call fails.
- `/auth/callback/error` copy matches the `reason`, and OAuth/PKCE failures get a dedicated `oauth_failed` reason whose copy talks about social login (not email) and hides the resend-verification CTA.
- Negative-auth test proves the stale-token request is cleared + redirected (not looped); copy tests prove per-`reason` rendering.

**Non-Goals:**
- No domain rename, no Supabase Site URL / redirect-URL change (explicitly discarded).
- No change to the public/gated routing decision table itself — only the handling of the stale-cookie sub-case is added.
- No new DB tables, migrations, RLS, or external integrations.
- No change to how valid sessions are refreshed.

## Decisions

**1. Detect the invalid-refresh-token state in the middleware, reusing the existing cookie-clear path.**
`createMiddlewareClient` will surface whether the last `getUser()`/refresh resolved with an "invalid refresh token" error (matching on the stable `error.code === 'refresh_token_not_found'` or the `AuthApiError` name/message for "Invalid Refresh Token", per Context7-confirmed `@supabase/ssr` behavior). When that flag is set AND the resolved user is null, the middleware treats the request as anonymous **and** emits `clear-and-pass` (public paths) or `clear-and-redirect` to `/login?redirectTo=…` (gated paths), reusing the already-tested `clearSupabaseCookies` + `buildRedirect` machinery that suspended/cancelled accounts use.
- *Why over alternative (clear cookies only in `signOut`):* the loop is reproducible without any logout — an externally revoked token (concurrent-device logout, GoTrue session expiry) reaches the middleware directly. The fix must live where every navigation passes.
- *Why reuse `clear-and-*`:* it is already proven to copy cookie deletions onto both `pass` and 307 redirects on the Edge; introducing a parallel path risks dropping deletions on token rotation.

**2. Keep the detection Edge-safe and error-shape tolerant.**
The check keys off the `error.code` string and the error `name`/`message`, never on Node-only APIs. We do not import the Supabase error class; we match defensively (`code === 'refresh_token_not_found'` OR message includes "Invalid Refresh Token") so a minor GoTrue wording change still trips the guard.
- *Why:* the middleware bundle must not pull Node-only deps (the whole reason `edge.ts` exists), and the error surface is documented but versioned.

**3. Explicit `sb-*` deletion in `signOutImpl`.**
After `signOut({ scope: 'global' })`, `signOutImpl` will explicitly delete the `sb-*` cookies via the request cookie store (best-effort, before the existing `redirect('/login')`), independent of whether the adapter flushed deletions. This is belt-and-suspenders consistent with the middleware's "clear regardless of signOut outcome" stance.
- *Why over trusting `signOut`:* the incident showed deletions not landing in the browser; defense-in-depth dictates the cookie clear must not depend on a successful remote call.

**4. New `oauth_failed` reason, copy branches on `reason`, resend CTA gated.**
The route handler's `FailureReason` union gains `'oauth_failed'`; the OAuth `exchange_failed` branch maps to it (token-hash verify failures keep `'invalid'`). `/auth/callback/error/page.tsx` reads `searchParams.reason`, picks pt-BR copy per reason, and passes `resendAction` to `AuthCallbackError` **only** for email-verification reasons (`missing` | `invalid` | `unknown`), not for `oauth_failed`. `AuthCallbackError` already supports an optional `resendAction` (renders the CTA only when present), so the component needs a `reason`-driven title/description but no structural change.
- *Why a distinct reason instead of new copy keyed on the existing `invalid`:* `invalid` is shared by token-hash email verification failures, which legitimately should keep the email copy + resend CTA. Splitting the OAuth path into its own reason keeps both messages correct.
- *Why keep the `data-testid="auth-callback-error"` and `auth-callback-resend` ids:* existing tests and `docs/design-system/testid.md` reference them; the resend id simply won't render for `oauth_failed`.

**5. No PII in logs.** Refresh-token detection logs only the error name/code and the decision, never token values — consistent with the existing edge-logger policy and the LGPD mandate.

## Risks / Trade-offs

- **[Over-clearing cookies on a transient GoTrue 5xx]** A network blip during refresh could be misread as "invalid refresh token" and log the user out. → Mitigation: gate the clear strictly on the invalid-refresh-token signal (`refresh_token_not_found` / "Invalid Refresh Token"), NOT on generic `getUser()` errors or thrown network errors; a 5xx/timeout surfaces as a different error shape and is left to the normal anonymous-pass path without deleting cookies.
- **[GoTrue changes the error wording/code]** The match could stop firing. → Mitigation: match on both the stable `code` and a substring of the message; add an integration test asserting on the real error so a drift surfaces in CI rather than in production.
- **[Edge cookie semantics]** Deletions might not apply identically on the Edge. → Mitigation: reuse the exact `clearSupabaseCookies` + `buildRedirect`/`response` flow already validated for suspended/cancelled flows (which delete `sb-*` on the Edge today).
- **[Copy regression for token-hash email failures]** Splitting reasons could accidentally drop the resend CTA for legitimate email verification. → Mitigation: explicit test matrix — `missing`/`invalid`/`unknown` show the resend CTA; only `oauth_failed` hides it.
- **[Trade-off: belt-and-suspenders cookie clearing in two places]** Slight duplication between middleware and `signOut`. Accepted: they cover different entry points (middleware = every navigation incl. externally revoked tokens; `signOut` = explicit logout), and both are cheap delete-only operations.

## Migration Plan

Pure code change, no data migration. Deploy is forward-only; rollback is a straight revert of the PR (no schema/state to undo). Because the change only *adds* a cookie-clear branch and a new `reason` value, an old client mid-flight degrades gracefully: an unknown `reason` falls back to the generic email-verification copy (current behavior).

## Open Questions

- None blocking. The exact pt-BR wording per `reason` will follow the Sálvia copy guidelines (`docs/design-system/rules.md`) and be finalized during implementation; the `oauth_failed` copy must reference "login com o Google / login social" and offer a "voltar ao login" path instead of "reenviar email".
