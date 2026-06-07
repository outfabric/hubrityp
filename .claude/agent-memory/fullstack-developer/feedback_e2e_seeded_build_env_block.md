---
name: e2e-seeded-build-env-block
description: e2e:seeded needs a fresh `next build` made with the FULL CI env block; missing any server/public var aborts page-data collection
metadata:
  type: feedback
---

To run `test:e2e:seeded` locally you must first `next build` (the webServer wrapper `src/__tests__/e2e/seeded/setup/start-server.ts` runs `next start` on a prebuilt `.next`, it does NOT build). The build's page-data-collection phase imports `src/shared/env` and `src/shared/db/client.ts`, which Zod-validate ALL required env vars at module-eval time — so the build aborts ("Failed to collect page data for /api/health") unless you pass the complete CI placeholder block.

**Why:** "Compiled successfully" is NOT enough — compilation passes with no env, but page-data collection (`/api/health` etc.) evaluates the env modules and fails on the first missing var. A partial env set fails incrementally (first NEXT_PUBLIC_*, then STREAM_WEBHOOK_SECRET, INNGEST_ENCRYPTION_KEY, SIGNATURE_HASH_SALT...).

**How to apply:** Copy the exact env block from `.github/workflows/ci.yml` job `e2e` → step "Build the app" (DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_STREAM_API_KEY, STREAM_API_KEY, STREAM_API_SECRET, STREAM_WEBHOOK_SECRET, GEMINI_API_KEY, INNGEST_ENCRYPTION_KEY [min 32 chars], INNGEST_SIGNING_KEY, SIGNATURE_HASH_SALT [min 32 chars], LOG_LEVEL=silent). Then verify `.next/BUILD_ID` exists before running Playwright. See also [[e2e_seeded_needs_fresh_build]] and [[e2e_seeded_ports_conflict]].
