---
name: "Dev Cycle"
description: "Closed-loop dev workflow for an OpenSpec change: per-section dev→tests→lint, end-of-change reviewer→QA→commits→PR."
category: Workflow
tags: [workflow, openspec, agents, hubrityp]
---

Closed-loop development workflow that consumes an existing OpenSpec change and orchestrates the three project subagents (`fullstack-developer`, `code-reviewer`, `qa-tester`) until the change is implemented, reviewed, QA-validated, committed, and opened as a PR.

**Input**: `/dev-cycle <change-name> [flags]` (kebab-case). If `<change-name>` omitted, infer from conversation context. If ambiguous, run `openspec list --json` and use **AskUserQuestion** to let the user pick.

**Flags**:
- `--force-qa`: bypass the skip-QA heuristic in step 5.0 and always run `qa-tester`. Default: false (heuristic decides).

**Pre-conditions** (verify upfront, abort with a clear message if missing):
- Change exists at `openspec/changes/<name>/` with at least `tasks.md` and `proposal.md`.
- `git` working tree on `main` is clean (no uncommitted changes that would conflict with worktree creation).
- `gh` is authenticated (`gh auth status`) — required for PR creation at the end.
- `docker` daemon running and Supabase CLI available (`npm run supabase:start` resolves) — required when QA runs. Step 5a brings up Supabase + app if needed; step 5e tears down only what step 5a started, and only when QA passes.

---

## Steps

### 1. Select and validate the change

```bash
openspec status --change "<name>" --json
```

- Parse `schemaName`. If ≠ `spec-driven`, abort with: "Only the spec-driven schema is supported by /dev-cycle today."
- Parse the artifact list. Read into context: `proposal.md`, `tasks.md`, `design.md` (if present), and every file under `openspec/changes/<name>/specs/`.
- Announce: "Using change: <name> (schema: spec-driven). Sections: S total, P already complete (M/M subtasks done)."

### 2. Setup the worktree (sibling)

Worktree path: `<repo-parent>/hubrityp-<name>` (i.e., sibling of the main repo).

```bash
WORKTREE="../hubrityp-<name>"
BRANCH="feature/<name>"

if git worktree list --porcelain | grep -q "$WORKTREE"; then
  echo "Reusing existing worktree at $WORKTREE on branch $BRANCH"
else
  git fetch origin main
  git worktree add "$WORKTREE" -b "$BRANCH" origin/main
fi

mkdir -p "$WORKTREE/.dev-cycle"
```

If `.gitignore` in the main repo doesn't already include `.dev-cycle/`, append it (one-time setup) so feedback artifacts never get staged.

### 3. Per-section loop (sequential)

Parse `tasks.md` from the worktree into **sections**. A section is a `## N. <title>` heading plus every line until the next `## ` heading or end of file. Subtasks are `- [ ] N.M ...` lines under the heading. The natural unit of work for the agent is **one section** — typically a coherent group of 3–11 subtasks.

For every section that contains at least one `- [ ]` subtask, in file order:

#### 3a. Pre-section sanity + agent invocation

**Pre-section sanity check** (assert before invoking the agent):

```bash
# Working tree must be clean — section-level commits land at end of each section.
git -C "$WORKTREE" diff --quiet HEAD || { echo "Working tree dirty at start of section <N> — abort"; exit 1; }
```

If a section is in **mixed state** (some `- [x]` AND some `- [ ]` subtasks), hard-stop with:
```
Section <N> is in mixed state (some [x], some [ ]). This can only happen via manual edit of tasks.md
between runs. Section atomicity requires either a full rerun (revert all [x] in this section to [ ])
or a clean state. Refusing to guess intent.
```

Then invoke `fullstack-developer` (Agent tool) in **section mode** with a prompt containing:

