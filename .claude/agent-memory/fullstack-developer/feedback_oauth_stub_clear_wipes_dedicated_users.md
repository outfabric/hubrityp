---
name: oauth-stub-clear-wipes-dedicated-users
description: google-oauth-stub teardown's unscoped clear-oauth-users wiped the parallel dedicated checklist/tour/empty users' mock-GoTrue registry mid-test, bouncing them to /login
metadata:
  type: feedback
---

In the seeded e2e suite, `POST /_test/register-oauth-user` (mock GoTrue) is what makes a dedicated user resolvable: the Edge middleware's PostgREST profile shim reads the registry to resolve the user as `active`. `signInAsDedicatedUser` (used by `onboarding/checklist.spec.ts`, `onboarding/tour.spec.ts`, and the dashboard zero-data user) registers there in `beforeEach`.

Rule: a spec must NEVER call `POST /_test/clear-oauth-users` UNSCOPED (no body). It clears the WHOLE module-scoped `oauthUserRegistry`, which is shared across the process. Under `fullyParallel` (2 workers) that wipes OTHER specs' dedicated users mid-test → the Edge profile shim resolves "no profile" → middleware redirects them to `/login`. The page snapshot in the error-context shows the login page ("Entrar / Acesse sua conta HubrityP"), not a missing component.

**Why:** `google-oauth-stub.ts` teardown did a blanket `clear-oauth-users`, intermittently nuking the checklist/tour users (regression sweep iteration 2). It only surfaces under parallel scheduling, so running the specs in isolation passes — a real cross-spec regression, not a flake.

**How to apply:** the clear endpoint now accepts an optional `{ code }` body and deletes only that entry; any caller owning a single registration must pass its own `code`. When adding a new e2e helper that registers an OAuth user, scope its teardown clear by `code`. If you see a dedicated-user spec landing on `/login` only under the full suite (passing solo), suspect a sibling's unscoped registry clear, not the seed/middleware. Related: [[feedback_e2e_dedicated_user_refresh_token]], [[feedback_e2e_seeded_needs_fresh_build]].
