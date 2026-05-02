# `/dev-cycle` retrospective 001 — `smoke-health-feature`

This document captures what was learned running HubrityP's first end-to-end `/dev-cycle`
invocation. Audience: future invokers of `/dev-cycle`, maintainers of the orchestrator
prompts (`fullstack-developer`, `code-reviewer`, `qa-tester`), and skill authors
(`unit-tests`, `integration-tests`, `e2e-tests`).

The point is not to celebrate or apologise — it is to record concrete, verifiable findings
so the next change runs with fewer surprises.

## 1. Run summary

| Field         | Value                                                                          |
| ------------- | ------------------------------------------------------------------------------ |
| Change        | `smoke-health-feature` (OpenSpec change in `openspec/changes/`)                |
| Date          | 2026-05-02                                                                     |
| Branch        | `feature/smoke-health-feature`                                                 |
| Worktree      | `../hubrityp-smoke-health-feature/`                                            |
| Tasks (total) | 44                                                                             |
| Sections      | 10                                                                             |
| Tests added   | 11 unit files, 8 integration files, 2 default e2e specs, 1 real-stack e2e spec |

Numbers reflect the state at the moment section 9 was implemented. Sections 10.1–10.7
finalise the change; their counts (final test totals, reviewer/QA iteration counts) will be
backfilled by the orchestrator when section 10 closes.

<!-- TODO: section 10 fills in final test counts and reviewer/QA iteration counts -->

## 2. What worked

These behaviours of the orchestrator and skills were validated and should be preserved.

- **Per-task quality gates kept the change deployable at every step.** Each task ran
  `npm run check` (lint + format:check + typecheck) before moving on, and unit/integration
  tests were created and passed before the next task. No "we'll fix it later" debt
  accumulated.
- **The `[unit]` / `[integration]` / `[e2e]` tag convention in `tasks.md` translated cleanly
  to skill invocations.** The `fullstack-developer` agent reliably picked the right test
  layer per task. Tasks without tags (e.g., section 4 UI tasks) correctly default to no new
  tests beyond what other tagged tasks already covered.
- **Sections 1–8 ran sequentially without manual intervention.** Each section's task block
  was atomic enough that the orchestrator did not have to ask the user mid-section for
  clarification.
- **Scoped re-validation never had to fall back to full suites in this run.** All fixes
  affected files within a single domain, so `--related` for integration and `--grep`
  `@<tag>` for e2e were always sufficient.
