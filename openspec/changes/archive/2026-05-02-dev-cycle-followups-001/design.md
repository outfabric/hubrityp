## Context

The first run of `/dev-cycle` (smoke-health-feature, archived 2026-05-02) produced
`docs/dev-cycle-retrospective-001.md`. Sections 3 and 4 of that document list seven
surprises and four numbered follow-up actions. This change resolves three of them in a
single bundle:

1. The `getUser()`-needs-real-GoTrue trap (3.4) — the in-process mock currently lives at
   `e2e/mock-gotrue.ts` and will be reached for again by every future change adding e2e
   coverage to an authenticated surface.
2. The Next.js / Playwright behavior gotchas (3.4, 3.5, 3.6) that any test-infra contributor
   will trip over without a written warning.
3. The `tasks.md`-mutation discipline currently held by per-invocation reminders rather
   than the agent's system prompt (3.7).

Three retrospective items are explicitly **out of scope**: the architectural rework to
decouple `NEXT_PUBLIC_SUPABASE_URL` from build-time inlining (deferred per §3.4); the
shadcn floor-deps policy (the deps are already installed and adding policy was deemed
unnecessary); and the opsx drafting-skill heuristics for layout-consumed Server Actions
(§3.2) and helper-before-consumer ordering (§3.3) — these will be picked up in a later
change focused specifically on opsx tooling, where the prompt-engineering review can be
done in isolation.

The change still touches three heterogeneous surfaces in one PR (test util, docs, agent
prompt) — accepted trade-off because all three flow from the same retrospective and
splitting them further would multiply the `/opsx:*` cerimônia without proportional
benefit.

## Goals / Non-Goals

**Goals:**

- Lift `e2e/mock-gotrue.ts` to a typed, self-contained helper at
  `lib/test-utils/mock-gotrue.ts` so the next authenticated-surface e2e change does not
  copy-paste it.
- Reshape the helper's public surface to `{ port, stop, jwt }` so a consumer does not need
  to also import `buildFixedJwt` separately to obtain a usable token.
- Document the four Next.js/Playwright/Supabase-CLI gotchas in `docs/dev-cycle.md` so that
  a contributor reading the doc end-to-end before touching e2e infra finds them.
- Codify the `tasks.md`-mutation rule in the `fullstack-developer` agent's "Modo orquestrado
  (dev-cycle)" section so it survives prompt edits without orchestrator-side reminders.

**Non-Goals:**

- Replace the build-time `NEXT_PUBLIC_*` inlining with a runtime URL resolution mechanism.
  Tracked as future architectural work; this change documents the gotcha but does not
  remove it.
