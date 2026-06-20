---
name: integration-before-e2e-wipes-seed
description: Running test:integration full immediately before test:e2e:seeded reuses the SAME Testcontainer; integration cleanup empties the patients table and e2e seed never re-applies → 40+ false e2e failures
metadata:
  type: feedback
---

Do NOT run `npm run test:integration` (full) immediately before `npm run test:e2e:seeded` on the same machine without first force-removing the shared Postgres Testcontainer.

**Why:** `src/__tests__/e2e/_shared/postgres-container.ts::bootPostgres()` uses `.withReuse()` and is shared by BOTH the integration runner (vitest.integration globalSetup) and the seeded Playwright suite (e2e/seeded/setup/global-setup.ts). When integration runs first, its `cleanTestData()` TRUNCATEs the public tables. e2e then reconnects to the SAME warm container; with reuse the boot is a no-op and the seed does not re-populate, so `public.patients` is left at 0 rows. The whole e2e suite then collapses with `patient-option-...` not-visible failures and `ai_transcriptions_patient_id_fk` FK violations — looks like a massive regression (40+ fails) but is pure harness pollution. Symptom signature: many FIRST-in-file tests fail with tiny durations (0ms/289ms) clustered at run start.

**How to apply:** In fix-mode full re-validation, after `test:integration` and before `test:e2e:seeded`, force a clean DB container: `docker rm -f <postgres:16-alpine container>` (see [[feedback_testcontainers_reuse_dirty_state]]). Verify the fresh container seeds correctly by querying `SELECT count(*) FROM public.patients` against the new `databaseUrl` in `e2e/seeded/setup/.auth/seed-state.json` (expect 15, seed patient `...010` = "Maria Silva" active) before trusting any e2e failure. NOTE: deleting the container mid-flight can leave seed-state.json pointing at the dead port → globalSetup ECONNREFUSED; kill any orphan `next start` on :3000 and the stale container, then re-run from cold so the webServer boots a brand-new container and rewrites seed-state.json.
