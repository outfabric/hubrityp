# Tasks — smoke-health-feature

> This is the **first change executed via `/dev-cycle`**. The orchestrator consumes the tags below to drive the test layers per task. Bug discovery in agents/skills is expected; patches land in this wave's PR cycle.

## 1. Pure helpers and validators

- [ ] 1.1 Create `lib/auth/login-input-schema.ts` exporting `loginInputSchema` (Zod) with `email` (RFC) and `password` (min 8) `[unit]`
- [ ] 1.2 Create `lib/auth/map-supabase-user.ts` exporting `mapSupabaseUser(user)` returning `{ id, email } | null` `[unit]`
- [ ] 1.3 Add `lib/auth/login-input-schema.test.ts` and `lib/auth/map-supabase-user.test.ts` covering the scenarios in the auth spec `[unit]`

## 2. Health endpoints

- [ ] 2.1 Create `app/api/health/route.ts` exporting `GET` returning `{ ok, db, timestamp }`. Probe via Drizzle (`select 1` against `health_pings` count or equivalent). On DB error, return 503 with `db: 'unreachable'` `[integration]`
- [ ] 2.2 Create `app/api/me/route.ts` exporting `GET` that reads the session via `lib/supabase/server`, applies `mapSupabaseUser`, returns `{ userId, email }` (200) or `{ ok: false, error: 'unauthenticated' }` (401) `[integration]`
- [ ] 2.3 Add integration tests for `/api/health` covering reachable/unreachable, no-PII, no-auth-required paths `[integration]`
- [ ] 2.4 Add integration tests for `/api/me` covering authenticated success, unauthenticated 401, and ignore-input-identity paths `[integration]`

## 3. Auth Server Actions

- [ ] 3.1 Install shadcn primitives required by the login form: `npx shadcn@latest add button input label card`
- [ ] 3.2 Create `app/(auth)/login/actions.ts` exporting `signIn(formData)`. Validate with `loginInputSchema`, call `supabase.auth.signInWithPassword`, return typed `Result` union, redirect on success, validate `redirectTo` is same-origin `[integration]`
- [ ] 3.3 Create `app/(app)/dashboard/actions.ts` exporting `signOut()`. Call `supabase.auth.signOut()`, redirect to `/login` `[integration]`
- [ ] 3.4 Add integration tests for `signIn`: success path (cookie write + redirect), invalid_credentials, malformed input, unknown error fallback, redirectTo validation. Use `@supabase/ssr` mocks at module boundary `[integration]`
- [ ] 3.5 Add integration tests for `signOut`: cookie clear + redirect `[integration]`

## 4. UI: route groups and pages

- [ ] 4.1 Create `app/(auth)/layout.tsx` — minimal centered layout (Tailwind only)
- [ ] 4.2 Create `app/(auth)/login/page.tsx` — Server Component rendering the login form. Form uses shadcn `Input`, `Label`, `Button`, `Card`. Uses React Hook Form + Zod resolver in a co-located client component (`login-form.tsx`)
- [ ] 4.3 Apply the `data-testid` convention to every interactive element on the login page (`login-form-email`, `login-form-password`, `login-form-submit`, `login-form-error`)
- [ ] 4.4 Create `app/(app)/layout.tsx` — authenticated shell with a header containing the logout button slot and a content area
- [ ] 4.5 Create `app/(app)/dashboard/page.tsx` — Server Component reading the user via `lib/supabase/server`, rendering `<span data-testid="dashboard-greeting">Olá, {email}</span>`
- [ ] 4.6 Add the logout `<form action={signOut}>` with `<button type="submit" data-testid="dashboard-logout">Sair</button>` rendered in `(app)/layout.tsx` (or in the page if simpler)

## 5. Middleware auth-gating

