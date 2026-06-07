---
name: testcontainers-reuse-dirty-state
description: integration container uses .withReuse() with NO teardown; stale rows across days cause spurious FK/count failures — docker rm -f to get clean slate
metadata:
  type: feedback
---

The integration Postgres (`src/__tests__/integration/setup/global-setup.ts` → `bootPostgres`) uses Testcontainers `.withReuse()` and returns a NO-OP teardown — the container stays alive between runs (the comment says "Use `docker rm -f` manually if you need a clean slate").

**Why:** speeds up local iteration, but rows accumulate across every run. A container left up for days collects hundreds of `auth.users`/`evolutions`/etc. rows. Tests that assert absolute counts (`SELECT id FROM auth.users` toHaveLength(1)) or that `DELETE FROM auth.users` cleanly (blocked by FK from `evolutions` etc.) then FAIL spuriously — looking like a regression from your change when it is pure dirty state.

**How to apply:** Before trusting an integration failure that involves leftover rows / FK-violation-on-cleanup / unexpected row counts, get a clean slate: `docker ps -aq --filter "label=org.testcontainers=true" | xargs -r docker rm -f`, then re-run. During the section-7 work, 49 spurious registration failures vanished after removing a 2-day-old reused container — the change (nullable consent column) was innocent. The sweep/CI run on fresh containers, so this is a local-only trap.
