## ADDED Requirements

### Requirement: Middleware classifies public marketing and legal routes

The middleware `classifyPath()` SHALL explicitly classify the public marketing and legal routes — `/` (exact), `/precos`, `/politica-de-privacidade`, and `/termos-de-uso` — as the `public` PathClass, returning a `pass` decision for every session state (anonymous, OAuth-no-profile, pending, active, active+rpr, suspended/cancelled). The explicit classification (rather than relying on the default-public fallthrough) prevents accidental gating if the classifier is ever refactored to default-deny. The same `pass` behavior MUST apply to unknown public paths that resolve to the 404.

#### Scenario: Anonymous visitor reaches every public route

- **WHEN** an anonymous client requests `/`, `/precos`, `/politica-de-privacidade`, or `/termos-de-uso`
- **THEN** the middleware returns `pass` (HTTP 200, no redirect to `/login`)

#### Scenario: Pending and rpr users still reach public routes

- **WHEN** a `pending_*` user or an `active` user with `requires_password_reset` requests a public marketing/legal route
- **THEN** the middleware returns `pass` and does not bounce them to onboarding/forgot-password

#### Scenario: Suspended/cancelled session is cleared but page still served

- **WHEN** a suspended or cancelled session requests a public route
- **THEN** the middleware clears the auth cookie (`clear-and-pass`) and the public page renders

### Requirement: Authenticated visitors are not redirected from marketing pages

The middleware SHALL NOT redirect an authenticated active user away from public marketing/legal pages. An active user visiting `/` or `/precos` stays on the page (the header offers "Acessar plataforma"); only the explicitly gated `(app)` prefixes redirect active users.

#### Scenario: Active user stays on the homepage

- **WHEN** an authenticated active user requests `/`
- **THEN** the middleware returns `pass` and the homepage renders (no redirect to `/dashboard`)

#### Scenario: Near-miss paths are not falsely classified

- **WHEN** a request targets a path that merely shares a prefix with a public route but is distinct (e.g. `/precos-internos`)
- **THEN** classification does not falsely match the public route via a substring; matching uses exact or prefix-with-separator semantics consistent with the existing classifier
