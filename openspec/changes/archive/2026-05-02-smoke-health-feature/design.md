# Design — smoke-health-feature

## Context

Waves 1 and 2 leave the platform with: a Next.js 16 app, strict TypeScript, lint/format/typecheck gates, Vitest unit + integration runners (Testcontainers), Playwright e2e (default suite with simulated auth), Supabase local via CLI, Drizzle + RLS pattern in `health_pings`, `@supabase/ssr` auth helpers, root middleware refreshing the session cookie, Pino logger with redaction, validated env, and CI running `quality + integration + e2e` on every PR.

What is missing: the orchestrator has never run end-to-end. `/dev-cycle` chains `fullstack-developer` → `code-reviewer` → `qa-tester` → semantic commits + PR, but no real change has exercised that pipeline yet. Latent bugs in agent prompts, in skills (`unit-tests`, `integration-tests`, `e2e-tests`), or in the orchestrator itself surface only when a change with `[unit] [integration] [e2e]` tags actually flows through it.

This wave introduces a small, navigable feature — health endpoints, login, dashboard, logout — and runs it through `/dev-cycle smoke-health-feature`. The feature is intentionally minimal so that orchestrator behavior is the headline, not domain complexity.

It also introduces the `@auth-real` Playwright suite reserved in wave 2: a real login flow against `supabase start` + GoTrue, validating that `@supabase/ssr` actually exchanges credentials for a session — something the simulated-cookie default cannot prove.

## Goals / Non-Goals

**Goals:**
- Ship `GET /api/health` (public) and `GET /api/me` (authenticated) endpoints.
- Ship a login page (`/login`), a Server Action `signIn`, a protected dashboard (`/dashboard`), and a Server Action `signOut`.
- Establish route-group layout: `app/(auth)/...` for public auth pages, `app/(app)/...` for authenticated pages.
- Establish the canonical Server Action shape (Zod-validated input, typed result union, never throws across the boundary).
- Establish auth-gating in `middleware.ts` (redirect unauthenticated `/dashboard` requests to `/login?redirectTo=...`; redirect authenticated `/login` requests to `/dashboard`).
- Establish a `data-testid` convention so `qa-tester` and Playwright share stable locators.
- Cover the feature with all three test layers in proportion (more unit, fewer integration, fewest e2e).
- Ship the `@auth-real` Playwright suite (separate config, separate npm script, separate CI job) running against `supabase start`.
- Run `/dev-cycle smoke-health-feature` to completion: every task `[x]`, both review and QA loops converge in ≤3 iterations, semantic commits, PR opened via `gh`, all four CI jobs green.
- Document discovered orchestrator/skill gaps in a wrap-up note so wave-2 patches can be filed.

**Non-Goals:**
- Signup, password reset, magic links, OAuth, SSO.
- Onboarding flow.
- Final dashboard layout, navigation shell, sidebar, theming variants beyond shadcn defaults.
- Any domain UI (patients, calendar, payments, prontuário).
- Email verification gating, MFA, rate limiting beyond what middleware naturally provides.
- Custom 404 / 500 / error boundaries.
- Observability (OpenTelemetry, Sentry).

## Decisions

### D1 — Route groups: `(auth)` and `(app)`

Use Next.js route groups to separate public auth pages from authenticated pages without affecting URLs:
- `app/(auth)/login/page.tsx` → `/login`
- `app/(auth)/layout.tsx` → minimalistic centered layout for unauthenticated screens
- `app/(app)/dashboard/page.tsx` → `/dashboard`
- `app/(app)/layout.tsx` → authenticated shell (header with logout button, content area)

**Rationale:** route groups keep the URL flat while letting us scope layouts and (later) loading/error boundaries to each surface. Every future feature page will live under `(app)/<domain>/...`.

**Alternative considered:** parallel routes / nested layouts in `(app)`. Overkill for this wave; can be introduced when a real navigation shell exists.

### D2 — Server Action shape

Every Server Action is an `async` exported function in `actions.ts` co-located with its consumer. Shape:

```ts
'use server';
import { z } from 'zod';

const Input = z.object({ email: z.string().email(), password: z.string().min(8) });
type Result = { ok: true } | { ok: false; error: 'invalid_credentials' | 'rate_limited' | 'unknown' };

export async function signIn(formData: FormData): Promise<Result> {
  const parsed = Input.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: 'invalid_credentials' };
  // ...
}
```

Rules:
- Input parsed with Zod. Bad input → `{ ok: false, error: ... }`, never throws.
- Errors are typed string-literal unions, never `Error` instances across the boundary.
- Auth context comes from `lib/supabase/server`, not from the form (the user cannot impersonate by sending a hidden field).
- Side effects (`redirect`, `revalidatePath`, `revalidateTag`) happen after the result is determined, not before.

**Rationale:** typed result unions make UI handling exhaustive. Forbidding throws across the boundary avoids the "unhandled rejection in form" UX failure mode and keeps the contract serializable.

