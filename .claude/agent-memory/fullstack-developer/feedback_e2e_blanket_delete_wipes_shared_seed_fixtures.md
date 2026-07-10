---
name: e2e-blanket-delete-wipes-shared-seed-fixtures
description: an e2e spec doing DELETE ... WHERE user_id=seedUser (or all consent_terms for a shared seed patient) wipes sibling specs' fixtures under fullyParallel — looks like a mock-GoTrue auth flake, is a seed-data collision
metadata:
  type: feedback
---

A seeded e2e spec that blanket-deletes rows scoped only to the GLOBAL seed user
(or a shared seed patient) — e.g. `DELETE FROM ai_transcriptions WHERE user_id =
seed.userId` or `DELETE FROM consent_terms WHERE patient_id = activeMinimal` —
races sibling specs that own their own fixtures on that same user/patient under
`fullyParallel`. The victim sees its row vanish mid-test: the page renders a
not-found state ("Transcrição não encontrada", "Termo nao encontrado") or a
Server Action returns NOT_FOUND and the redirect never fires.

**Why:** This was misdiagnosed for 2 sweep iterations as a "mock GoTrue transient
auth flake" (getUser no-op under load). The real cause was that
`ai-transcription/settings-stats.spec.ts` blank-deleted ALL the seed user's
`ai_transcriptions` (to control acceptance-rate counts), wiping the `readyForSave`/
`readyForDiscard` review fixtures while those specs ran; and
`prontuario/attachments-and-notes.spec.ts` deleted all `consent_terms` for shared
patient `activeMinimal`, wiping `SEED_AI_CONSENT_TERMS.alreadySigned` that
`termo-ai-flow.spec.ts` reads. The page-snapshot in the Playwright error-context
(`test-results/.../error-context.md`, `# Page snapshot` block) was the tell — it
showed the not-found UI, not a stalled spinner.

**How to apply:** When a seeded e2e spec needs to wipe/blank-slate aggregate data
or consent state, do NOT scope the delete only to the shared seed user/patient.
Give it a DEDICATED user OR a dedicated patient (owned by the seed user) touched
by nothing else — the codebase's established pattern (`SEED_*_USER` entries in
`seed-state.ts`, seeded in `global-setup.ts`, signed in via
`signInAsDedicatedUser`; or just a dedicated patient added to `seededPatientIds`
so global-setup's NOT-IN cleanup keeps it). A new dedicated patient must be added
to `seededPatientIds` in global-setup or its DELETE-not-in step removes it. When a
diagnosis blames "load/auth flake", first check whether any sibling spec deletes
rows scoped to the shared fixture — read the failing page snapshot before
widening timeouts or adding retries (those mask a real collision). See
[[feedback_e2e_workaround_masks_bugs]] and [[feedback_e2e_dedicated_action_getuser_load_flake]].