- **The split between `(auth)` and `(app)` route groups (decided in the design doc) survived
  contact with implementation.** The agent did not propose alternatives mid-flight;
  questions only arose around _which_ file inside `(app)` should host the `signOut` action
  (see surprise #4.2).
- **Docker Compose was not required to run the suites.** Both unit and integration use
  Vitest + Testcontainers; e2e default uses Playwright + Testcontainers + an in-process mock
  GoTrue. The only suite that needs a real `supabase start` is `@auth-real`, by design.

## 3. Surprises and gaps

The interesting part. Each item is verifiable in source — the file path is cited so future
readers can confirm the finding has not been silently fixed.

### 3.1 `class-variance-authority` not auto-installed by shadcn CLI (section 3)

**Symptom.** After running `npx shadcn@latest add button input label card`, `npm run
typecheck` failed because `class-variance-authority` was not in `package.json`.

**Cause.** The shadcn CLI emits component source files that import `cva`, but the
`add` subcommand does not always reconcile the dependency list against the project's
`package.json`. We had to `npm install class-variance-authority` manually.

**Recommendation.** Either:

- Pre-install the most common shadcn dependencies (`class-variance-authority`,
  `@radix-ui/react-slot`, `tailwind-merge`, `clsx`) in the project bootstrap so future
  `shadcn add` calls do not produce a missing-dependency build error; **or**
- Have the `unit-tests` / `fullstack-developer` skill verify dependencies after
  `shadcn add` and `npm install` whatever is referenced but not installed.

The first option is preferable because it avoids the round-trip on every shadcn addition.

### 3.2 `signOut` action location was wrong in `tasks.md` (section 4)

**Symptom.** Task 3.3 specified `app/(app)/dashboard/actions.ts` as the home for `signOut`.
Task 4.6 then asks to render the logout control _in the layout_. A layout cannot import
`actions.ts` from a child page without coupling itself to that route.

**Cause.** The OpenSpec drafting skill did not anticipate that the layout (not a specific
page) would need to import the action.

**Resolution applied.** The `fullstack-developer` moved the action to
`app/(app)/actions.ts`. Integration test imports were updated accordingly. The decision is
documented in `docs/design-system/route-layout.md` ("Server Action co-location").

**Recommendation.**

- Amend the OpenSpec drafting skill (`opsx:new` / `opsx:ff`) so that when a task introduces
  a Server Action consumed by a layout, the skill places it at `(group)/actions.ts` rather
  than `(group)/<page>/actions.ts`.
- Add a heuristic to the design doc generator: "If the action is referenced by both
  `app/(group)/layout.tsx` AND `app/(group)/<page>/page.tsx`, place it at
  `app/(group)/actions.ts`."

### 3.3 `safeRedirect` extraction order (section 5)

**Symptom.** Section 3 inlined a same-origin guard in `app/(auth)/login/actions.ts`.
Section 5 introduced `lib/auth/safe-redirect.ts` exporting `safeRedirect(target, fallback)`,
which forced a one-line refactor of the section-3 code.

**Cause.** The section ordering put the consumer (login Server Action) before the helper
(`safeRedirect`).

**Recommendation.** When an OpenSpec change introduces both a one-off rule (inlined first)
and a helper that captures the rule (extracted later), sequence the helper task BEFORE the
consumer task so the consumer adopts the helper from the first commit. The cost is small
(one extra reorder) but it eliminates the refactor and the test churn.

### 3.4 The big one — `getUser()` requires a real (or mocked) GoTrue at runtime (section 6)

**Symptom.** The wave-2 `auth.setup.ts` wrote a `storageState` file with simulated cookies
that contained a JWT-shaped string. When `auth.spec.ts` navigated to `/dashboard`, the page
returned an empty body because `supabase.auth.getUser()` returned `null`. Middleware also
treated the request as anonymous and redirected to `/login`.

**Cause.** `supabase.auth.getUser()` does not just decode the JWT — it makes an HTTP call to
the GoTrue endpoint at `${NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user` to validate the session.
With no GoTrue listening, the call fails, the user is reported as `null`, and the auth
gating treats the request as anonymous.

**Resolution applied.**

1. Built an in-process mock GoTrue (`e2e/mock-gotrue.ts`) that responds to
   `/auth/v1/user`, `/auth/v1/token`, and the minimum surface supabase-js touches during a
   server-side `getUser()` call.
2. Bound the mock to a fixed port (`127.0.0.1:54321`). This is the SAME port `supabase
start` exposes, because `NEXT_PUBLIC_SUPABASE_URL` is **inlined into the edge runtime
   bundle at build time** (used by `middleware.ts`). A single Next.js build artifact must
   serve both the mock-GoTrue suite and the real-stack suite, so the URL — and therefore the
   port — has to match.
3. Wrote a `start-server.ts` wrapper because Playwright's `webServer` plugin boots **before**
   `globalSetup` runs (verifiable at
   `node_modules/playwright/lib/runner/tasks.js::createGlobalSetupTasks`). Env vars set in
   `globalSetup` cannot reach the spawned Next.js server through `webServer.env`. The
   wrapper does the dynamic boot (Postgres container, mock GoTrue) before exec'ing
   `next start` so all runtime env is in place when the server starts.

**Recommendation.**

- **Document the build-time URL inlining behavior of `NEXT_PUBLIC_*` in edge runtime.** This
  is not a bug, but it is sharp enough that future changes touching e2e infrastructure will
  trip over it without a written warning. Add it to `docs/dev-cycle.md` or a "Next.js
  gotchas" doc.
- **Document Playwright's `webServer` ordering vs. `globalSetup`.** The pattern of
  `start-server.ts` (do dynamic boot, then exec the server) is reusable. Future suites that
  need ephemeral resources should follow it.
- **Lift the in-process mock GoTrue into a reusable helper.** Today it lives at
  `e2e/mock-gotrue.ts`. The next change that needs server-side auth in tests will copy-paste
  it. Move it to `lib/test-utils/mock-gotrue.ts` (or similar) and export a clean API.
- **File a follow-up change** to harden the build-time edge URL coupling — e.g., a
  runtime-env approach using `await import()` to defer URL resolution past build time. Out
  of scope for this wave; capture the idea so it does not get lost.

### 3.5 `playwright.auth-real.config.ts` reads `supabase status` synchronously at config-load (section 7)

**Symptom.** The auth-real config calls `execSync('npx supabase status -o json')` at the top
level of `playwright.auth-real.config.ts`. Synchronous shell-out at config-load is unusual.

**Cause.** Same root as 3.4: Playwright captures `webServer.env` at config-load, before
`globalSetup` runs. Anything `globalSetup` writes to `process.env` is invisible to the
spawned server. The auth-real suite needs `SUPABASE_API_URL`, `SUPABASE_DB_URL`,
`SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` from the locally-running stack — those
have to be discovered at config-load.

**Recommendation.** Cross-reference 3.4 in the docs. The wrapper-vs-config-load split is the
same problem in two costumes; one writeup with two examples is enough.

### 3.6 `supabase status -o json` key naming quirk (section 7)

**Symptom.** The Supabase CLI's structured-output JSON uses `API_URL`, `DB_URL`, `ANON_KEY`,
`SERVICE_ROLE_KEY` (uppercase + underscore). Other Supabase CLI outputs use camelCase.

**Cause.** A CLI-side inconsistency, not anything we control.

**Recommendation.** Just a note: when adding new Supabase CLI parsing, dump the JSON once
locally and check the actual key shape. Do not assume camelCase.

### 3.7 `tasks.md` mutation discipline

**Observation.** The orchestrator (the `/dev-cycle` invocation itself) is responsible for
flipping `[ ]` → `[x]` in `tasks.md`. The `fullstack-developer` agent must not touch the
file. This held throughout the run because every section prompt repeated the rule.

**Recommendation.** Codify the rule in the agent prompt template explicitly (rather than
relying on per-invocation reminders). A single line in the system prompt:

> You must NOT modify `openspec/changes/*/tasks.md`. Marking tasks `[x]` is the
> orchestrator's responsibility.

This makes the rule survive future prompt edits.

## 4. Follow-up changes recommended

Concrete proposals for future `/dev-cycle` runs. Each one is small enough to be a single
change.

1. **Lift the in-process mock GoTrue into a reusable helper.**
   - Move `e2e/mock-gotrue.ts` to `lib/test-utils/mock-gotrue.ts` (or similar shared
     location).
   - Export a typed `startMockGotrue(options)` API that returns `{ port, stop, jwt }`.
   - Update `e2e/start-server.ts` to import from the new location.
   - Document the helper in `docs/dev-cycle.md` so future e2e changes can reach for it.

2. **Document `NEXT_PUBLIC_*` edge-runtime inlining and Playwright's `webServer` /
   `globalSetup` ordering.** Either a new "Next.js gotchas" doc or a section in
   `docs/dev-cycle.md`. Cross-reference from `playwright.config.ts` and
   `playwright.auth-real.config.ts` comments.

3. **Amend the OpenSpec drafting skill** (`opsx:new`, `opsx:ff`, `opsx:apply`) so that
   Server Actions consumed by a layout are placed at `(group)/actions.ts` from the start.
   Add an explicit heuristic to the skill prompt.

4. **Pre-install common shadcn dependencies** (`class-variance-authority`,
   `@radix-ui/react-slot`, `tailwind-merge`, `clsx`) in the project bootstrap script so
   future `shadcn add` calls do not produce a missing-dependency typecheck error.

5. **Codify the `tasks.md`-mutation rule** in the `fullstack-developer` agent's system
   prompt template.

These should be filed as OpenSpec changes (`/opsx:new`) before the next major feature so the
infrastructure debt does not hide behind feature work.

## 5. Numbers

| Metric                            | Value                                     |
| --------------------------------- | ----------------------------------------- |
| Total tasks                       | 44                                        |
| Sections                          | 10                                        |
| Unit test files added (this wave) | 11 (cumulative; some pre-wave-3)          |
| Integration test files added      | 8 (cumulative; some pre-wave-3)           |
| Default e2e specs                 | 2 (`auth.spec.ts`, `smoke.spec.ts`)       |
| Real-stack e2e specs              | 1 (`e2e-auth-real/auth.spec.ts`)          |
| Iterations needed per section     | 1 (single-pass PASS for sections 1–8)     |
| Reviewer/QA iterations            | TBD (reviewer/QA loops run in section 10) |
| Bugs surfaced by `code-reviewer`  | TBD                                       |
| Bugs surfaced by `qa-tester`      | TBD                                       |

<!-- TODO: section 10 fills in final test counts and reviewer/QA iteration counts -->

## 6. Closing note

The orchestrator did its job. The agents did theirs. The skills mostly did theirs but left a
few gaps documented above. None of the gaps blocked the change — they cost time and produced
patterns worth lifting into shared infrastructure. The follow-up changes in section 4 are
the highest-leverage next moves.

The single biggest finding is `getUser()`'s server-side HTTP call to GoTrue (3.4). Anyone
adding e2e coverage for an authenticated surface will hit this; the documentation and the
reusable mock helper are the two interventions most likely to save time on the next change.