- [ ] 5.1 Extend `middleware.ts` with: redirect anon `/dashboard*` → `/login?redirectTo=<path>`; redirect auth `/login` → `/dashboard`
- [ ] 5.2 Add a small util `lib/auth/safe-redirect.ts` validating that a `redirectTo` value is a same-origin path; export `safeRedirect(target, fallback)` `[unit]`
- [ ] 5.3 Add unit tests for `safeRedirect` covering: valid relative path, external URL, protocol-relative URL, query-only path, empty `[unit]`
- [ ] 5.4 Add integration tests for middleware behavior using a synthetic Next request: anon /dashboard redirects, auth /login redirects, /api/health passes through `[integration]`

## 6. Default e2e suite

- [ ] 6.1 Update `e2e/tags.json`: mark `@auth` as active (no longer reserved); update `@auth-real` description to point at the new suite folder
- [ ] 6.2 Update wave-2 `globalSetup` (or extend) to seed at least one user usable by the simulated-cookie auth suite (insert into `auth.users` directly via service role)
- [ ] 6.3 Update `e2e/auth.setup.ts` to write a `storageState` for the seeded user
- [ ] 6.4 Create `e2e/auth.spec.ts` tagged `@auth`: anon /dashboard → /login (with redirectTo), with storageState /dashboard renders greeting, logout returns to /login `[e2e]`
- [ ] 6.5 Verify wave-2 `@health` smoke is updated (or replaced) to assert the new `/api/health` payload shape `[e2e]`

## 7. `@auth-real` suite

- [ ] 7.1 Create `playwright.auth-real.config.ts` extending the default config: `testDir: './e2e-auth-real'`, separate report dir `playwright-report-auth-real/`, `globalSetup: './e2e-auth-real/global-setup.ts'`, `globalTeardown: './e2e-auth-real/global-teardown.ts'`, `webServer` runs the same production app
- [ ] 7.2 Create `e2e-auth-real/global-setup.ts`: ensure `supabase start` is up (or fail with a clear message), use the Supabase Admin API to delete any pre-existing seeded user, then create a fresh user with `email_confirm: true`, expose credentials via Playwright globals/fixture
- [ ] 7.3 Create `e2e-auth-real/global-teardown.ts`: best-effort delete the seeded user (idempotent)
- [ ] 7.4 Create `e2e-auth-real/auth.spec.ts` tagged `@auth-real`: complete flow login → dashboard → logout → login `[e2e]`
- [ ] 7.5 Add npm script `test:e2e:real` running `playwright test --config playwright.auth-real.config.ts`

## 8. CI: `e2e-real` job

- [ ] 8.1 Update `.github/workflows/ci.yml`: add job `e2e-real` with `needs: e2e`. Steps: checkout, setup-node from .nvmrc, npm ci, install Supabase CLI, `npx supabase start`, `npm run test:e2e:real`, `if: always()` `npx supabase stop`. Upload `playwright-report-auth-real/` on failure.
- [ ] 8.2 Document branch-protection requirement to mark `e2e-real` as required for merging to `main`

## 9. Documentation

- [ ] 9.1 Create `docs/design-system/testid.md` documenting the `<surface>-<role>-<noun>` convention and listing the wave-3 IDs
- [ ] 9.2 Create `docs/design-system/route-layout.md` documenting the `(auth)` / `(app)` route-group convention and the rule "every authenticated feature page lives under `(app)/<domain>/`"
- [ ] 9.3 Create `docs/dev-cycle-retrospective-001.md` summarizing orchestrator/agent/skill gaps surfaced during this run; file follow-up changes for non-trivial issues

## 10. Final validation

- [ ] 10.1 `npm run check` → exit 0
- [ ] 10.2 `npm run test:unit` → exit 0
- [ ] 10.3 `npm run test:integration` → exit 0
- [ ] 10.4 `npm run test:e2e` → exit 0 (default suite, simulated)
- [ ] 10.5 `npm run test:e2e:real` → exit 0 (real GoTrue suite)
- [ ] 10.6 `/dev-cycle smoke-health-feature` runs to completion: tasks all `[x]`, review and QA loops converge in ≤3 iterations, semantic commits are created, PR is opened against `main` via `gh`
- [ ] 10.7 CI on the resulting PR: `quality`, `integration`, `e2e`, `e2e-real` all green
