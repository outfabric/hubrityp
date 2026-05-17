## ADDED Requirements

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
