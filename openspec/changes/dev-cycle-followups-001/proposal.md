## Why

The first end-to-end run of `/dev-cycle` (smoke-health-feature, 2026-05-02) surfaced
infrastructure gaps documented in `docs/dev-cycle-retrospective-001.md`. The biggest is the
`getUser()`-needs-real-GoTrue trap (3.4): every future change adding e2e coverage of an
authenticated surface will rediscover it unless we lift the in-process mock into a shared
helper and document the underlying Next.js/Playwright behavior. The orchestrator-discipline
gap (3.7) costs a per-invocation reminder today; codifying it in the agent prompt now
removes that recurring tax.

## What Changes

- **Lift `e2e/mock-gotrue.ts` to `lib/test-utils/mock-gotrue.ts`** with a typed API
  `startMockGotrue(options) → { port, stop, jwt }`. Update `e2e/start-server.ts` to import
  from the new location. Add unit coverage for the helper's contract (port allocation,
  signed JWT, `stop()` releases the port).
- **Document Next.js/Playwright gotchas in `docs/dev-cycle.md`**: build-time inlining of
  `NEXT_PUBLIC_*` vars into the edge runtime bundle, Playwright `webServer` plugin booting
  before `globalSetup` (and the `start-server.ts` workaround), the `playwright.auth-real`
  synchronous-`supabase status` consequence, and the `supabase status -o json` key-naming
  quirk. Cross-link to the new helper.
- **Codify the `tasks.md`-mutation rule** in the `fullstack-developer` agent's "Modo
  orquestrado (dev-cycle)" section: the agent MUST NOT modify `openspec/changes/*/tasks.md`;
  marking tasks `[x]` is the orchestrator's responsibility.

## Capabilities

### New Capabilities

- `dev-cycle-orchestration`: governs the `/dev-cycle` slash command, the
  `fullstack-developer` agent's orchestrated-mode contract (including which files the agent
  must not touch), and the documentation footprint that future invokers depend on.

### Modified Capabilities

- `e2e-test-stack`: adds a requirement that the in-process mock GoTrue used by the e2e
  suite is a reusable, typed helper outside `e2e/` and reachable by future suites without
  copy-paste.

## Impact

- **Code**: new `lib/test-utils/mock-gotrue.ts`; deletion of `e2e/mock-gotrue.ts`; updated
  imports in `e2e/start-server.ts`.
- **Tests**: new unit tests for the helper (~3 cases); the existing `@auth` e2e suite must
  continue to pass against the relocated helper.
- **Docs**: new "Gotchas" section in `docs/dev-cycle.md`.
- **Tooling prompts**: edits to `.claude/agents/fullstack-developer.md` only.
- **No runtime impact**: zero changes to production application code or its dependencies; no
  schema, RLS, or env var changes.
- **Out of scope**: hardening the build-time `NEXT_PUBLIC_SUPABASE_URL` coupling (deferred
  per retrospective §3.4); pre-installing shadcn floor dependencies (already installed and
  not re-introducing as policy); opsx drafting-skill heuristics for layout-consumed Server
  Actions and helper-before-consumer ordering (retrospective §3.2 and §3.3 — deferred to a
  later change focused on opsx tooling).
