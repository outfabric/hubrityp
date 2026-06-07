---
name: playwright-cli-invocation
description: Correct playwright-cli usage for browser QA — persistent session, open/goto/snapshot/eval, and that DB enum-style "status" is plain text
metadata:
  type: reference
---

The browser-QA tool is the global `playwright-cli` (NOT an `@anthropic/playwright-cli` npx package — don't go hunting in `.npm/_npx`). Read its skill at `<worktree>/.claude/skills/playwright-cli/SKILL.md`.

**Session is persistent across invocations** — each command reuses the same browser/page. Workflow:
- `playwright-cli open <url>` (or `goto <url>` after open) — prints Page URL/Title/Console-error-count + a snapshot file ref.
- `playwright-cli --raw snapshot ["<css/selector>"]` — accessibility tree with `[ref=eN]` ids; `[disabled]` and link `/url` show up here. `--raw` strips boilerplate. A frozen/disabled element shows as `generic [disabled]` with no `/url`; a working link shows as `link "..."` with `/url`.
- `playwright-cli --raw eval "el => el.getAttribute('aria-disabled')" eN` — read any attribute/computed style by ref (`getComputedStyle(el).cursor/opacity/pointerEvents`, `el.tagName`, `el.tabIndex`, `el.getAttribute('href')`).
- `playwright-cli --raw eval "() => window.location.pathname"` — assert navigation (click frozen item → pathname unchanged).
- `playwright-cli fill eN "text"`, `click eN`, `resize 375 812` (then re-snapshot — refs change after resize/nav), `screenshot --filename=...`.
- Close with `playwright-cli close-all`.

**Gotchas observed:**
- After `resize` or `goto`, take a fresh snapshot — refs (eN) are reassigned.
- A screenshot taken immediately after nav can capture a blank/tiny frame (~2KB PNG); a `resize` or a short settle re-renders it. Verify with `stat -c %s file.png` / `file file.png`.
- The Read tool may not visually render PNGs back in-session; rely on `--raw eval`/`snapshot` assertions for the actual checks and use `SendUserFile` to surface screenshots.
- Bash output in long batches can intermittently appear empty; prefer SHORT, SERIAL commands. Putting a command that errors in a parallel batch cancels the whole batch — keep risky/db commands solo.

Related: [[authenticated-browser-qa-setup]].
