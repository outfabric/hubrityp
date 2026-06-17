## ADDED Requirements

### Requirement: Middleware breaks the dead-session loop on an invalid refresh token

The system SHALL detect, in the root `middleware.ts`, when the per-request Supabase session resolution fails because the refresh token is missing or revoked (GoTrue `error.code = 'refresh_token_not_found'`, or an `AuthApiError` whose message contains "Invalid Refresh Token"). When this state is detected and no verified user is resolved, the middleware MUST treat the request as anonymous, delete every `sb-*` auth cookie on the outgoing response (covering the chunked `sb-<project-ref>-auth-token.N` family via the existing `sb-` prefix deletion), and apply the normal anonymous routing decision (pass on public paths; HTTP 307 to `/login?redirectTo=<path>` on gated paths). The middleware MUST NOT re-attempt the refresh or pass the stale cookies through unchanged.

The detection MUST be Edge-safe (no Node-only dependencies) and MUST NOT trip on generic `getUser()` errors such as network timeouts or GoTrue 5xx responses — only the invalid/missing refresh-token signal triggers the cookie clear, so a transient outage does not log a valid user out.

No PII, token, or refresh-token value is logged; only the error name/code and the resolved decision are recorded via the edge logger.

#### Scenario: Stale refresh token on a gated path is cleared and redirected, not looped

- **GIVEN** a request to `/dashboard` carrying `sb-<ref>-auth-token` cookies whose refresh token has been revoked (GoTrue returns `refresh_token_not_found`)
- **WHEN** the middleware resolves the session
- **THEN** the response is HTTP 307 to `/login?redirectTo=%2Fdashboard` AND carries `Set-Cookie` deletions for every `sb-*` cookie present on the request, so the next navigation no longer sends a dead token

#### Scenario: Stale refresh token on a public path is cleared and passed through

- **GIVEN** a request to `/` carrying a revoked `sb-*` refresh token
- **WHEN** the middleware resolves the session
- **THEN** the request passes through (no redirect) AND the response carries `Set-Cookie` deletions for the `sb-*` cookies, leaving the browser logged out cleanly

#### Scenario: Chunked auth-token cookies are all deleted

- **GIVEN** a request carrying chunked cookies `sb-<ref>-auth-token.0` and `sb-<ref>-auth-token.1` with a revoked refresh token
- **WHEN** the middleware clears the session
- **THEN** the response emits a deletion for each `sb-*` cookie (every chunk), not only the base cookie

#### Scenario: Transient GoTrue error does not clear a session

- **GIVEN** a request with a valid `sb-*` session whose refresh momentarily fails with a network/5xx error (not `refresh_token_not_found`)
- **WHEN** the middleware resolves the session
- **THEN** the middleware does NOT delete the `sb-*` cookies and applies the normal anonymous-pass behavior, so a blip does not strand the user logged out

### Requirement: `signOut` explicitly deletes the Supabase session cookies

The system SHALL make `signOutImpl` delete the `sb-*` auth cookies explicitly after calling `supabase.auth.signOut({ scope: 'global' })`, independent of whether the remote `signOut` call succeeded or wrote cookie deletions through the `@supabase/ssr` adapter. The deletion is best-effort and MUST NOT prevent the redirect to `/login`.

#### Scenario: Logout deletes sb-* cookies even when remote signOut fails

- **GIVEN** an authenticated request invoking `signOut`
- **WHEN** `supabase.auth.signOut({ scope: 'global' })` returns an error or throws (e.g., GoTrue 5xx)
- **THEN** `signOutImpl` still explicitly deletes the `sb-*` cookies and redirects to `/login`, so the browser cannot retain a revoked refresh token
