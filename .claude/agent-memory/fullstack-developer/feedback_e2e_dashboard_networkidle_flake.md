---
name: e2e-dashboard-networkidle-flake
description: whatsapp-health-banner.spec "navigates to reconnect" test times out on page.goto('/dashboard',{waitUntil:'networkidle'}); pre-existing flake, page renders fine
metadata:
  type: feedback
---

The seeded e2e test `whatsapp-health-banner.spec.ts:32:3` ("shows danger banner ... navigates to reconnect") reliably times out at `page.goto('/dashboard', { waitUntil: 'networkidle' })` — the 30s timeout fires at the `goto` line, BEFORE any in-page assertion runs.

**Why:** `/dashboard` keeps a long-lived connection open (Supabase Realtime / background polling), so the network never reaches `networkidle` and the wait strategy hangs. The Playwright page-snapshot in the error-context shows the DOM (header, banner, onboarding alert) rendered fully — the page loads; only the wait condition never settles. The sibling test in the same file (the copy-assertion one, line ~99-103) passes because it does not use `networkidle`.

**How to apply:** When this test fails during a section/sweep that only touched display copy or other unrelated areas, do NOT treat it as a regression caused by your change — confirm via `git diff HEAD` that you did not touch `/dashboard`, the `(app)` layout, the banner's data fetch, or the wait strategy, then classify it as a pre-existing `networkidle` flake. Do not add a DOM workaround (masks bugs — see [[feedback_e2e_workaround_masks_bugs]]). The real fix (out of copy-change scope) is to change the spec's wait strategy from `networkidle` to `domcontentloaded` + an explicit `expect(banner).toBeVisible()`. Related build prerequisite: [[feedback_e2e_seeded_needs_fresh_build]], [[feedback_e2e_build_supabase_url_must_be_local]].
