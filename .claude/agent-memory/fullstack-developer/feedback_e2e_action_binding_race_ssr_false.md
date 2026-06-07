---
name: e2e-action-binding-race-ssr-false
description: e2e clicking a control in a dynamic(ssr:false) leaf that fires a fire-and-forget Server Action stamps nothing if clicked before hydration; settle ~1.5s first
metadata:
  type: feedback
---

In a seeded e2e test, ending a flow whose completion calls a Server Action from a
`dynamic(ssr:false)` client leaf (e.g. the Driver.js dashboard tour's
`onDestroyed: () => void completeTour().catch()`) can fire a `next-action` POST
that the server receives and 200s, but that NEVER reaches the action impl — so
the DB write (e.g. `tour_completed_at`) silently does not happen.

**Why:** the `ssr:false` leaf binds the Server Action reference only after it
hydrates. Triggering completion in the first ~1s posts a stale/empty action that
resolves to a no-op (no impl invocation, no error). The same click works once the
leaf has hydrated. The done-button path "worked" only because walking N steps
gave incidental settle time; an immediate close/skip did not.

**How to apply:** before ending such a flow in a test, add a short fixed settle
(`await page.waitForTimeout(1_500)` — NOT `networkidle`, which never fires when the
app keeps a realtime WebSocket reconnecting). Then arm `page.waitForResponse` for
the action POST (`method POST` + `next-action` header present + correct pathname +
200) BEFORE the trigger, and await it — the stamp is fire-and-forget so polling the
DB immediately also races it. A real user reads the tooltip far longer than 1.5s,
so this does not weaken the assertion. See
src/__tests__/e2e/seeded/onboarding/tour.spec.ts `endTourAndAwaitStamp`.

Related: [[e2e-dedicated-user-refresh-token]].
