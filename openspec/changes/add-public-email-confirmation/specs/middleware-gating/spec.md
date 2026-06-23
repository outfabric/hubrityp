## ADDED Requirements

### Requirement: Middleware classifies `/verifique-email` as public

The `classifyPath()` function in `src/middleware.ts` SHALL classify the exact path `/verifique-email` as the `public` PathClass, returning a `pass` decision for every session state (anonymous, OAuth-no-profile, `pending_verification`, `pending_crp_validation`, `active`, `active`+`requires_password_reset`, suspended/cancelled). This is required because a just-signed-up user reaches `/verifique-email` while anonymous (Supabase email confirmation returns no session); without an explicit `public` classification the anonymous request would be redirected to `/login`, reproducing the original defect. The strict prefix/exact-match check MUST prevent false matches such as `/verifique-emailx`. For suspended/cancelled sessions the `public` policy MAY clear the auth cookie (`clear-and-pass`) consistent with other public routes, but MUST still serve the page.

#### Scenario: Anonymous (just-signed-up) user reaches `/verifique-email`

- **WHEN** an anonymous client requests GET `/verifique-email`
- **THEN** the middleware returns `pass` (HTTP 200, no redirect to `/login`)

#### Scenario: Pending and rpr users still reach `/verifique-email`

- **WHEN** a `pending_verification` / `pending_crp_validation` user, or an `active` user with `requires_password_reset`, requests `/verifique-email`
- **THEN** the middleware returns `pass` and does not bounce them to onboarding/forgot-password

#### Scenario: Near-miss prefix is not treated as the confirmation route

- **WHEN** a request hits `/verifique-emailx`
- **THEN** it does NOT match the `/verifique-email` public classification via the strict exact/prefix+separator check

#### Scenario: Active user may also reach the page

- **WHEN** an `active` user requests `/verifique-email`
- **THEN** the middleware returns `pass` (the page itself shows generic guidance; it does not leak session state)
