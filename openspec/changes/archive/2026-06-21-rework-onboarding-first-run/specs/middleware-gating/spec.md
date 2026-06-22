## ADDED Requirements

### Requirement: Active psychologist with incomplete onboarding is redirected to the wizard
The system SHALL, in `src/middleware.ts` `decideWithProfile()`, redirect an authenticated psychologist with `status = active`, `requires_password_reset = false`, and **incomplete onboarding** to `/onboarding/welcome` instead of letting them reach the dashboard or other app surfaces. Onboarding is considered complete (a "soft gate") when `onboarding_step === 'done'` **OR** `onboarding_completed_at IS NOT NULL`. While onboarding is incomplete, requests classified as `app`, `onboarding` (pending), `auth`, `complete-profile`, or `link-account` SHALL redirect to `/onboarding/welcome`; requests classified as `onboarding-wizard` or `reset-password` SHALL pass. Once onboarding is complete, the prior behavior is preserved (app passes; auth/onboarding/wizard bounce to `/dashboard`). The condition MUST be evaluated on the Edge from fields already loaded by `getCurrentProfileEdge` (`onboarding_step`, `onboarding_completed_at`) — no new data-layer read. The `requires_password_reset` guard keeps priority and is unchanged.

#### Scenario: Incomplete onboarding on the dashboard is sent to the wizard
- **GIVEN** an authenticated psychologist with `status = active`, `requires_password_reset = false`, `onboarding_completed_at IS NULL`, and `onboarding_step = 'location'`
- **WHEN** they request `/dashboard`
- **THEN** the middleware redirects to `/onboarding/welcome` (reason `active-onboarding-incomplete`)

#### Scenario: Soft gate opens after skipping
- **GIVEN** an authenticated active psychologist with `onboarding_step = 'done'` and `onboarding_completed_at IS NULL`
- **WHEN** they request `/dashboard`
- **THEN** the request passes through to the dashboard (the skip satisfies the soft gate)

#### Scenario: Completed onboarding reaches the app normally
- **GIVEN** an authenticated active psychologist with `onboarding_completed_at` set
- **WHEN** they request `/agenda`
- **THEN** the request passes through

#### Scenario: Incomplete onboarding pass through the wizard without a loop
- **GIVEN** an authenticated active psychologist with incomplete onboarding
- **WHEN** they request `/onboarding/welcome` or `/onboarding/setup/profile`
- **THEN** the request passes (the wizard is reachable so the redirect target never loops)

## MODIFIED Requirements

### Requirement: Middleware classifies and gates onboarding wizard routes
The system SHALL classify the onboarding wizard routes under a **dedicated path class** (`onboarding-wizard`) in `src/middleware.ts` `classifyPath()`, distinct from the general gated `app` class. The prefixes `/onboarding/welcome` and `/onboarding/setup` SHALL resolve to this class (removed from `APP_PREFIXES`) so the "incomplete onboarding → `/onboarding/welcome`" redirect cannot self-redirect into a loop. For non-active statuses the class MUST reproduce exactly the prior `app`-class behavior: anonymous requests are redirected to `/login?redirectTo=<path>`, `pending_*` users are redirected to `/onboarding/pending`, and suspended/cancelled sessions are cleared and redirected to `/login`. Active psychologists may access the wizard. The strict prefix check (exact match OR prefix + `/` separator) MUST prevent false matches such as `/onboarding/welcomex`.

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
- **THEN** it does NOT match the `/onboarding/welcome` wizard class via the strict prefix+separator check
