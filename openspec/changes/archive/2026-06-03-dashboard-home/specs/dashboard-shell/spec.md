## MODIFIED Requirements

### Requirement: Authenticated dashboard is the operational home
The system SHALL provide a `/dashboard` route under the `(app)` route group that renders the authenticated psychologist's operational dashboard (the four sections defined by the `dashboard-home` capability). The authenticated shell (greeting + logout control in the layout) is retained, but the dashboard page body is the operational dashboard rather than a bare greeting. Anonymous access MUST still be redirected by the middleware.

#### Scenario: Authenticated psychologist sees the operational dashboard

- **GIVEN** a psychologist with `status = active` is signed in
- **WHEN** they visit `/dashboard`
- **THEN** the page renders the four operational sections (Hoje, Pendências, Resumo da semana, Ações rápidas) and the authenticated shell still exposes the logout control

#### Scenario: Anonymous user is redirected away

- **WHEN** an anonymous client visits `/dashboard`
- **THEN** the middleware redirects to `/login?redirectTo=%2Fdashboard`

#### Scenario: Non-active profile is bounced to onboarding

- **GIVEN** a signed-in user whose profile status is not `active`
- **WHEN** they reach the dashboard render path
- **THEN** they are redirected to `/onboarding/pending` (defense-in-depth mirroring the middleware gate)
