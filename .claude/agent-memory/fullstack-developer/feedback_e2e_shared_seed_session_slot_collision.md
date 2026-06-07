---
name: e2e-shared-seed-session-slot-collision
description: two seeded e2e specs scheduling the SAME seed patient at the SAME tomorrow time slot race on detectConflicts under fullyParallel; loser gets conflict_warning, modal stays open, save assertion fails
metadata:
  type: feedback
---

When adding a seeded e2e spec that schedules a session via the agenda modal, pick a tomorrow time slot for the shared seed patient (`SEED_PATIENTS.activeWithPhone`) that NO other parallel spec already uses.

**Why:** The whole `e2e/seeded` suite runs `fullyParallel` against ONE shared seed user. `detectConflicts` (in create-session / create-recurring-session) blocks overlapping sessions for that user. If two specs schedule the same patient at the same tomorrow slot, they race: whichever inserts first wins, the other gets `result.ok === false` with `error: 'conflict_warning'`, so its session-form modal renders the "Agendar mesmo assim" alert and STAYS OPEN — its `expect(session-form-modal).toBeHidden()` then times out. This is nondeterministic (depends on worker scheduling), so it surfaces as a flaky failure on whichever spec lost the race that run. Concretely: the copy-patient-video-link change added a new spec scheduling `activeWithPhone` at tomorrow@15:00, the exact slot `recurring-session-create.spec.ts` already owned — the recurring spec flaked in the regression sweep. Fix was to move the new spec to a free slot (13:00) and update the chip-time filter to match.

**How to apply:** Before merging a new session-scheduling seeded spec, grep the seeded specs for the time options they click (`getByRole('option', { name: 'HH:00' })`) and the patient they use; for `activeWithPhone` the taken tomorrow slots have included 08:00 (drag-drop), 14:00 (session-create), 15:00 (recurring-create + copy-link), 16:00 (recurring-edit-scope), 17:00 (couple), 18:00 (disable-reminders), 12:00 (block-create, no patient but still conflicts). Take a genuinely free slot (e.g. 13:00, 11:00) and keep any later "filter session chip by HH:00" assertion in the same spec in sync with the chosen time. Related: [[wizard-spec-pollutes-seed-fullname]] (another shared-seed-mutation hazard), [[tour-overlay-blocks-shared-seed-specs]].
