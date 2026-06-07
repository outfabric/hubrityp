---
name: tour-overlay-blocks-shared-seed-specs
description: a default-ON dashboard overlay (driver.js tour) gated by a NULL profile column auto-runs for the shared e2e seed user and intercepts pointer events across every spec that lands on /dashboard
metadata:
  type: feedback
---

A new dashboard surface that auto-opens an overlay intercepting pointer events
(e.g. the driver.js guided tour, gated by `profiles.tour_completed_at IS NULL`)
will block clicks for EVERY seeded e2e spec that lands on `/dashboard` as the
GLOBAL seed user (`STORAGE_STATE_PATH`), not just the spec that exercises it.

**Why:** the shared seed user's profile UPDATE in
`src/__tests__/e2e/seeded/setup/global-setup.ts` did not stamp the new gating
column, so the overlay auto-ran on the seed user's dashboard. Six unrelated
specs (logout, AI upload/discard, prontuario tab switch, whatsapp "Reconectar")
timed out with the overlay swallowing their clicks. The dedicated tour spec
(test 4) ALSO timed out — but as a load-induced cascade, not its own bug: the
6 blocked specs retrying clicks indefinitely starved the `next start` server so
the tour spec's fire-and-forget `completeTour` action POST missed its 15s
`waitForResponse`. The action mechanism itself is sound (verified: two
`next-action` POSTs to `/dashboard` return 200 reliably in isolation).

**How to apply:** when adding a default-ON dashboard overlay gated by a profile
column, stamp that column "done" for the GLOBAL seed user AND every other
dedicated user that lands on `/dashboard` without exercising the overlay
(empty-dashboard user, etc.) in `global-setup.ts`, e.g.
`tour_completed_at = COALESCE(tour_completed_at, now())` (idempotent on the
`.withReuse()` container). Keep ONLY the dedicated overlay-spec user with the
column NULL so the auto-run is still tested. Same trap class as
[[default-off-flag-breaks-full-view-ui-suites]] but inverted (default-ON here).
Related: [[e2e-action-binding-race-ssr-false]].
