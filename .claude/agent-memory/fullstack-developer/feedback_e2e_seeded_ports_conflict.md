---
name: e2e-seeded-ports-conflict
description: e2e:seeded fails locally if docker dev container holds :3000 or Supabase CLI holds :54321; stop both before running
metadata:
  type: feedback
---

Running `npm run test:e2e:seeded` LOCALLY fails for environmental reasons unless two ports are free:

1. **:3000** — if a `docker compose up` dev container (e.g. `<worktree>-app-1` running `npm run dev`) is listening on 3000, Playwright's `reuseExistingServer: !process.env.CI` reuses that dev server instead of booting its own `start-server.ts`. The dev server's mock GoTrue uses a DIFFERENT JWT secret than the freshly-seeded token, so `auth.setup.ts` fails with `setSession failed — invalid JWT: signature is invalid`. Stop the container: `docker stop <worktree>-app-1`.
2. **:54321** — `start-server.ts` binds its mock GoTrue to the STABLE port 54321 (because `NEXT_PUBLIC_SUPABASE_URL` is inlined into the edge bundle at build time pointing there). The Supabase CLI stack's Kong also maps 54321, causing `EADDRINUSE 127.0.0.1:54321`. Stop the CLI stack: `npm run supabase:stop`.

**Why:** CI has neither the dev container nor the Supabase CLI stack running, so both ports are free and the suite is fully self-contained (Testcontainers Postgres + mock GoTrue). The seeded suite does NOT use the CLI Supabase stack — see [[date-relative-e2e-local-vs-ci]] / the project note that e2e:seeded is self-contained.

**How to apply:** before running `npm run test:e2e:seeded` locally, check `ss -ltnp | grep -E ':3000|:54321'`; stop the docker dev container (`docker stop ...app-1`) and `npm run supabase:stop` if they hold those ports. Remember to restart them afterward if the user is doing local dev.