**Alternative considered:** throwing typed errors and catching with `useFormState`. Works but loses type-narrowing on the consumer side and conflicts with the Server Action error-bubble that surfaces a generic toast.

### D3 — Signin via `@supabase/ssr`, no custom cookie writes

The `signIn` Server Action calls `supabase.auth.signInWithPassword({ email, password })` using the server client from `lib/supabase/server`. `@supabase/ssr` writes the session cookies; we do not touch them manually. After success, we `redirect('/dashboard')` (or to `redirectTo` if provided and same-origin).

`signOut` calls `supabase.auth.signOut()` and `redirect('/login')`.

**Rationale:** any custom cookie handling here would diverge from the helper pattern future features rely on. Trust the library; if it has bugs, they are pinned, not local.

### D4 — Middleware adds auth gating

Extend the wave-2 root `middleware.ts` to redirect:
- Unauthenticated `/dashboard` and `/dashboard/*` requests → `/login?redirectTo=<originalPath>` (origin-checked at consumption time).
- Authenticated `/login` requests → `/dashboard`.
- All other requests pass through unchanged (the wave-2 session refresh still runs).

The `redirectTo` query param is opt-in: `signIn` reads it and validates it is a same-origin path before redirecting. Any external URL is ignored.

**Rationale:** middleware is the single place auth-gating lives. Per-page guards proliferate; one middleware is auditable.

**Alternative considered:** route-level guards via layout-level `getUser()` checks. Works but duplicates the auth read for every protected route and requires every contributor to remember to add it.

### D5 — `data-testid` convention

Stable locators for both Playwright and the `qa-tester` agent:
- Format: `data-testid="<surface>-<role>-<noun>"` (kebab-case).
- Examples: `login-form-email`, `login-form-password`, `login-form-submit`, `login-form-error`, `dashboard-greeting`, `dashboard-logout`.
- One `data-testid` per interactive element; no ambiguity with role/text fallbacks.
- Documented in `docs/design-system/testid.md` (created here) so future features follow the same scheme.

**Rationale:** Playwright's web-first locators (`getByRole`, `getByLabel`) are preferred when stable, but localized roles (`pt-BR`) and shadcn primitives sometimes drift. `data-testid` is the safety net that keeps `qa-tester` deterministic.

### D6 — `@auth-real` suite topology

A second Playwright invocation, separate from the default suite:
- Config: `playwright.auth-real.config.ts` extending the default config, with `globalSetup: './e2e-auth-real/global-setup.ts'`.
- Setup: starts Supabase via `supabase start` (or asserts it is already running), seeds one user via the Supabase Admin API (`auth.admin.createUser`), and stores the credentials in the Playwright fixture.
- Tests live under `e2e-auth-real/` (separate folder) tagged `@auth-real`.
- npm script: `test:e2e:real`.
- CI job: `e2e-real`, gated on `e2e` passing first; runs `npx supabase start`, runs `test:e2e:real`, runs `npx supabase stop` in a finally step.

**Rationale:** keeping the real suite separated ensures the default suite stays fast and Postgres-only. The real suite is the only place `@supabase/ssr` is exercised end-to-end against GoTrue, so it earns its dedicated job.

**Alternative considered:** smuggle `supabase start` into the default e2e job and tag a single test `@auth-real`. Rejected because Supabase boot adds 30–60s to every PR's e2e job, even for changes that touch nothing auth-related.

### D7 — Test allocation per layer

| Layer | Test |
|---|---|
| `[unit]` | `loginInputSchema` (Zod) accepts/rejects expected payloads |
| `[unit]` | `mapSupabaseUser(user)` returns `null` for null input, returns `{ id, email }` for valid input |
| `[integration]` | `signIn` Server Action with `@supabase/ssr` mocked at the boundary asserts redirect target and cookie write call |
| `[integration]` | `signOut` Server Action asserts cookie clear call |
| `[integration]` | `GET /api/me` against real Postgres (Testcontainers) with simulated JWT — returns `{ userId, email }` for a known user, 401 with no JWT |
| `[integration]` | `GET /api/health` against real Postgres — returns `ok: true`, `db: 'reachable'`, includes timestamp |
| `[e2e]` (default, simulated) | `@health` — `/api/health` returns 200 + JSON shape |
| `[e2e]` (default, simulated) | `@auth` — anonymous `/dashboard` → `/login`, with `storageState` `/dashboard` shows greeting, logout returns to `/login` |
| `[e2e]` (`@auth-real` suite) | full handshake — visit `/login`, fill form, submit, land on `/dashboard`, click logout, return to `/login` |

**Rationale:** the pyramid is observed: most tests are integration and unit; only two e2e tests in the default suite, one in the real suite. Each scenario exercises a behavior that the lower layers cannot fully cover (browser navigation, cookie persistence across requests, RLS via real JWT shape, real GoTrue handshake).

