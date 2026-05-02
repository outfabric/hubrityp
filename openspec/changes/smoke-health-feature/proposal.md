# Proposal — smoke-health-feature

## Why

Waves 1 and 2 build the entire infrastructure required by `/dev-cycle`, but the orchestrator itself has never been exercised end to end (orchestrator → `fullstack-developer` → `code-reviewer` → `qa-tester` → semantic commits → PR). Without a trivial feature that touches all three test layers and has a navigable UI, latent bugs in the orchestrator, the agent prompts, or the test skills surface only on the first real domain feature — where rework is expensive and the cost of unwinding decisions is high.

This wave is the **first real invocation of `/dev-cycle`** and serves as a living proof of the cycle. It also introduces the `@auth-real` e2e suite (real `supabase start` + gotrue handshake) that was deferred from wave 2, because a real test now exists to justify it.

The feature itself is intentionally minimal: a public health endpoint, an authenticated `me` endpoint, a login page, and a placeholder dashboard with logout. Just enough surface area to exercise the orchestrator without introducing domain complexity.

## What Changes

### Endpoints
- `GET /api/health` (public): returns `{ ok: true, db: 'reachable', timestamp }`. Performs a Drizzle ping against `health_pings` (count or simple `select 1`).
- `GET /api/me` (authenticated): returns `{ userId, email }` from the active Supabase session; returns 401 when no session exists.

### UI
- `/login` — Server Component rendering a client form (React Hook Form + Zod) for email/password.
- Server Action `signIn` delegating to `@supabase/ssr` and redirecting to `/dashboard` on success.
- `/dashboard` — Server Component protected by `middleware.ts`, renders "Olá, {email}" plus a logout button.
- Server Action `signOut` clearing the session and redirecting to `/login`.
- Both pages use shadcn/ui primitives (`Button`, `Input`, `Label`, `Card`) — installed as needed via `npx shadcn add`.
- Stable `data-testid` conventions established here will be the template for future features (documented in `docs/design-system/` or appended to it).

### Tests (covering tags `[unit] [integration] [e2e]`)

- **`[unit]`**
  - Zod schema for the login form (valid email, password length).
  - Mapper `supabaseUser → appUser` (shape conversion + null safety).

- **`[integration]`**
  - Server Actions `signIn` / `signOut` tested with `@supabase/ssr` mocked at the boundary, asserting cookie writes and redirect targets.
  - `GET /api/me` against a real Postgres (Testcontainers) with simulated JWT — exercises RLS via `runAsUser`.
  - `GET /api/health` against a real Postgres — confirms the Drizzle ping query works against the schema applied by migrations.

- **`[e2e]` (default suite, simulated auth via `storageState`)**
  - Tag `@health`: anonymous visit to `/api/health` returns 200 with the expected JSON shape.
  - Tag `@auth`: visiting `/dashboard` redirects to `/login`; with `storageState` populated, `/dashboard` renders "Olá, {email}"; logout clears state and redirects to `/login`.

- **`[e2e]` (real auth suite, `supabase start` + real gotrue)**
  - Tag `@auth-real`: full handshake — visit `/login`, fill the form with a seeded user (created via Supabase Admin API or direct insert into `auth.users` with hashed password), submit, land on `/dashboard`, click logout, return to `/login`. This proves the `signIn` Server Action works against real auth, not just mocked.

### Scripts and CI
- New npm script `test:e2e:real`: boots `supabase start`, runs Playwright with `--grep @auth-real` against a separate config (or an env var that swaps `globalSetup`).
- New CI job `e2e-real`: starts Supabase locally via the CLI, runs `npm run test:e2e:real`. Slower than the default e2e job; gated on the default e2e job passing first to fail fast.
- Update `e2e/tags.json` registering `@auth` and `@auth-real`.

### Documentation
- Update `docs/design-system/` (or create the appropriate doc) with the chosen `data-testid` convention and the route-group layout pattern (`app/(auth)/login`, `app/(app)/dashboard` or whatever shape emerges).
- Update `README.md` noting the existence of `test:e2e:real` and when it is appropriate to run it locally.

## Non-goals

Out of scope for this wave:

- Signup, password reset, OAuth, magic links.
- Onboarding flow (separate PRD, future change).
- Final dashboard layout, navigation shell, sidebar, theming choices beyond the shadcn defaults.
- Any domain feature (patients, calendar, payments, prontuário, etc.).
- Rate limiting on `/api/me` or `/login` (track separately).
- Custom 404 / 500 / error boundary pages beyond Next.js defaults.
- Observability (OpenTelemetry, Sentry).
- Email verification gating.

## Impact

### Affected areas
- New routes: `app/api/health/route.ts`, `app/api/me/route.ts`, `app/(auth)/login/`, `app/(app)/dashboard/`.
- Route groups introduced: `(auth)` (public auth pages) and `(app)` (authenticated). Becomes the convention for future features.
- New shadcn components installed: `button`, `input`, `label`, `card` (plus form primitives if used).
- New e2e suite tag conventions: `@auth`, `@auth-real`, `@health`.
- New CI job `e2e-real`, increasing PR runtime by ~1–2 minutes (Supabase start dominates).

### Risk
- **First execution of `/dev-cycle` will expose latent issues** in the orchestrator, agent prompts, and skills. Expect to discover gaps such as: missing `auth.users` seed helper, Testcontainers cookie-fixture quirks, `qa-tester` requiring `data-testid` conventions that were not defined in wave 2, route-group conventions not anticipated in skills. **Plan for retroactive patches to wave 2 as part of this wave's PR cycle.**
- The `@auth-real` suite requires `supabase start` to boot reliably in CI. First runs may need timeout tuning and Supabase CLI version pinning.
- Establishes UI conventions (route groups, `data-testid` pattern, Server Action shape, redirect pattern) that future features will copy. Worth pausing during code review to validate them before they harden.

### Decisions frozen by this wave
- Route group layout: `app/(auth)/...` and `app/(app)/...`.
- Server Action shape: validated input via Zod, returns either `{ success: true }` or a typed error union, never throws across the boundary.
- Auth redirect pattern: `middleware.ts` redirects unauthenticated requests to `/login` with `?redirectTo=` preserving the original path; `/login` redirects authenticated requests to `/dashboard`.
- `data-testid` convention for `qa-tester` and Playwright locators.
- `@auth-real` suite topology: separate Playwright invocation, separate CI job, runs against `supabase start`.

### Validation
At the end of this change:
- `npm run check` passes.
- `npm run test:unit`, `test:integration`, `test:e2e`, and `test:e2e:real` all pass locally.
- `/dev-cycle smoke-health-feature` runs to completion: every task reaches `[x]`, both review and QA loops converge in ≤ 3 iterations, semantic commits land on `feature/smoke-health-feature`, and a PR is opened against `main` via `gh`.
- CI on the resulting PR is green across all four test jobs (unit, integration, e2e, e2e-real).
- A retrospective documents any orchestrator/agent/skill gaps discovered, with follow-up changes filed for non-trivial issues.
