# middleware-gating Specification

## Purpose

Extends the Edge middleware's `classifyPath()` function to gate all authenticated route prefixes (`/pacientes`, `/agenda`, `/caixa-de-entrada`, `/configuracoes`) as PathClass `'app'`, ensuring unauthenticated users are redirected to `/login` and status-based rules apply consistently across the entire authenticated surface. Created by archiving change `prontuario-foundation-and-evolutions`.

## Requirements

### Requirement: Middleware classifies /pacientes as app (gated)

The system SHALL classify all paths starting with `/pacientes` as PathClass `'app'` in `classifyPath()`. This ensures unauthenticated users are redirected to `/login` and status-based rules (pending, suspended, etc.) apply per the existing decision table.

#### Scenario: Unauthenticated GET to /pacientes redirects to login

- **WHEN** an unauthenticated user requests GET `/pacientes/abc-123/prontuario`
- **THEN** middleware returns a 307 redirect to `/login?redirectTo=%2Fpacientes%2Fabc-123%2Fprontuario`

#### Scenario: Unauthenticated GET to /pacientes root redirects to login

- **WHEN** an unauthenticated user requests GET `/pacientes`
- **THEN** middleware returns a 307 redirect to `/login?redirectTo=%2Fpacientes`

#### Scenario: Active authenticated user passes through to /pacientes

- **WHEN** an authenticated user with status Active (no password reset) requests `/pacientes/abc`
- **THEN** middleware returns pass (no redirect)

### Requirement: Middleware classifies /agenda as app (gated)

The system SHALL classify all paths starting with `/agenda` as PathClass `'app'` in `classifyPath()`.

#### Scenario: Unauthenticated GET to /agenda redirects to login

- **WHEN** an unauthenticated user requests GET `/agenda`
- **THEN** middleware returns a 307 redirect to `/login?redirectTo=%2Fagenda`

#### Scenario: Active authenticated user passes through to /agenda

- **WHEN** an authenticated user with status Active requests `/agenda`
- **THEN** middleware returns pass

### Requirement: Middleware classifies /caixa-de-entrada as app (gated)

The system SHALL classify all paths starting with `/caixa-de-entrada` as PathClass `'app'` in `classifyPath()`.

#### Scenario: Unauthenticated GET to /caixa-de-entrada redirects to login

- **WHEN** an unauthenticated user requests GET `/caixa-de-entrada`
- **THEN** middleware returns a 307 redirect to `/login?redirectTo=%2Fcaixa-de-entrada`

#### Scenario: Active authenticated user passes through to /caixa-de-entrada

- **WHEN** an authenticated user with status Active requests `/caixa-de-entrada`
- **THEN** middleware returns pass

### Requirement: Middleware classifies /configuracoes as app (gated)

The system SHALL classify all paths starting with `/configuracoes` as PathClass `'app'` in `classifyPath()`.

#### Scenario: Unauthenticated GET to /configuracoes redirects to login

- **WHEN** an unauthenticated user requests GET `/configuracoes`
- **THEN** middleware returns a 307 redirect to `/login?redirectTo=%2Fconfiguracoes`

#### Scenario: Active authenticated user passes through to /configuracoes

- **WHEN** an authenticated user with status Active requests `/configuracoes/perfil`
- **THEN** middleware returns pass

### Requirement: Existing /dashboard gating is unchanged

The system SHALL NOT alter the behavior for paths starting with `/dashboard`. The defensive sweep adds new prefixes without modifying existing classification logic.

#### Scenario: /dashboard still classified as app

- **WHEN** an unauthenticated user requests GET `/dashboard`
- **THEN** middleware returns a 307 redirect to `/login?redirectTo=%2Fdashboard` (existing behavior preserved)

#### Scenario: Boundary path /dashboardnews remains public

- **WHEN** an unauthenticated user requests GET `/dashboardnews`
- **THEN** middleware returns pass (the strict prefix check with separator prevents false matches)

### Requirement: Middleware classifies authenticated route prefixes

The `classifyPath()` function in `src/middleware.ts` SHALL classify the following URL prefixes as `'app'` (authenticated): `/pacientes`, `/agenda`, `/caixa-de-entrada`, `/configuracoes`, `/dashboard`, `/sessao`. The `/sessao` prefix SHALL be added to `APP_PREFIXES` so that all `/sessao/*` routes are gated by the auth decision table.

#### Scenario: Anonymous access to /sessao/[id]/video is redirected

- **WHEN** an unauthenticated user requests `/sessao/some-uuid/video`
- **THEN** the middleware redirects to `/login`

#### Scenario: Authenticated access to /sessao/[id]/video passes through

- **WHEN** an authenticated psychologist with active profile requests `/sessao/some-uuid/video`
- **THEN** the middleware allows the request to pass through

### Requirement: Middleware classifies `/dashboard/transcricoes` as app (gated)

The system SHALL ensure `src/middleware.ts:classifyPath()` returns `'app'` for any URL whose pathname matches `^/dashboard/transcricoes(/|$)`. The classification SHALL be added in the same prefix table that already covers `/dashboard*`, and SHALL be exercised by integration tests in the `middleware` suite. The `decideWithProfile` function continues to enforce the per-user-status policy.

#### Scenario: Anonymous request to the list page is redirected

- **WHEN** an anonymous client requests `/dashboard/transcricoes`
- **THEN** the middleware returns a 307 redirect to `/login?from=/dashboard/transcricoes`

#### Scenario: Anonymous request to the review subpath is redirected

- **WHEN** an anonymous client requests `/dashboard/transcricoes/abc-123/revisar`
- **THEN** the middleware returns a 307 redirect to `/login?from=/dashboard/transcricoes/abc-123/revisar`

#### Scenario: Authenticated `Active` user passes through

- **GIVEN** a valid session for an `Active` profile
- **WHEN** the user requests `/dashboard/transcricoes`
- **THEN** the middleware passes through and the page renders

#### Scenario: Suspended user is redirected to suspension state per existing decision table

- **GIVEN** a session for a `Suspended` profile
- **WHEN** the user requests `/dashboard/transcricoes`
- **THEN** the middleware honors the existing `Suspended` policy (clear-and-redirect to the suspension state, as documented in the comment table at the top of `middleware.ts`)

#### Scenario: PendingVerification / PendingCrpValidation users follow their existing routing

- **WHEN** a user in either of those statuses requests `/dashboard/transcricoes`
- **THEN** the middleware applies the same rule it currently applies to other `/dashboard*` routes for those statuses

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
