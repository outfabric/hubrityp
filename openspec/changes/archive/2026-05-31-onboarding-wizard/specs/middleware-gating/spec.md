## MODIFIED Requirements

### Requirement: Middleware classifies and gates onboarding wizard routes
The system SHALL classify the new onboarding wizard routes as gated app surfaces in `src/middleware.ts` `classifyPath()`. The prefixes `/onboarding/welcome` and `/onboarding/setup` SHALL resolve to a gated path class so that anonymous requests are redirected to `/login?redirectTo=<path>` and only authenticated psychologists reach them. This extends the existing decision table: the new prefixes follow the same rules as the existing `/onboarding/pending` onboarding class for non-active statuses (pending users still see `/onboarding/pending`), while `active` users may access the wizard. The strict prefix check (exact match OR prefix + `/` separator) MUST prevent false matches such as `/onboarding/welcomex`.

#### Scenario: Anonymous request to a wizard route is redirected
- **WHEN** an anonymous client requests `/onboarding/setup/profile`
- **THEN** the middleware redirects to `/login?redirectTo=%2Fonboarding%2Fsetup%2Fprofile`

#### Scenario: Active psychologist reaches the wizard
- **GIVEN** an authenticated psychologist with `status = active` and `requires_password_reset = false`
- **WHEN** they request `/onboarding/welcome`
- **THEN** the request passes through to the page

#### Scenario: Pending psychologist is bounced to pending onboarding
- **GIVEN** an authenticated psychologist with `status = pending_crp_validation`
- **WHEN** they request `/onboarding/setup/profile`
- **THEN** the middleware redirects to `/onboarding/pending`

#### Scenario: Near-miss prefix is not gated by accident
- **WHEN** a request hits `/onboarding/welcomex`
- **THEN** it does NOT match the `/onboarding/welcome` gated class via the strict prefix+separator check
