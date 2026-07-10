---
name: e2e-dedicated-action-getuser-load-flake
description: Dedicated-user Server Action that authenticates via getUser() flakes under full e2e:seeded parallel load (mock-gotrue saturates) — no-ops + skips client redirect; assert the deterministic DB effect with an idempotent retry, not a single click→waitForURL
metadata:
  type: feedback
---

A seeded e2e test that clicks a control firing a Server Action which authenticates via server-side `supabase.auth.getUser()` (e.g. the onboarding "Pular e explorar" / `skipOnboarding`, or the ai-transcription discard) flakes ONLY under the full `test:e2e:seeded` suite at high parallelism — green in isolation and in any targeted subset.

**Why:** the harness has ONE in-process mock GoTrue HTTP server fielding every worker's `/auth/v1/user` round-trips at once. Under full-suite load that round-trip can transiently resolve `unauthenticated`, so the action no-ops, returns `{ok:false}`, fires the error toast, and `router.push(...)` never runs — the page stays put and `waitForURL('**/dashboard')` times out. It is a harness artifact, NOT a product bug (prod uses real Supabase sessions). Bit the dev-cycle regression sweep TWICE (`first-run-gating.spec.ts:109`, `review-discard.spec.ts:47`); a previous "goto + waitForResponse on the next-action POST" fix did NOT help because waiting for the POST response doesn't guarantee the POST authenticated.

**How to apply:** don't assert on a single `click → waitForURL`/toast. Assert the deterministic SERVER effect (the DB row transition) with an idempotent retry, then navigate explicitly:
- Wrap the click in `await expect(async () => { ... }).toPass({ timeout: 40_000, intervals: [...] })`.
- INSIDE: probe the DB FIRST and `return` once the effect landed — re-navigating to a now-gated page (e.g. `/onboarding/welcome` after `onboarding_step='done'`) bounces via middleware and the heading never renders (this caused a self-inflicted failure on the first attempt).
- Only then re-goto the page, click, and re-read the DB to let the retry observe a same-iteration write.
- After `toPass`, `goto('/dashboard')` explicitly so downstream assertions hold even when the load-sensitive client push was the part swallowed.
- The action must be idempotent for re-clicks to be safe (`skipOnboarding` sets the cursor unconditionally; discard's 2nd call is `ALREADY_REVIEWED`, so only retry while status is still discardable).
- Apply the SAME hardening to EVERY sibling spec exercising the same control (e.g. `welcome.spec.ts`'s skip test), or the next sweep surfaces the sibling as the new flaky.

Related: [[e2e-dedicated-user-refresh-token]], [[e2e-action-binding-race-ssr-false]], [[onboarding-gating-edge-shim]].
