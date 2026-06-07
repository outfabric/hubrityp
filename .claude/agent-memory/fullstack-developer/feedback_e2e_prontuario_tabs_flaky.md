---
name: e2e-prontuario-tabs-flaky
description: prontuario tab-content e2e specs flake on toBeVisible under parallel load with 0 retries; run e2e:seeded under CI config to validate
metadata:
  type: feedback
---

The seeded e2e specs under `src/__tests__/e2e/seeded/prontuario/` (e.g. `hypotheses.spec.ts`, `scales.spec.ts`) assert `expect(page.getByTestId('prontuario-tab-content-<x>')).toBeVisible()` immediately after clicking the tab trigger, with the default 5s timeout. Under 4-worker contention with `retries: 0` (the LOCAL Playwright config when `CI` is unset), the Radix `TabsContent` panel can stay `data-state="inactive" hidden` past 5s, producing a flaky failure. A different prontuario spec fails on each full local run; each one passes in isolation.

**Why:** local `playwright.seeded.config.ts` uses `retries: process.env.CI ? 2 : 0` and `workers: process.env.CI ? 2 : 4`. CI's 2 retries absorb the race; local 0 retries exposes it. This is the same class as [[date-relative-e2e-local-vs-ci]] — local sweep green/red does not match CI for nondeterministic specs.

**How to apply:** when fix-mode/sweep requires a green full e2e:seeded and you hit a single prontuario tab-visibility failure that passes in isolation, re-run the full suite with `CI=true npm run test:e2e:seeded` to validate under the canonical merge-gate config (retries=2, workers=2) instead of treating it as a regression. Do NOT add DOM workarounds to the specs ([[e2e-workaround-masks-bugs]] equivalent). If you have spare scope, the real fix is to wait on the tab trigger reaching `data-state="active"` (or raise the panel's toBeVisible timeout) before asserting panel visibility — but that is out of scope for an unrelated fix ticket.