### D8 — Run via `/dev-cycle`, not manually

Wave 1 and wave 2 were manual (chicken-and-egg). Wave 3 is the first change run via `/dev-cycle smoke-health-feature`. The orchestrator:
1. Validates the change (this design + tasks + specs).
2. Creates a worktree at `../hubrityp-smoke-health-feature/`.
3. Runs each task in order via `fullstack-developer`, gating on `npm run check` + tests at the appropriate layers.
4. Once tasks are done, runs `code-reviewer` (loop cap 3) and then `qa-tester` (loop cap 3 against the running app on :3000).
5. Creates semantic commits (one per task when feasible, otherwise one bundled), pushes, and opens a PR via `gh`.

If the orchestrator surfaces gaps (skill missing a helper, agent prompt unclear, qa-tester misses a `data-testid`, etc.), we patch them as part of this wave's PR cycle. The retrospective at the end summarizes them and files follow-up changes for non-trivial issues.

**Rationale:** this is the explicit purpose of wave 3 — exercise the orchestrator. Patching it inline turns the smoke run into a self-healing loop, which is exactly what we want.

### D9 — User seeding strategy across suites

- Integration: insert directly into `auth.users` via `runAsService` (raw SQL or Drizzle, password column populated with a bcrypt hash that matches a known plaintext). Suitable for endpoint tests that need RLS but not GoTrue.
- Default e2e: the wave-2 `globalSetup` already seeds one user; reuse it. `storageState` is populated by `auth.setup.ts`.
- `@auth-real` e2e: seed via `supabase.auth.admin.createUser({ email, password, email_confirm: true })` in `e2e-auth-real/global-setup.ts`. The Admin API is the only sanctioned way to create users with confirmed emails outside the signup flow.

**Rationale:** each layer uses the seeding mechanism that matches its fidelity. Mixing them (e.g., using Admin API in integration) would couple the integration suite to GoTrue, which we explicitly want to avoid for speed.

### D10 — Logout via Server Action button, not a form-less request

The dashboard's logout button is wrapped in a `<form action={signOut}>` with a `<button type="submit">`. This is the canonical Server Action invocation; using `onClick` to trigger a fetch would diverge from the pattern.

**Rationale:** forms fail gracefully without JavaScript and inherit the Server Action ergonomics. Future features will copy this exact shape.

## Risks / Trade-offs

- **First /dev-cycle invocation will surface bugs** → expected. Mitigation: budget time for retroactive patches; expect ≥1 round-trip on each loop.
- **`@auth-real` adds ~1–2 minutes to PR runtime** → acceptable; the suite catches GoTrue regressions nothing else does. Mitigation: gate it on `e2e` so flakes there don't waste the slot.
- **Route group layout becomes a contract** → every future feature copies it. Mitigation: documented in `docs/design-system/route-layout.md` (created here).
- **`data-testid` convention added late** → the wave-2 e2e smoke does not use them. Acceptable; only wave-3 surfaces need them. Mitigation: convention applies prospectively.
- **Server Action result-union pattern** → if a future use case needs richer error data, the pattern won't extend cleanly. Mitigation: the `error` field is a discriminator; payload fields can be added per variant.
- **`redirectTo` query param** → open-redirect attack if validation is sloppy. Mitigation: same-origin check via URL parsing; reject any path that doesn't start with `/` or contains `:` or `//`.
- **`supabase start` in CI requires Docker** → already true for default e2e (Testcontainers). The added cost is the Supabase image pull. Mitigation: rely on runner image cache; document a fallback path if it bites us.

## Migration Plan

No production data exists. The change is additive: new routes, new actions, new tests, no schema migrations beyond what wave 2 shipped. Rollback is `git revert`.

The first PR from `/dev-cycle` is reviewed before merge like any other PR; CI gates ensure it cannot ship broken.

## Open Questions

- **Should the `@auth-real` suite cover signOut as well?** The default suite already covers logout via simulated state. The real-suite addition would prove that `supabase.auth.signOut()` clears server cookies. **Recommendation:** include it in the same real-suite test (one continuous flow: login → dashboard → logout → login). Cheap to add, doubles coverage.
- **Should we install shadcn `form` component or hand-roll the form?** shadcn `form` adds React Hook Form + Zod plumbing already; the form-control primitives (`Input`, `Label`, `Button`) are enough for this minimal page. **Recommendation:** install only `button`, `input`, `label`, `card`. Defer `form` until a feature needs richer field-level error display.
- **Should `/dashboard` render any data?** The simplest version is `Olá, {email}` plus logout. Adding a "ping count" from `health_pings` would prove the data path further but bloats scope. **Recommendation:** stick with the simplest version. The `/api/health` endpoint already exercises Drizzle.
- **Should we record the dev-cycle retrospective in this change's `notes.md` or a sibling change?** **Recommendation:** keep it inline (`docs/dev-cycle-retrospective-001.md`) so it lives with the run that produced it.
