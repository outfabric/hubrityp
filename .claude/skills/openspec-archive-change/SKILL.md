---
name: openspec-archive-change
description: Archive a completed change in the experimental workflow. Use when the user wants to finalize and archive a change after implementation is complete.
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.1.1"
---

Archive a completed change in the experimental workflow.

**Input**: Optionally specify a change name. If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

**Steps**

1. **If no change name provided, prompt for selection**

   Run `openspec list --json` to get available changes. Use the **AskUserQuestion tool** to let the user select.

   Show only active changes (not already archived).
   Include the schema used for each change if available.

   **IMPORTANT**: Do NOT guess or auto-select a change. Always let the user choose.

2. **Check artifact completion status**

   Run `openspec status --change "<name>" --json` to check artifact completion.

   Parse the JSON to understand:
   - `schemaName`: The workflow being used
   - `artifacts`: List of artifacts with their status (`done` or other)

   **If any artifacts are not `done`:**
   - Display warning listing incomplete artifacts
   - Use **AskUserQuestion tool** to confirm user wants to proceed
   - Proceed if user confirms

3. **Check task completion status**

   Read the tasks file (typically `tasks.md`) to check for incomplete tasks.

   Count tasks marked with `- [ ]` (incomplete) vs `- [x]` (complete).

   **If incomplete tasks found:**
   - Display warning showing count of incomplete tasks
   - Use **AskUserQuestion tool** to confirm user wants to proceed
   - Proceed if user confirms

   **If no tasks file exists:** Proceed without task-related warning.

4. **Assess delta spec sync state**

   Check for delta specs at `openspec/changes/<name>/specs/`. If none exist, proceed without sync prompt.

   **If delta specs exist:**
   - Compare each delta spec with its corresponding main spec at `openspec/specs/<capability>/spec.md`
   - Determine what changes would be applied (adds, modifications, removals, renames)
   - Show a combined summary before prompting

   **Prompt options:**
   - If changes needed: "Sync now (recommended)", "Archive without syncing"
   - If already synced: "Archive now", "Sync anyway", "Cancel"

   If user chooses sync, execute /opsx:sync logic (use the openspec-sync-specs skill). Proceed to archive regardless of choice.

5. **Perform the archive**

   Create the archive directory if it doesn't exist:
   ```bash
   mkdir -p openspec/changes/archive
   ```

   Generate target name using current date: `YYYY-MM-DD-<change-name>`

   **Check if target already exists:**
   - If yes: Fail with error, suggest renaming existing archive or using different date
   - If no: Move the change directory to archive

   ```bash
   mv openspec/changes/<name> openspec/changes/archive/YYYY-MM-DD-<name>
   ```

6. **Generate or update technical docs (`docs/<capability>.md`)**

   For each capability touched by this change, generate or update a project docs file under `docs/`. Goal: enrich the working context for future developers and AI agents who need to make changes to that capability without re-reading every spec, archived change, and commit.

   **Identify affected capabilities**: list directories under `openspec/changes/archive/YYYY-MM-DD-<name>/specs/`. If none exist (e.g., docs-only change), skip this step entirely and note it in the final summary.

   **For each capability `<cap>`**:

   a. Read source material:
      - `openspec/specs/<cap>/spec.md` (post-sync source of truth; fall back to the archived delta if sync was skipped).
      - The archived `proposal.md`, `design.md` (if present), `tasks.md`.
      - Existing `docs/<cap>.md` if present (preserve manual edits and prior history entries).
      - Implementation files referenced in `design.md` / `tasks.md`. Inspect more code only if those artifacts don't already cover what you need — do not re-derive what the spec already states.

   b. Write or update `docs/<cap>.md` (in pt-BR, matching the existing docs style; code identifiers, file paths, and shell commands stay in English):

      - **Resumo** — 1–2 sentences on what this capability is and why it exists.
      - **Onde mora o código** — bullet list of the main files/folders implementing it, with relative paths (e.g., `app/api/health/route.ts`, `lib/health/db-probe.ts`).
      - **Superfície pública** — routes, server actions, exported components/utilities, env vars consumed/exposed, and any contract surface (response shapes, event names) downstream consumers depend on.
      - **Comportamento e invariantes** — edge cases, gotchas, and assumptions worth knowing before changing this code (e.g., "endpoint must remain unauthenticated", "transcrição nunca pode sair do Brasil", RLS policies, idempotency keys).
      - **Testes** — test files covering the capability and the layer of each (unit/integration/e2e), with relative paths.
      - **Histórico de changes** — bullet list of archived OpenSpec changes that touched this capability, **newest first**, in the form `- YYYY-MM-DD <change-name> — <one-line summary>` linking to `../openspec/changes/archive/<dated>/`. Append the just-archived change to the top; never drop prior entries.

   Keep the doc concise — it's a hand-off, not a re-statement of the spec. The spec at `openspec/specs/<cap>/spec.md` remains the formal source of truth; `docs/<cap>.md` is the human-readable map that points to code, contracts, and history.

   **Update vs. create**: when `docs/<cap>.md` already exists, edit in place — refresh sections that are now stale, append the change to the history, and preserve any manual content the user may have added (especially custom sections outside the template above).

7. **Display summary**

   Show archive completion summary including:
   - Change name
   - Schema that was used
   - Archive location
   - Whether specs were synced (if applicable)
   - Docs touched: list of `docs/<cap>.md` files created or updated (or "no delta specs — docs step skipped")
   - Note about any warnings (incomplete artifacts/tasks)

**Output On Success**

```
## Archive Complete

**Change:** <change-name>
**Schema:** <schema-name>
**Archived to:** openspec/changes/archive/YYYY-MM-DD-<name>/
**Specs:** ✓ Synced to main specs (or "No delta specs" or "Sync skipped")

All artifacts complete. All tasks complete.
```

**Guardrails**
- Always prompt for change selection if not provided
- Use artifact graph (openspec status --json) for completion checking
- Don't block archive on warnings - just inform and confirm
- Preserve .openspec.yaml when moving to archive (it moves with the directory)
- Show clear summary of what happened
- If sync is requested, use openspec-sync-specs approach (agent-driven)
- If delta specs exist, always run the sync assessment and show the combined summary before prompting
