## ADDED Requirements

### Requirement: Middleware classifies `/dashboard/transcricoes` as app (gated)

The system SHALL ensure `src/middleware.ts:classifyPath()` returns `'app'` for any URL whose pathname matches `^/dashboard/transcricoes(/|$)`. The classification SHALL be added in the same prefix table that already covers `/dashboard*`, and SHALL be exercised by integration tests in the `middleware` suite.

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
