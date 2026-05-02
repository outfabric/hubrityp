# Spec — health-endpoints

## ADDED Requirements

### Requirement: Public health endpoint reports app and database status

The system SHALL expose `GET /api/health` as a public Route Handler that responds with a JSON body indicating overall health, database reachability, and a server-side timestamp. The endpoint MUST NOT require authentication and MUST NOT include any sensitive data.

#### Scenario: Healthy response when database is reachable

- **WHEN** the application server is running and the database is reachable
- **THEN** `GET /api/health` returns HTTP 200 and a JSON body with shape `{ ok: true, db: 'reachable', timestamp: <ISO 8601 string> }`

#### Scenario: Unhealthy response when the database is unreachable

- **WHEN** the database connection fails (e.g., Postgres down)
- **THEN** `GET /api/health` returns HTTP 503 and a JSON body with shape `{ ok: false, db: 'unreachable', timestamp: <ISO 8601 string> }`

#### Scenario: No authentication required

- **WHEN** an anonymous client requests `/api/health`
- **THEN** the endpoint responds without consulting the session and does not set any auth-related cookies

#### Scenario: No PII or secrets in the response

- **WHEN** any response is inspected
- **THEN** the body contains only the documented keys (`ok`, `db`, `timestamp`) and never includes user data, env values, or stack traces

### Requirement: Authenticated `me` endpoint reflects the active session

The system SHALL expose `GET /api/me` as an authenticated Route Handler that responds with the active user's `userId` and `email`, or 401 when no valid session exists.

#### Scenario: Authenticated request returns user identity

- **GIVEN** a valid Supabase session cookie attached to the request
- **WHEN** `GET /api/me` is called
- **THEN** the response is HTTP 200 with body `{ userId: <uuid>, email: <string> }`

#### Scenario: Unauthenticated request returns 401

- **WHEN** `GET /api/me` is called without a valid session
- **THEN** the response is HTTP 401 with body `{ ok: false, error: 'unauthenticated' }`

#### Scenario: Endpoint reads identity from session, not from input

- **WHEN** any request includes query params or headers attempting to override the user identity
- **THEN** the endpoint ignores them and returns the identity associated with the session cookie

### Requirement: Health endpoint exercises the Drizzle data path

The system SHALL implement the `db: 'reachable'` check by issuing a real query through Drizzle (e.g., `SELECT 1` or a count against `health_pings`). The check MUST NOT be a static literal and MUST fail if the database is genuinely unreachable.

#### Scenario: Probe is a real query

- **WHEN** the integration test for `/api/health` runs against a paused Postgres
- **THEN** the response indicates `db: 'unreachable'` rather than `db: 'reachable'`
