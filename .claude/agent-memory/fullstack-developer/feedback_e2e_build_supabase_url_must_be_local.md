---
name: e2e-build-supabase-url-must-be-local
description: e2e:seeded build MUST set NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321; any other value bakes the wrong URL into the edge middleware and EVERY authenticated spec redirects to /login
metadata:
  type: feedback
---

When building the app for `test:e2e:seeded` (or `:real`), `NEXT_PUBLIC_SUPABASE_URL` MUST be exactly `http://127.0.0.1:54321`.

**Why:** Next.js inlines `NEXT_PUBLIC_*` into the edge bundle at BUILD time, so `src/middleware.ts` (edge runtime) talks to whatever Supabase URL the build saw — it is NOT overridable at runtime via start-server's `env`. The seeded suite's mock GoTrue binds to the stable port `54321` (see `start-server.ts` MOCK_GOTRUE_PORT). If the build used any other URL (e.g. a `https://placeholder.supabase.co` or a real project URL), the middleware's `getUser()` validates the seeded JWT against the WRONG origin, every authenticated request fails, and the whole authenticated app redirects to `/login`. Symptom: nearly every authenticated seeded spec fails with the page snapshot showing the "Entrar / Acesse sua conta" login form instead of the expected page — while anonymous/public specs (~51) still pass. This looks like a catastrophic auth regression but is purely a build-env mistake.

**How to apply:** Copy the e2e build env block verbatim from `.github/workflows/ci.yml` (the "Build the app" step before `npm run test:e2e:seeded`). The critical line is `NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:54321`. The other placeholder vars only satisfy the Zod env validator at module-load; the URL is the load-bearing one. Related: [[e2e-seeded-build-env-block]] (the full env block must be present), [[e2e-seeded-needs-fresh-build]] (rebuild after app/component changes).