- Add a CI lint or test that verifies the agent prompt rule is observed (the rule is
  expressed in prose; verification is left to QA's review of the next dev-cycle run).
- Ship reusable helpers for non-GoTrue Supabase services (Storage, Realtime, Postgres
  beyond what Testcontainers already provides). Out of scope.
- Expand `lib/test-utils/` into a generic test-fixture library; we are introducing the
  directory for one helper now and will accumulate more as future changes need them.

## Decisions

### Decision 1: New location is `lib/test-utils/mock-gotrue.ts`

The retrospective suggested `lib/test-utils/mock-gotrue.ts`. Alternatives considered:

- `e2e/lib/mock-gotrue.ts` — keeps the helper inside `e2e/` but folder-promotes it. Rejected
  because future integration tests (Vitest) might also want to call `getUser()` against the
  mock, and importing from `e2e/` from outside e2e is awkward.
- `lib/auth/test-utils/mock-gotrue.ts` — co-located with the auth domain. Rejected because
  it's a test helper, not production code; mixing the two in `lib/auth/` blurs the
  `import 'server-only'` boundary already in use there.

`lib/test-utils/` is new but empty-by-design until needed. Adding it once for this helper
is cheaper than nesting it under an unrelated domain.

### Decision 2: Reshape the public handle to `{ port, stop, jwt }`

Current shape: `MockGoTrueHandle = { url: string; close: () => Promise<void> }`, with
`buildFixedJwt` as a separate top-level export. Target shape: `{ port: number; stop:
() => Promise<void>; jwt: string }` — the JWT is built once when the helper starts and
attached to the handle so a consumer gets everything in one object.

Why:

- The `port` is more useful than `url` for callers that need to compose URLs differently
  (e.g., `lib/env/client.ts` validates a URL string, but a sibling test might want raw port).
  We can keep `url` as a convenience field, but `port` is the new contract.
- `stop` reads more naturally than `close` for "tear down the entire mock" (a `close()` on a
  Node `http.Server` is a primitive; `stop()` is the operational verb).
- Bundling `jwt` removes a separate import and makes the handle self-sufficient.

`buildFixedJwt` will remain exported (for consumers that need to mint additional tokens),
but `startMockGotrue()` will return a default-good `jwt` so 80% of callers don't need to
touch the builder.

### Decision 3: Default port stays at `54321`

The retrospective's §3.4 documents the build-time inlining of `NEXT_PUBLIC_SUPABASE_URL`.
Because the same Next.js build artifact serves both the default e2e suite (mock GoTrue) and
the `@auth-real` suite (real Supabase), and `NEXT_PUBLIC_SUPABASE_URL` is hardcoded into the
edge bundle at build time, the mock MUST bind to the same port a local `supabase start`
exposes. That port is `54321`.

`startMockGotrue({ port })` will accept an override for tests that want a custom port and
have a build artifact to match; the default is `54321`. This decision is the load-bearing
constraint that keeps a single build artifact viable for both suites — call it out clearly
in the doc and the helper's source comment.

### Decision 4: Helper unit tests cover the contract, not implementation

The helper is itself a test util — testing test utils tends to spiral into meta-work. The
unit suite (`lib/test-utils/mock-gotrue.test.ts`) will assert only the public contract:

- `startMockGotrue()` returns `{ port, stop, jwt }` with the documented shapes.
- `jwt` parses as a three-segment JWT and verifies against the helper's signing material.
- After `stop()`, the same port is rebindable (no leaked listener).

The "does `getUser()` succeed against the mock" scenario stays in the e2e suite — duplicating
it at the unit level would re-implement supabase-js and add no signal.

### Decision 5: Docs gotchas live in `docs/dev-cycle.md`, not a new file

User decision. The alternative was a new `docs/nextjs-gotchas.md`; we chose the integrated
section in `docs/dev-cycle.md` because the gotchas are exercised by the dev-cycle workflow
specifically (e2e infra, orchestration). Future gotchas unrelated to dev-cycle can spawn a
sibling doc when they exist.

The "Gotchas" section will:

- Be a top-level `##` section, late in the doc.
- Use `###` subsections, one per pitfall (four total).
- Cross-reference 3.5 inside the entry for 3.4 (same root cause, two costumes).
- Link to `lib/test-utils/mock-gotrue.ts` and to `e2e/start-server.ts` so readers find the
  workaround pattern.

### Decision 6: Agent rule placement inside "Modo orquestrado (dev-cycle)"

User decision. Placing the rule in the orchestrated-mode section (rather than the top-level
universal rules) anchors it to the context where it makes sense (the agent has no concept
of `tasks.md` outside `/dev-cycle`). The rule will be a clearly-marked sentence near the
contract-of-output description so it cannot be removed accidentally during a prompt
refactor — verbatim wording will start with "Você NÃO deve modificar..." for visual weight.

## Risks / Trade-offs

- **Single heterogeneous PR** → review focus is split across code, docs, and prompt edits.
  Mitigation: tasks.md sections are organised by surface so the reviewer can read the diff
  one surface at a time.
- **Helper API reshape may break a parallel branch** that imports the current
  `MockGoTrueHandle.url`/`close` shape. Mitigation: there is no parallel branch known to
  use it (verified: only `e2e/start-server.ts` imports). The `e2e/mock-gotrue.ts` file is
  removed in the same change so a stale reference would fail the typecheck loudly.
- **Agent prompt rule is unverifiable mechanically.** A future agent could ignore the rule
  and modify `tasks.md` regardless. Mitigation: keep the rule wording in a stable section;
  the orchestrator continues to pass per-invocation reminders for at least one more dev-cycle
  run as a belt-and-suspenders measure (no spec change there — the per-invocation reminder
  is left as-is).
- **Default port `54321` collision** when a contributor has a real `supabase start` already
  running. Mitigation: documented in the gotchas section; helper accepts a port override.

## Migration Plan

There is no runtime migration. Roll-forward only:

1. After merge, the relocated helper is the only path. `e2e/mock-gotrue.ts` no longer
   exists; any branch in flight that imported it must rebase and update imports.
2. The `fullstack-developer` agent picks up the new rule from its system prompt at the next
   `/dev-cycle` invocation; no agent-state migration required.

Rollback: `git revert` of the merged commit restores the previous file layout and the
previous agent prompt in one move. Risk of a partial revert is low because the surfaces
are independent.

## Open Questions

None at the time of drafting. The questions raised in `/opsx:explore` (helper API shape,
docs location, agent prompt anchor) are resolved in Decisions 2–6.
