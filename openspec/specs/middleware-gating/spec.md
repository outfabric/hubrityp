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
