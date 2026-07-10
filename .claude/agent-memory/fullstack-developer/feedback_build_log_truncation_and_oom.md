---
name: build-log-truncation-and-oom
description: next build streamed to a background log can look "done + incomplete .next" mid-flight; concurrent test runs OOM-kill the build (exit 137)
metadata:
  type: feedback
---

When validating a `next build` (Next 16 + Turbopack) in this env, do NOT conclude the build failed just because `.next/BUILD_ID` is missing and the log tail stops at "Creating an optimized production build ..." — the log file write lags far behind the live process, and BUILD_ID only lands at the very end (after "Collecting page data" → the route table prints). Wait for the process to actually exit (`until ! pgrep -f "next build"`) before judging. A complete build prints the `Route (app)` table and writes `.next/BUILD_ID` (flat, not under `.next/build`).

**Why:** Burned a long fix-mode cycle on PR #96: read an in-progress build three times, each time saw incomplete `.next` + truncated log, misdiagnosed it as a broken page-data collection / workspace-root bug. It was just being read too early.

**How to apply:**
- The box has only ~7.6Gi RAM and no swap. A Turbopack prod build peaks ~2.4GB. Running `next build` while leftover `vitest`/`esbuild`/duplicate runs are alive → the build gets OOM-killed (exit **137**) at "Creating an optimized production build ...", leaving a stale `.next/lock` that makes the next build abort with "Another next build process is already running." Before building: `pkill -9 -f vitest; pkill -9 -f esbuild; pkill -9 -f "next build"`, confirm `free -h` shows ample free, then `sudo rm -rf .next` (a Docker dev server leaves a root-owned `.next/dev`).
- Run the build ALONE — never overlap it with test suites on this host.
- Local-only noise: a stray `/home/ubuntu/package-lock.json` makes Next warn about workspace-root inference. Harmless — it does not exist in CI; do NOT "fix" it by editing next.config in a fix-mode branch.
- See [[e2e-seeded-needs-fresh-build]] and [[e2e-seeded-build-env-block]].
