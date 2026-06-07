---
name: e2e-seeded-needs-fresh-build
description: e2e:seeded runs `next start` against a prebuilt .next; stale build silently tests OLD code — rebuild after any app/ or component change before e2e
metadata:
  type: feedback
---

`npm run test:e2e:seeded` boots the server via `next start` against the existing `.next` production build (see `src/__tests__/e2e/seeded/setup/start-server.ts`); it does NOT rebuild. If `.next` is stale, the e2e suite silently exercises the OLD code — UI/Server-Action fixes appear to "fail" e2e even though the source is correct.

**Why:** burned a full fix cycle chasing a phantom RHF/`useWatch` form bug: the committed evolution kept the original AI text in e2e while the unit tests passed. Root cause was a `.next` build from hours earlier (before the fix), not a code defect. After `npm run build`, the same spec passed immediately.

**How to apply:** after editing anything under `src/app/**`, `src/modules/**/components/**`, `src/middleware.ts`, or anything compiled into the server/client bundle, run `next build` BEFORE `npm run test:e2e:seeded`. CI does this (`.github/workflows/ci.yml` "Build the app" step runs before `test:e2e:seeded`); locally it is manual. The build needs the full placeholder env block CI uses — DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL/ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_STREAM_API_KEY, STREAM_API_KEY/SECRET, STREAM_WEBHOOK_SECRET, GEMINI_API_KEY, INNGEST_ENCRYPTION_KEY (32ch), INNGEST_SIGNING_KEY, SIGNATURE_HASH_SALT (≥32ch), LOG_LEVEL — copy from the workflow's "Build the app" env. Related: [[required-env-var-propagation]] style env blocks.
