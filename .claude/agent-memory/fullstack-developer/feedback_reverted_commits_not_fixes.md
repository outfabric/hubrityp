---
name: reverted-commits-not-fixes
description: A reverted commit in this repo is usually a FAILED attempt, not collateral damage — do not re-apply it as a known-good fix
metadata:
  type: feedback
---

When a commit was reverted on this repo, the default assumption must be that
**the fix did not work** — that is precisely why it was reverted. Do NOT treat a
reverted commit as a known-good solution to re-apply.

**Why:** During the CI date-bomb/e2e-real investigation (PR #89, 2026-06-19), a
chain of ~6 `fix(ci): ...` commits targeting the `@auth-real` suite was reverted
(`establish e2e-real session via GoTrue + cookie injection`, `capture and replay
session cookies`, `retry dashboard navigation after cookie propagation`, `build
e2e-real app after supabase start with real keys` = `374804e`, `reload after
login redirect to settle session cookie`). I assumed the revert was "collateral
damage" swept up before the #88 merge and re-applied `374804e`. The user
corrected me: the commits were reverted **because they failed to fix the
problem**. The escalating sequence (each attempt adding another workaround on top
of the last) is itself the tell that no single one worked.

**Nuance:** Not every line of a reverted commit is worthless — the *reminders
date-bomb* portion of `6d67072` (pin fixtures to 2030 + explicit createdAt) was
verified to genuinely work locally. Judge each change on its own merits and
**verify empirically**, rather than trusting the commit message of a reverted fix.

**How to apply:** Before re-applying anything from a reverted commit, (1) check
whether CI was red *while that commit was live* on main (`gh run list`/`gh run
view` for that SHA) — if it stayed red, the fix didn't work; (2) prefer
reproducing the failure and forming an independent diagnosis over re-running a
known-failed patch. See [[e2e-build-supabase-url-must-be-local]] for the related
NEXT_PUBLIC build-inlining gotcha that these attempts were circling.