- **Scope marker**: "You are operating on worktree `<absolute-path>`. All file edits and bash commands must run inside it (`cd <path> && ...`). Do not touch the main repo working tree."
- **`section`** field: the literal section text from `tasks.md` — header `## N. <title>` plus every subtask line (`- [ ] N.M ...`) and any prose paragraphs between them. Plus relevant excerpts from `proposal.md`, `design.md`, and the `specs/` files referenced by the section's subtasks.
- **Section-as-unit instruction**: "Implement every subtask in this section as a single unit of work. Do not pause between subtasks. Run scoped re-validation ONCE at the end of the section, not after each subtask. The orchestrator will atomically flip every `- [ ]` in this section to `- [x]` only on `VERDICT: PASS` — partial completion produces nothing."
- **Re-validation**: the agent follows its built-in "Re-validação escopada" contract (defined in `.claude/agents/fullstack-developer.md`). It decides which layers to run based on the nature of the files changed — from skip-total (non-code sections) through lint+typecheck+unit+integration+e2e (UI flows). **Per-section, every layer is scoped**: lint runs on the changed files (`eslint <files>`), unit runs `--changed` (Vitest derives affected tests from git), typecheck runs whole-program but incremental (`tsc` can't be safely file-scoped), and integration (`--changed`) / e2e (`--grep`) are scoped as before. **No layer runs full in section mode.** The regression sweep (step 3c) runs integration + e2e full; full lint/typecheck/unit are backstopped by CI (step 9), never by the sweep.
- **E2E seeded tests are self-contained**: `npm run test:e2e:seeded` boots its own Postgres via Testcontainers and uses mock GoTrue — it does NOT need `supabase start`, `docker compose up`, or any external infrastructure. When a section creates or modifies files under `src/__tests__/e2e/seeded/`, the agent MUST run those specs as part of scoped re-validation. NEVER instruct the agent to "just create test files without running them" — that instruction caused 3 broken specs to ship to CI unexecuted.
- **Reporting contract**: end the response with one of:
  - `VERDICT: PASS — implementation complete, tests pass, npm run check green.`
  - `VERDICT: FAIL — <one-line reason, including which subtask broke if applicable>. Logs: <path under .dev-cycle/>.` (Save full logs to `<worktree>/.dev-cycle/section-<N>-fail.log`.)
- **Iteration cap**: "You may iterate internally up to 3 times to fix failing tests or lint errors. After 3 failed attempts, return FAIL with the root-cause diagnosis."

#### 3b. Process the result

- If `PASS`:
  1. **Atomically flip all `- [ ] N.M` lines in section N to `- [x] N.M`** in `tasks.md`. Use `Edit` per line (each subtask line is unique because of the `N.M` prefix + free text). Do not use sed/awk on the whole file. If any individual line edit fails (line text changed unexpectedly between read and edit), abort with a diagnostic — never half-flip a section.
  2. Stage everything in the working tree: `git -C "$WORKTREE" add -A`.
  3. Commit with a Conventional Commits subject derived from the **section title** (not subtask titles). Lowercase the title for the subject; preserve original casing in the body bullets. Type heuristic:
     - Default: `feat: <section title lowercased>`
     - Title contains `test`/`testes`: `test: <section title>`
     - Title contains `doc`/`documenta`: `docs: <section title>`
     - Title contains `fix`/`bug`/`corrige`: `fix: <section title>`
     - Title contains `validação final` / `ci` / `tooling` / `setup`: `chore: <section title>`
     - Body shape:
       ```
       OpenSpec change: <name>

       Subtasks completed:
       - N.1 <subtask text>
       - N.2 <subtask text>
       ...

       Co-Authored-By: <follow repo convention from `git log`>
       ```
  4. **Hooks must run** (no `--no-verify`). If pre-commit hooks fail, treat as a fix-iteration trigger: re-invoke the agent with the hook output as synthetic feedback. The agent's internal retry budget covers it (cap 3, same as test/lint failures).
  5. Move to the next section. Next section's agent invocation will see `git diff HEAD --name-only` reflecting only its own work.
- If `FAIL`: stop the loop. Print a summary (which section + which subtask broke, the FAIL reason line, the log path) and wait for the user. Do not attempt the next section. The working tree is left dirty with the agent's partial work; the user can amend, revert, or instruct continuation. **Do not commit on FAIL** and **do not flip any subtask to `[x]`** — atomicity is per-section: a section is either fully done + committed or fully pending.

#### 3c. End-of-sections regression sweep (self-healing)

After every section is fully complete (all subtasks `[x]`) and committed, run the regression sweep before invoking the reviewer. It runs **integration + e2e full** to catch cross-section drift that scoped per-section re-validation can miss (section 5 broke an integration test from section 2 whose import graph the scoped run doesn't touch), and **fixes any regression it finds in the same invocation** — no orchestrator round-trip.

**The sweep is delegated to `fullstack-developer` in sweep mode, and the agent self-heals.** The orchestrator does not run `npm run test:*` directly. Its job here is only: (a) compute the log path, (b) invoke the agent once, (c) on PASS commit any fixes the agent applied, (d) on FAIL escalate.

```bash
cd "$WORKTREE"

# Pick the next sweep number (resume-safe).
SWEEP_N=$(( $(ls .dev-cycle/sweep-*.log 2>/dev/null | wc -l) + 1 ))
SWEEP_LOG="$(pwd)/.dev-cycle/sweep-${SWEEP_N}.log"
```

Then invoke `fullstack-developer` (Agent tool) in **sweep mode** with:

- **Scope marker**: `worktree_path = <absolute-path>`.
- **Mode**: `sweep`.
- **Flags**: `sweep_log_path = <absolute path to $SWEEP_LOG>`.
- **Instruction**: "Run `npm run test:integration` (full) and `npm run test:e2e:seeded` (full), appending output to `sweep_log_path`. If either fails, fix the regression in-place and re-run integration + e2e to confirm (internal cap 3). Only after a fix, run a **scoped** lint + unit re-check (`eslint <changed>`, `npm run test:unit -- --changed`) plus whole-program incremental `typecheck`. Do NOT run full lint/typecheck/unit, and do NOT touch `tasks.md` or commit — leave fixes in the working tree."
- **Reporting contract**:
  - `VERDICT: PASS — sweep clean (integration: X tests, e2e: Y tests)`
  - `VERDICT: PASS — sweep self-healed: <summary of fixes>`
  - `VERDICT: FAIL — <one-line cause>. Logs: <sweep_log_path>`

Note: full lint/typecheck/unit are **never** run in the sweep — they ran scoped per-section, and CI (step 9) runs them full as the backstop. Their only appearance here is the scoped re-check the agent runs after applying a fix.

**CRITICAL — both suites are self-contained**: `test:integration` and `test:e2e:seeded` both use Testcontainers (Postgres in Docker) and mock GoTrue. They do NOT require `supabase start`, `docker compose up`, or any external infrastructure. The agent MUST run both — NEVER skip either suite. Any justification to skip (e.g., "requires Supabase", "infrastructure not available") is incorrect and has historically caused broken tests to ship to CI.

**Branch on the agent's verdict:**

- `VERDICT: PASS — sweep clean` (no fix applied; working tree clean) → "Regression sweep clean — proceeding to reviewer." Go to step 4.
- `VERDICT: PASS — sweep self-healed` (fixes in the working tree) → commit them as a **single** Conventional Commit, then go to step 4:
  ```bash
  git -C "$WORKTREE" add -A
  git -C "$WORKTREE" commit -m "$(cat <<EOF
  fix: regression sweep

  OpenSpec change: <name>
  <one-line summary of what the sweep self-healed>
  EOF
  )"
  ```
  Hooks run normally; a hook failure routes back to the agent as a fix-iteration (its cap-3 budget). If the agent reported `self-healed` but the working tree is clean, treat it as an inconsistency and escalate.
- `VERDICT: FAIL` (agent could not converge within its internal cap 3) → escalate: print the persistent failures, point to `<worktree>/.dev-cycle/sweep-<N>.log`, and **do not** invoke the reviewer. Broken regressions never reach review.

### 4. End-of-sections: code-reviewer loop (cap 3)

Trigger only when every task in `tasks.md` is `[x]`. Initialize `REVIEW_ITER=0`.

#### 4a. Invoke `code-reviewer` (Agent tool)

Prompt:
- "Review the diff `main...feature/<name>` inside worktree `<absolute-path>`. Run `git -C <path> diff main...HEAD` to scope yourself."
- "Persist the full report to `<path>/.dev-cycle/review-<REVIEW_ITER+1>.md`."
- "End your response with a single parseable line: `VERDICT: approve` | `approve-with-comments` | `request-changes`."

Increment `REVIEW_ITER` after the agent returns.

#### 4b. Branch on verdict

- `approve` or `approve-with-comments` → proceed to step 5.
- `request-changes`:
  - If `REVIEW_ITER >= 3` → **stop**: print the persistent BLOCKER/HIGH list from `review-<REVIEW_ITER>.md`, escalate to user.
  - **Loop guard**: diff `review-<REVIEW_ITER>.md` against `review-<REVIEW_ITER-1>.md` (if it exists). If the BLOCKER/HIGH titles are identical, stop immediately ("non-converging loop") and escalate.
  - Otherwise: invoke `fullstack-developer` in **fix mode** (see step 6 prompt template), passing the review file path and the orchestrator's computed `changed_files`. Then re-invoke `code-reviewer` (back to 4a).

### 5. End-of-review: qa-tester loop (cap 3)

Initialize `QA_ITER=0`.

#### 5.0 Skip-QA decision gate

Before bringing up the app, evaluate the skip-QA heuristic. The goal is to avoid the cost of `qa-tester` (Playwright browser, ~2–5 min per iteration, cap 3 = up to 15 min) on backend-only changes.

**Skip QA if both signals pass** (logical AND):

```bash
# Signal 1: no UI keywords in #### Scenario: blocks under specs/
UI_KEYWORDS='visits|renders|clicks|sees|visual|navigates|page|form|button'
SIGNAL_1=$(! grep -irE -A 6 '^#### Scenario:' "$WORKTREE/openspec/changes/<name>/specs/" 2>/dev/null \
  | grep -iqE "$UI_KEYWORDS" && echo PASS || echo FAIL)

# Signal 2: diff main...HEAD doesn't touch UI paths
CHANGED=$(git -C "$WORKTREE" diff main...HEAD --name-only)
SIGNAL_2=$(! echo "$CHANGED" | grep -qE '^(src/app/\(app\)/|src/app/\(auth\)/|src/modules/[^/]+/components/|src/shared/ui/)' && echo PASS || echo FAIL)
```

Persist `CHANGED` for reuse in step 6 (fix-mode) — it's the same value the orchestrator computes there.

**Decision matrix**:

| `--force-qa` | Heuristic | Action |
|---|---|---|
| true | (any) | Run QA. Print: `QA forced by --force-qa flag (heuristic would have <skipped|run>: signals=<1>/<2>).` |
| false | both PASS | Skip QA. Print the skip message below. Jump to step 7. |
| false | any FAIL | Run QA. Print: `QA running — signal X failed: <reason>.` |

**Skip message** (printed when QA is skipped):

```
## QA Skipped — <change>

Heuristic concluded this change does not require browser QA:
  - Signal 1 (no UI keywords in spec scenarios):                        PASS
  - Signal 2 (diff doesn't touch src/app/(app)/, src/app/(auth)/, src/modules/<dom>/components/, src/shared/ui/): PASS

Skipping qa-tester. Proceeding to step 7 (archive) and step 8 (commits + PR).
To force QA on this change, re-invoke as: /dev-cycle <name> --force-qa
```

If skipping, do not initialize Docker (no `docker compose up`). Proceed directly to step 7.

#### 5a. Ensure Supabase + app are up (track ownership)

QA needs a real Supabase stack (Postgres + GoTrue + Kong) and the Next.js app. The orchestrator brings them up if needed and records what it started in `<worktree>/.dev-cycle/infra-owned.json` so step 5e tears down only what it owns. Resumed runs read the existing marker first to preserve ownership across `/dev-cycle <name>` re-invocations.

```bash
cd "$WORKTREE"

# Read existing marker (resumed run) or default to "I don't own anything yet".
OWNS_SUPABASE=$(jq -r '.supabase // false' .dev-cycle/infra-owned.json 2>/dev/null || echo false)
OWNS_APP=$(jq -r '.app // false' .dev-cycle/infra-owned.json 2>/dev/null || echo false)

# 1. Supabase: validate via the same CLI the @auth-real suite uses.
if ! npx supabase status -o json >/dev/null 2>&1; then
  if ! npm run supabase:start; then
    # Surface the CLI's stderr in the escalation, mirroring readSupabaseStatus()
    # in playwright.real.config.ts. Don't collapse it into "bootstrap failed".
    exit 1
  fi
  OWNS_SUPABASE=true

  # Orchestrator-owned startup → reset DB so QA gets a clean state.
  # If Supabase was already up (user-owned), DO NOT reset — we'd wipe their data.
  npm run supabase:reset
fi

# 2. Inject Supabase keys into .env.local so the Next.js container picks them up.
# docker-compose.yml only injects DATABASE_URL and NEXT_PUBLIC_SUPABASE_URL via
# hardcoded service hostnames; ANON_KEY and SERVICE_ROLE_KEY must come from the
# running CLI. We write them unconditionally (idempotent) — the values are stable
# for the lifetime of the local stack.
SUPABASE_STATUS_JSON=$(npx supabase status -o json)
ANON_KEY=$(echo "$SUPABASE_STATUS_JSON" | jq -r '.ANON_KEY')
SERVICE_ROLE_KEY=$(echo "$SUPABASE_STATUS_JSON" | jq -r '.SERVICE_ROLE_KEY')
if [ -z "$ANON_KEY" ] || [ "$ANON_KEY" = "null" ]; then
  echo "Could not read ANON_KEY from supabase status — aborting"; exit 1
fi
# Remove stale entries if present, then append current values.
grep -v 'NEXT_PUBLIC_SUPABASE_ANON_KEY\|SUPABASE_SERVICE_ROLE_KEY' .env.local > .env.local.tmp 2>/dev/null || true
mv .env.local.tmp .env.local 2>/dev/null || true
printf 'NEXT_PUBLIC_SUPABASE_ANON_KEY=%s\nSUPABASE_SERVICE_ROLE_KEY=%s\n' \
  "$ANON_KEY" "$SERVICE_ROLE_KEY" >> .env.local

# 3. App
if ! curl -sf http://localhost:3000 >/dev/null; then
  if ! docker compose up -d; then
    exit 1
  fi
  OWNS_APP=true
fi

# Poll readiness up to 120s; escalate on timeout.
for i in $(seq 1 60); do
  curl -sf http://localhost:3000 >/dev/null && break
  sleep 2
done
curl -sf http://localhost:3000 >/dev/null || { echo "App not reachable after 120s"; exit 1; }

# 4. Persist marker (overwrites — fresh source of truth for step 5e).
mkdir -p .dev-cycle
cat > .dev-cycle/infra-owned.json <<EOF
{
  "supabase": $OWNS_SUPABASE,
  "app": $OWNS_APP,
  "started_at": "$(date -u -Iseconds)"
}
EOF
```

**Ownership matrix** (drives step 5e):

| Initial state             | Bootstrap action                     | Marker                          |
|---------------------------|--------------------------------------|---------------------------------|
| Both already up           | Reuse; no DB reset                   | `{supabase: false, app: false}` |
| Supabase up, app down     | Start app                            | `{supabase: false, app: true}`  |
| Both down                 | Start Supabase, reset DB, start app  | `{supabase: true, app: true}`   |
| Supabase down, app up     | Start Supabase, reset DB             | `{supabase: true, app: false}`  |

The "I started it → I reset the DB" policy is deliberate: never wipe a Supabase the user is also using; always reset one we just brought up so QA sees a clean fixture.

This diverges from the `@auth-real` suite's "validate-only, fail loud" pattern (`playwright.real.config.ts:readSupabaseStatus`). The divergence is conscious — the suite is a one-shot test runner the user invokes manually; `/dev-cycle` is an end-to-end workflow that owns its scratch space.

#### 5b. Extract scenarios from the change's specs

Read every file under `openspec/changes/<name>/specs/` and extract every block under a `#### Scenario:` heading (spec-driven schema convention). Keep the literal text. Build a numbered list:

```
1. Scenario: <heading from spec>
   <full GIVEN/WHEN/THEN body>
2. Scenario: ...
```

If no scenarios are present, fall back to the acceptance criteria section of `proposal.md`. If neither exists, escalate to user (we cannot anchor QA without criteria).

#### 5c. Invoke `qa-tester` (Agent tool)

Prompt:
- **Base URL**: `http://localhost:3000`.
- **Scenarios**: the full numbered list from 5b. "Validate every scenario in the browser. For each scenario, mark `Scenario N: PASS` or `Scenario N: FAIL — <reason>`."
- **Free exploration**: after the scripted scenarios, run adjacent exploratory testing on the affected flows (visual, accessibility, edge cases per the agent's checklist).
- **Persistence**: "Save the full report to `<worktree>/.dev-cycle/qa-<QA_ITER+1>.md`."
- **Reporting contract**: end with `VERDICT: clean` (no CRÍTICO/ALTO/MÉDIO) or `VERDICT: issues-found`.

Increment `QA_ITER` after the agent returns.

#### 5d. Branch on verdict

- `clean` → proceed to step 5e (teardown), then step 6.
- `issues-found`:
  - If `QA_ITER >= 3` → stop and escalate. **Do NOT run step 5e** — leave infra up for inspection (see escalation message below).
  - **Loop guard**: same as 4b — compare CRÍTICO/ALTO/MÉDIO titles between `qa-<QA_ITER>.md` and `qa-<QA_ITER-1>.md`; halt on identical lists. Same teardown rule: leave infra up.
  - Otherwise: invoke `fullstack-developer` in **fix mode** (see step 6 prompt), passing the QA report path. Then re-invoke `code-reviewer` (one short pass on the new diff — `review-after-qa-<QA_ITER>.md`); if it stays clean, re-invoke `qa-tester` (back to 5c). If the short review fails, treat it as a normal review-fix loop (subject to its own 3-iter cap, shared budget with step 4).

#### 5e. Teardown (orchestrator-owned only, on QA clean)

Runs only when step 5d returned `VERDICT: clean`. Skipped on:
- `VERDICT: issues-found` with cap hit or non-converging loop (infra left up so the user can inspect).
- Any earlier escalation in steps 5a–5d.
- QA skipped at step 5.0 (no marker was written; nothing to tear down).

```bash
cd "$WORKTREE"
[ -f .dev-cycle/infra-owned.json ] || exit 0

OWNS_APP=$(jq -r '.app' .dev-cycle/infra-owned.json)
OWNS_SUPABASE=$(jq -r '.supabase' .dev-cycle/infra-owned.json)

if [ "$OWNS_APP" = "true" ]; then
  docker compose down
fi
if [ "$OWNS_SUPABASE" = "true" ]; then
  npm run supabase:stop
fi
rm -f .dev-cycle/infra-owned.json
```

**Escalation message when leaving infra up** (printed at the cap-hit / non-converging point in step 5d, *before* exiting):

```
QA escalated — infra left up for inspection.
Marker: <worktree>/.dev-cycle/infra-owned.json indicates what /dev-cycle started.
Manual teardown (only what's orchestrator-owned):
  jq -r '.supabase' <worktree>/.dev-cycle/infra-owned.json  # true → npm run supabase:stop
  jq -r '.app' <worktree>/.dev-cycle/infra-owned.json       # true → docker compose down
```

### 6. Fix-mode prompt template (used by 4b and 5d)

When invoking `fullstack-developer` to address feedback:

- **Scope**: worktree path (same as before).
- **Feedback file**: absolute path to `review-N.md` or `qa-N.md`.
- **Fix instruction**: "Address every BLOCKER/HIGH from the review (or every CRÍTICO/ALTO/MÉDIO from the QA report). Do not introduce out-of-scope refactors."
- **Re-validation**: the agent follows its built-in "Modo fix: full" contract (defined in `.claude/agents/fullstack-developer.md`). At the end of the fix iteration — before returning `VERDICT: PASS` — the agent MUST run, in order: `npm run lint`, `npm run typecheck`, `npm run test:unit` (full), `npm run test:integration` (full — never `--changed`), and `npm run test:e2e:seeded` (full — never path-filtered). All five are mandatory regardless of which files the fix touched. Rationale: fix-mode is invoked precisely because reviewer or QA found regression in code that already passed per-section scoped validation; scoped re-runs here have historically let regressions slip into the next iteration, defeating the loop.
- **Reporting contract**: same `VERDICT: PASS` / `VERDICT: FAIL` lines as step 3b. The pre-VERDICT block must list which suites ran and their test counts so the orchestrator can audit that full re-validation actually happened.

The orchestrator still computes `changed_files` (`git diff <fix-base>...HEAD --name-only`) and passes it to the agent — but in fix mode it is **context only** (helps the agent map review/QA feedback to the affected files), not used to scope test runs.

### 7. Archive in-place

Trigger only when reviewer is clean AND (QA is clean OR QA was skipped at step 5.0). The change is archived inside the worktree on `feature/<name>` so the move + sync land in the same PR as the implementation. **No prompts to the user** — this step is fully non-interactive (defaults below); failures hard-stop before any commits/PR are created.

This step is the inline equivalent of `/opsx:archive` running with all confirmations auto-accepted as "proceed". The standalone `/opsx:archive` command continues to exist for ad-hoc archives outside `/dev-cycle`.

#### 7.1 Validate

```bash
openspec status --change "<name>" --json
```

- If any artifact ≠ `done`: hard error (this should never happen at this point — flag as orchestrator bug and abort).
- If any task in `tasks.md` is `- [ ]`: hard error (step 3 of `/dev-cycle` guarantees all tasks are `[x]`; flag as bug and abort).

#### 7.2 Sync delta specs → main specs

If `openspec/changes/<name>/specs/` is empty: skip (docs-only change, no sync needed). Announce: "No delta specs found — sync skipped."

Otherwise, invoke `fullstack-developer` with a sync prompt (semantically equivalent to `/opsx:sync` in non-interactive mode):

- **Scope marker**: same worktree path constraint as other agent invocations.
- **Sync instruction**: "For each capability dir under `openspec/changes/<name>/specs/`, compare the delta spec with `openspec/specs/<capability>/spec.md` and apply ADDED/MODIFIED/REMOVED/RENAMED operations to bring the main spec in line with the delta. Do not ask for confirmation — apply all changes."
- **Output**: persist a summary to `<worktree>/.dev-cycle/sync-summary.md` listing capabilities touched and operations applied.
- **Reporting contract**: end with `VERDICT: PASS — sync applied` or `VERDICT: FAIL — <reason>`.

If FAIL: pause and show `sync-summary.md`. Do **not** default to skip-sync — sync was promised to the user.

#### 7.3 Move directory

```bash
cd "$WORKTREE"
mkdir -p openspec/changes/archive
DATED="openspec/changes/archive/$(date +%F)-<name>"
if [ -d "$DATED" ]; then
  echo "Archive target already exists at $DATED"
  echo "Options: rename existing archive, delete it (if duplicate), or wait until a different date."
  exit 1
fi
mv "openspec/changes/<name>" "$DATED"
```

Hard-stop on collision (same policy as `/opsx:archive`).

### 8. Commits and PR

Once archive (step 7) completed without unresolved errors:

#### 8a. Per-section commits (already done in step 3b)

Per-section Conventional Commits were created incrementally during step 3b — one commit per section in `tasks.md` order, with subjects derived from the section title (`feat:`/`fix:`/`test:`/`docs:`/`chore:`) and a body listing the subtasks completed plus `OpenSpec change: <name>`. Plus any commits from sweep fixes (step 3c) and review/QA fix iterations (steps 4–5), each made at the time of the fix.

Verify the linear history before proceeding to 8b:

```bash
git -C "$WORKTREE" log --oneline main..HEAD
```

If a section is missing a commit or has a non-CC subject, abort with a diagnostic — this indicates a bug in step 3b or a manual intervention after a step-3b failure that didn't restore the contract. Per-section isolation is by construction; do not fall back to a single combined commit.

#### 8b. Dedicated archive commit

After 8a, stage and commit everything the archive step (7) produced as a single dedicated commit:

```bash
cd "$WORKTREE"
git add \
  openspec/changes/archive/$(date +%F)-<name>/ \
  openspec/specs/
git commit -m "chore(openspec): archive <name> + sync specs

OpenSpec change: <name>
- Archived to openspec/changes/archive/$(date +%F)-<name>/
- Synced delta specs into openspec/specs/<cap>/spec.md (see .dev-cycle/sync-summary.md)"
```

Notes:
- The `mv` from step 7.3 shows up as a rename in `git status`; `git add openspec/changes/archive/<dated>/` stages the rename plus any modifications.
- `git add openspec/specs/` picks up sync edits from step 7.2.
- If `git status` shows untracked files outside these paths, **do not** stage them blindly — pause and ask the user.
- If pre-commit hooks fail, treat as a fix-iteration trigger (route back to step 6, scoped re-validation).

#### 8c. Push and open PR

```bash
git -C "$WORKTREE" push -u origin "$BRANCH"

# Capture the PR URL — gh pr create prints it to stdout on success.
# Step 9 (CI watch) depends on this variable.
PR_URL=$(gh pr create \
  --base main \
  --head "$BRANCH" \
  --title "<change title from proposal.md>" \
  --body "$(cat <<'EOF'
## OpenSpec change
- Name: <name>
- Archived to: openspec/changes/archive/YYYY-MM-DD-<name>/

## Summary
<extracted from proposal.md>

## Tasks completed
<bulleted list from tasks.md, all checked>

## Archive
- Specs synced: <list of openspec/specs/<cap>/spec.md touched, or "none — docs-only change">

## Evidence
- Code review: .dev-cycle/review-N.md (final iteration)
- QA report: .dev-cycle/qa-N.md (final iteration, or "skipped — backend-only heuristic" / "skipped — --force-qa override")
- Re-validation iterations: dev↔reviewer X/3, dev↔QA Y/3
EOF
)")
echo "PR opened: $PR_URL"
```

Persist `$PR_URL` for step 9 (and for resume — if the orchestrator is interrupted between 8c and 9 finishing, step 9 reads it back via `gh pr view --json url` on the current branch):

```bash
echo "$PR_URL" > "$WORKTREE/.dev-cycle/pr-url.txt"
```

### 9. Watch CI until green

Trigger immediately after step 8c succeeds. Initialize `CI_ITER=0`. The orchestrator does NOT merge the PR — it only ensures CI is green. Merge stays a human decision.

#### 9.0 Pre-flight — does the PR have any CI checks?

GitHub takes a few seconds to register workflow runs after a push. Wait up to 30s for at least one check to appear:

```bash
CHECK_COUNT=0
for i in $(seq 1 15); do
  CHECK_COUNT=$(gh pr checks "$PR_URL" --json name 2>/dev/null | jq 'length' 2>/dev/null || echo 0)
  if [ "${CHECK_COUNT:-0}" -gt 0 ]; then
    break
  fi
  sleep 2
done

if [ "${CHECK_COUNT:-0}" -eq 0 ]; then
  echo "No CI checks configured for this PR — skipping watch."
  # Skip step 9 entirely; jump to Final summary.
  # CI is reported as "skipped — no checks configured".
fi
```

If the count stays zero after 30s, treat the repo as having no PR-triggered workflows and skip step 9 entirely. The final summary records this explicitly so the user knows CI wasn't validated.

#### 9a. Watch CI (blocking)

On iteration ≥ 2 (i.e., after a fix-push in 9f), the `git push` triggers a fresh workflow run on GitHub. Wait for it to register before watching, otherwise `gh pr checks --watch` might return immediately observing the stale (previously-failed) terminal state of the prior commit's checks:

```bash
if [ "$CI_ITER" -gt 0 ]; then
  # Wait for a pending check on the new commit before watching.
  for i in $(seq 1 15); do
    HAS_PENDING=$(gh pr checks "$PR_URL" --json bucket 2>/dev/null \
      | jq 'any(.[]; .bucket == "pending")')
    [ "$HAS_PENDING" = "true" ] && break
    sleep 2
  done
fi

gh pr checks "$PR_URL" --watch --fail-fast || true

# Read final state from JSON — gh's exit codes are ambiguous here:
# exit 8 means "checks pending" (not failure), so we MUST probe JSON for the verdict.
CHECKS_JSON=$(gh pr checks "$PR_URL" --json name,state,bucket,link,workflow)
HAS_RED=$(echo "$CHECKS_JSON" | jq 'any(.[]; .bucket == "fail" or .bucket == "cancel")')
```

`gh pr checks --watch` blocks until every check reaches a terminal state (`pass`, `fail`, `skipping`, `cancel`). `--fail-fast` makes it exit as soon as one check fails so we don't wait on slower-but-irrelevant jobs.

#### 9b. Branch on result

- `HAS_RED == false` (all green / skipping) → proceed to Final summary. The PR is clean.
- `HAS_RED == true` (at least one `fail` or `cancel` bucket):
  - If `CI_ITER >= 3` → **stop**: print the PR URL, the persistent failed-check names from `ci-fail-<CI_ITER>.md`, escalate to user.
  - **Loop guard**: when `CI_ITER >= 1`, compute the current failure signature as the sorted set of `name|bucket` lines and compare to `.dev-cycle/ci-fail-<CI_ITER>.signature.txt` (written by the previous iteration). If identical, halt immediately ("non-converging CI loop") and escalate with the PR URL.
  - Otherwise: go to 9c.

#### 9c. Persist synthetic feedback (`ci-fail-<N>.md`)

```bash
CI_ITER=$((CI_ITER + 1))
FEEDBACK="$WORKTREE/.dev-cycle/ci-fail-${CI_ITER}.md"
SIGNATURE="$WORKTREE/.dev-cycle/ci-fail-${CI_ITER}.signature.txt"

# Persist signature for next-iteration loop guard.
echo "$CHECKS_JSON" \
  | jq -r '.[] | select(.bucket == "fail" or .bucket == "cancel") | "\(.name)|\(.bucket)"' \
  | sort > "$SIGNATURE"

# Build feedback file: which checks failed + their run IDs. NO logs — the agent
# investigates the failing logs itself via `gh run view <run-id> --log-failed`
# (step 9d). The orchestrator identifies WHICH checks failed; the agent diagnoses WHY.
{
  echo "# CI failure (iteration $CI_ITER)"
  echo ""
  echo "**PR**: $PR_URL"
  echo ""
  echo "**Investigate yourself**: this file lists only which checks failed and their run IDs. Read each failing run's logs with \`gh run view <run-id> --log-failed\` (from inside the worktree) to find the root cause — they are NOT embedded here."
  echo ""
  echo "**Forced full re-validation**: at the end of your fix, run lint + typecheck + test:unit + test:integration + test:e2e:seeded (all full, never scoped). This is the standard fix-mode contract — the regression escaped per-section scoped validation, so we re-validate everything before pushing."
  echo ""
  echo "**Flaky exception**: if you diagnose any of the failures below as genuinely transient (network blip, GitHub Actions infra hiccup, unrelated cache miss, runner provisioning failure) and NOT caused by code on this branch, return \`VERDICT: PASS — flaky, no code change required\` without modifying code. The orchestrator will rerun the failed jobs. Use this only when you can identify the transient cause — do not use it to dodge real failures."
  echo ""
  echo "## Failed checks"
  echo "$CHECKS_JSON" \
    | jq -r '.[] | select(.bucket == "fail" or .bucket == "cancel") | "- **\(.name)** (workflow: \(.workflow), bucket: \(.bucket)) — \(.link)"'
  echo ""
  echo "## Failed run IDs (investigate each with: gh run view <id> --log-failed)"
  echo "$CHECKS_JSON" \
    | jq -r '.[] | select(.bucket == "fail" or .bucket == "cancel") | .link' \
    | grep -oE 'runs/[0-9]+' | cut -d/ -f2 | sort -u \
    | while read -r RUN_ID; do echo "- $RUN_ID"; done
} > "$FEEDBACK"
```

#### 9d. Invoke `fullstack-developer` in fix mode

Use the fix-mode prompt template from step 6, with these CI-specific extras:

- `feedback_file = $FEEDBACK` (the `ci-fail-${CI_ITER}.md` from 9c).
- Extra instruction (verbatim): "This feedback file is a CI failure (`ci-fail-N.md`), not a review or QA report. It lists only WHICH checks failed and their run IDs — no logs are embedded. **Investigate the cause yourself**: for each failed run ID listed under 'Failed run IDs', run `gh run view <run-id> --log-failed` (inside the worktree) to read the failing job logs and diagnose the root cause. Then either fix it (and follow your fix-mode full re-validation contract: lint + typecheck + test:unit + test:integration + test:e2e:seeded, all full) OR, if the failures are genuinely transient and unrelated to code on this branch, return `VERDICT: PASS — flaky, no code change required` without modifying code."

Three possible verdicts back from the agent:

- `VERDICT: PASS — flaky, no code change required` → go to 9e (rerun failed jobs without code changes).
- `VERDICT: PASS — <fix description>` → go to 9f (commit + push).
- `VERDICT: FAIL — <root cause>. Logs: <path>` → stop, escalate with PR URL + feedback file path.

#### 9e. Flaky path — rerun failed jobs

Defensive check that the agent didn't accidentally modify code while claiming flaky:

```bash
if ! git -C "$WORKTREE" diff --quiet HEAD; then
  echo "Agent returned 'flaky' verdict but working tree has uncommitted changes — refusing to rerun jobs."
  echo "Inspect the tree and decide whether to discard the changes or treat the run as a real fix."
  exit 1
fi
```

Then rerun only the failed jobs on each affected run:

```bash
echo "$CHECKS_JSON" \
  | jq -r '.[] | select(.bucket == "fail" or .bucket == "cancel") | .link' \
  | grep -oE 'runs/[0-9]+' | cut -d/ -f2 | sort -u \
  | while read -r RUN_ID; do
      gh run rerun "$RUN_ID" --failed
    done
```

Go back to 9a. `CI_ITER` was already incremented in 9c — three consecutive flaky classifications is itself suspicious enough to escalate at the cap.

#### 9f. Real fix path — commit + push

The agent's fix-mode contract leaves the working tree with the fix changes. Commit and push:

```bash
SUMMARY="<text after the em-dash in the agent's 'VERDICT: PASS — <text>' line, lowercased>"

git -C "$WORKTREE" add -A
git -C "$WORKTREE" commit -m "$(cat <<EOF
fix(ci): $SUMMARY

OpenSpec change: <name>
CI iteration: $CI_ITER
PR: $PR_URL
EOF
)"

git -C "$WORKTREE" push
```

Subject convention: `fix(ci): <summary>` (Conventional Commits). If pre-commit hooks fail, treat as part of the agent's fix-mode retry budget (cap 3, same convention as step 3b) — re-invoke the agent with the hook output as synthetic feedback. Hook failures here are unexpected because fix mode already ran lint + typecheck + tests full locally before returning `PASS`, so a hook failure indicates a discrepancy worth surfacing in the iteration log.

Go back to 9a — the new push triggers a fresh CI run.

**Note on reviewer/QA after CI fix**: by design, the orchestrator does **not** re-invoke `code-reviewer` or `qa-tester` after a CI fix iteration. Justification:

- Fix mode already ran full re-validation locally (lint + typecheck + unit + integration + e2e) before returning `PASS`.
- `code-reviewer` and `qa-tester` already approved a closely-related diff in steps 4 and 5.
- Re-running both per CI iteration could add ~20 min × 3 iterations of cost for incremental fixes that are typically small.

If a CI fix introduces something review-worthy, it surfaces on the user's manual PR review before merge. This is a conscious cost trade-off; can be revisited if non-trivial fixes start showing up in step 9.

---

## Final summary (printed by the orchestrator)

```
## Dev Cycle Complete — <change>

Sections: S/S complete (M/M subtasks)
Worktree: ../hubrityp-<name>/ (branch: feature/<name>)
Review iterations: X/3
QA: <Y/3 | skipped (backend-only heuristic)>
CI: <green on first watch | green after Z/3 iterations | skipped — no checks configured>
Infra: <torn down (orchestrator-owned: supabase=<bool>, app=<bool>) | reused user-owned, no teardown | left up — QA escalated, manual teardown noted above>
Archive: openspec/changes/archive/YYYY-MM-DD-<name>/
  - Specs synced: <list or "none">
Commits created: <count> per-section + <0|1> sweep-fix commit + 1 archive commit + <Z> fix(ci) commits
Reports: .dev-cycle/{review-1.md, ..., qa-1.md, ..., sync-summary.md, ci-fail-1.md, ..., pr-url.txt, infra-owned.json (if QA escalated)}
PR: <url> (CI ✅ green)
```

---

## Loop prevention summary

| Loop | Cap | On cap-hit |
|---|---|---|
| Dev internal retries per section | 3 | Pause, show logs, wait for user |
| Regression sweep self-heal (internal to agent, step 3c) | 3 | Agent returns `VERDICT: FAIL`; orchestrator escalates, does not invoke reviewer |
| dev ↔ code-reviewer (post-sections) | 3 | Pause, list persistent BLOCKER/HIGH |
| dev ↔ qa-tester | 3 | Pause, list persistent CRÍTICO/ALTO/MÉDIO |
| dev ↔ CI (post-PR) | 3 | Pause, link PR + persistent failed checks from `ci-fail-N.md` |
| Same finding repeats 2× consecutively | immediate | Pause (non-converging signal — applies to reviewer, QA, and CI) |

---

## Resume behavior

`/dev-cycle <name>` is interruptible and idempotent:
- Detects an existing worktree and reuses it.
- Skips sections fully complete (every subtask `[x]`); refuses to resume a section in mixed `[x]`/`[ ]` state.
- Preserves prior `.dev-cycle/*.md` reports and counts them when applying iteration caps. This applies to every capped loop: dev↔reviewer (`review-*.md` → `REVIEW_ITER`), dev↔QA (`qa-*.md` → `QA_ITER`), and dev↔CI (`ci-fail-*.md` → `CI_ITER`). Resume picks up where the previous run stopped rather than starting from zero.
- Step 9 (CI watch) on resume: if `.dev-cycle/pr-url.txt` exists, reuse that URL; otherwise fall back to `gh pr view --json url --jq .url` on the current branch. If the prior run was mid-fix when interrupted (worktree dirty), the orchestrator stops and asks before deciding whether to discard or commit-and-push the dirty state.

---

## Out of scope

- Does not run in CI (this is a local-first workflow that needs a real browser for QA).
- Does not parallelize tasks within a change (sequential by design — ordering matters in OpenSpec tasks).
- Does not support OpenSpec schemas other than `spec-driven`.
- Does not create the change itself — use `/opsx:new` or `/opsx:ff` first.
