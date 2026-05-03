# dev-cycle-orchestration Specification

## Purpose

Defines the contract between the `/dev-cycle` orchestrator slash command, the `fullstack-developer` agent's orchestrated-mode behavior, and the project documentation footprint that future invokers depend on. Created by archiving change `dev-cycle-followups-001`.

## Requirements

### Requirement: `fullstack-developer` agent must not modify `tasks.md`

The `fullstack-developer` agent's system prompt SHALL state, inside the "Modo orquestrado
(dev-cycle)" section, that the agent MUST NOT modify any file matching
`openspec/changes/*/tasks.md`. Marking tasks `[x]` is exclusively the responsibility of the
`/dev-cycle` orchestrator. The rule MUST be expressed in prose strong enough to survive
future edits of unrelated parts of the prompt (i.e., it lives next to the orchestrated-mode
contract, not as a per-invocation reminder injected by the orchestrator).

#### Scenario: Agent prompt explicitly forbids `tasks.md` mutation

- **WHEN** a contributor reads `.claude/agents/fullstack-developer.md`
- **THEN** the "Modo orquestrado (dev-cycle)" section contains a clearly-marked rule
  prohibiting modification of `openspec/changes/*/tasks.md` and naming the orchestrator as
  the sole party responsible for marking tasks complete

#### Scenario: Agent observes the rule in orchestrated mode

- **WHEN** the `fullstack-developer` agent is invoked by `/dev-cycle` with a `task` input
  and finishes implementing it
- **THEN** the agent does not include any edit, write, or shell command that would alter
  the contents of `openspec/changes/<name>/tasks.md`

### Requirement: dev-cycle gotchas documentation is present and discoverable

The file `docs/dev-cycle.md` SHALL contain a "Gotchas" section that documents at least the
following four pitfalls discovered in retrospective 001, each with a short explanation and a
pointer to the file that demonstrates the workaround:

1. `NEXT_PUBLIC_*` environment variables are inlined into the Next.js edge runtime bundle at
   build time, so the URL/port a build references cannot vary at runtime between e2e
   suites that share a single build artifact.
2. Playwright's `webServer` plugin spawns the server before `globalSetup` runs, so any env
   var set inside `globalSetup` does not reach the spawned server; a `start-server.ts`
   wrapper is the canonical workaround.
3. `playwright.auth-real.config.ts` reads `npx supabase status -o json` synchronously at
   config-load time as a consequence of (2); contributors editing it MUST understand that
   it is the same problem as (2) and not introduce a `globalSetup`-based fix.
4. The `supabase status -o json` payload uses `API_URL`, `DB_URL`, `ANON_KEY`,
   `SERVICE_ROLE_KEY` (uppercase + underscore) keys, not camelCase as other CLI outputs do.

The section MUST also link to the reusable mock GoTrue helper introduced by this change so
readers can find it from the gotchas entry.

#### Scenario: A new contributor finds the gotchas after reading dev-cycle.md

- **WHEN** a contributor reads `docs/dev-cycle.md` end-to-end
- **THEN** they encounter a section titled "Gotchas" (or equivalent unambiguous heading)
  that names the four pitfalls above and links to `lib/test-utils/mock-gotrue.ts`

#### Scenario: Gotchas list is verifiable mechanically

- **WHEN** a CI check or maintainer runs `grep -E "NEXT_PUBLIC|webServer|globalSetup|supabase status" docs/dev-cycle.md`
- **THEN** at least one match is returned for each of the four pitfalls (the section is
  present and minimally addresses each topic)
