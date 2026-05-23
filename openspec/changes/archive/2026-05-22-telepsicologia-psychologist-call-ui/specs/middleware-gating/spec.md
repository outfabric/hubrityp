## MODIFIED Requirements

### Requirement: Middleware classifies authenticated route prefixes
The `classifyPath()` function in `src/middleware.ts` SHALL classify the following URL prefixes as `'app'` (authenticated): `/pacientes`, `/agenda`, `/caixa-de-entrada`, `/configuracoes`, `/dashboard`, `/sessao`. The `/sessao` prefix SHALL be added to `APP_PREFIXES` so that all `/sessao/*` routes are gated by the auth decision table.

#### Scenario: Anonymous access to /sessao/[id]/video is redirected
- **WHEN** an unauthenticated user requests `/sessao/some-uuid/video`
- **THEN** the middleware redirects to `/login`

#### Scenario: Authenticated access to /sessao/[id]/video passes through
- **WHEN** an authenticated psychologist with active profile requests `/sessao/some-uuid/video`
- **THEN** the middleware allows the request to pass through
