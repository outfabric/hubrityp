---
name: e2e-dedicated-user-refresh-token
description: seeded e2e dedicated users (register-oauth-user + cookie) need a UNIQUE refresh token or a Server Action's server-side getUser refresh resolves the wrong user
metadata:
  type: feedback
---

When a seeded e2e spec drives a DEDICATED user (registered at runtime via
`POST /_test/register-oauth-user` + a hand-built Supabase cookie, the pattern
dashboard-home.spec uses for its zero-data user), READS work fine but a Server
Action that calls `supabase.auth.getUser()` server-side can resolve the WRONG
user (or null), so an owner-scoped UPDATE silently matches 0 rows.

**Why:** the mock GoTrue (`setup/mock-gotrue.ts`) had NO `grant_type=refresh_token`
branch — a server-side refresh fell through to the default seeded identity. Every
dedicated user also shared `refresh_token='mock-refresh-token'`, so even a refresh
branch could not disambiguate them. The page render didn't refresh (fresh token),
but the action request could, returning a different user.

**How to apply:** give each dedicated user a UNIQUE refresh token. The mock now has
a `refresh_token` grant branch that resolves the registered user by that token (and
re-issues its jwt); the shared helper
`src/__tests__/e2e/seeded/_shared/dedicated-user-auth.ts:signInAsDedicatedUser`
mints `mock-refresh-<userId>-<ts>` and passes it to both `register-oauth-user`
(new `refreshToken` field on `RegisteredOAuthUser`) and `setSession`. Reuse that
helper for any new dedicated-user spec instead of re-inlining the handshake.

Related: [[e2e-action-binding-race-ssr-false]].
