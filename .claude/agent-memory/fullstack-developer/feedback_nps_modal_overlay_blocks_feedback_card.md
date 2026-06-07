---
name: nps-modal-overlay-blocks-feedback-card
description: NPS day-7 modal renders on EVERY (app) route incl. /configuracoes/feedback; its Radix overlay intercepts the feedback card's clicks + dup testids when the user is still eligible
metadata:
  type: feedback
---

The day-7 NPS modal is mounted in `(app)/layout.tsx` (`NpsModalSlot`), so it auto-opens on ANY `(app)` route — including `/configuracoes/feedback` — whenever the user is eligible (`first_access_at` ≥ 7d ago AND `nps_responded_at IS NULL`). The modal and the feedback card BOTH render the shared `NpsForm`, so an eligible user on the feedback page has TWO copies of every NPS testid (`nps-feedback`, `nps-score-N`, `nps-submit`), AND the Radix Dialog's `aria-hidden` overlay (`fixed inset-0 z-[60]`) intercepts pointer events on the underlying card — clicks on card controls time out.

**Why:** Discovered building the section-10 e2e (`nps/day7-modal.spec.ts`). A test that navigated to `/configuracoes/feedback` while the user was still modal-eligible failed two ways: strict-mode "resolved to 2 elements", then "overlay intercepts pointer events". The realistic product path is: the eligible user answers/dismisses via the MODAL (after which `nps_responded_at` is stamped → feedback page shows the thank-you state, no form). The card's writable form is only cleanly reachable when the user is NOT modal-eligible (e.g. before day 7) but hasn't responded.

**How to apply:** When e2e-testing the Configurações > Feedback card's writable form, seed the user as NOT modal-eligible (`first_access_at` < 7 days ago) + `nps_responded_at` NULL, so the modal does not render over the page. To test the "answer later after dismissal" path, dismiss via the modal first, then assert the feedback page lands on the thank-you state (not a fresh form). Also relevant if adding a Feedback nav entry: expect the modal to overlap it for eligible users.
