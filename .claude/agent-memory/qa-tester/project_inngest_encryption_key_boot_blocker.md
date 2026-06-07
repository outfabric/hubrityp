---
name: inngest-encryption-key-boot-blocker
description: INNGEST_ENCRYPTION_KEY is a required serverEnv var not set in docker-compose/.env.local — app 500s on every page at boot until injected
metadata:
  type: project
---

`INNGEST_ENCRYPTION_KEY` is declared `z.string().min(32)` (required, not optional) in `src/shared/env/schemas.ts`, but the local `docker-compose.yml` only sets `INNGEST_DEV` and `.env.local` does not include it. Result: `serverEnv` validation throws at `src/shared/env/index.ts:14`, and every server-rendered page returns HTTP 500 (`[env] Invalid server environment variables: { INNGEST_ENCRYPTION_KEY: ... }`). The orchestrator's "app is up" curl can pass on a static asset while all real pages are down.

**Why:** Introduced by the AI-transcription work (commit 3e7c7b4) which made the key required for `@inngest/middleware-encryption`. The local/CI env blocks were not all updated — instance of the known [[required-env-var-propagation]] failure mode (see user auto-memory: a new required var breaks vitest.setup, integration global-setup, e2e start-server, playwright.real, ci.yml ×2, docker-compose, Vercel).

**How to apply:** At the start of any local browser QA, check `/login` returns 200 (not just root). If 500, grep app logs for `Invalid server environment variables`. Unblock by appending `INNGEST_ENCRYPTION_KEY=<32+ char string>` to the worktree `.env.local` and `docker restart <app-container>` (wait ~10s for Next dev to recompile). The other Inngest keys (EVENT_KEY, SIGNING_KEY) are `.optional()` and not blockers. Note for the agenda-session-events-lifecycle change: Inngest emission failing locally is EXPECTED (fire-and-forget) and logs `inngest_send_failed` server-side without affecting the user op.
