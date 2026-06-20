---
name: e2e-patient-phone-unique-collision
description: seeded specs creating a patients row must use a phone unused by every other spec + the CSV import fixture; patients.phone is UNIQUE and the suite is fullyParallel, so a shared number races the constraint → "Já existe um paciente com este telefone" + no redirect
metadata:
  type: feedback
---

A seeded e2e spec that creates a real `patients` row through the UI must pick a phone number that NO other seeded spec uses — including the CSV import fixture `src/__tests__/e2e/seeded/patients/fixtures/import-patients.csv` (e.g. "Ana Costa" = `11987654321` → canonical `+55 11 98765-4321`).

**Why:** `patients.phone` has a UNIQUE constraint, and `playwright.seeded.config.ts` runs `fullyParallel` against a reused (`.withReuse()`, never-cleaned) Testcontainers Postgres. When two specs submit the same canonical phone concurrently, the second submit is rejected with the alert "Já existe um paciente com este telefone." and the create Server Action never redirects — surfacing as a deterministic-looking `page.waitForURL` timeout that survives all CI retries (looks like a real bug, is a number collision). Hit in PR patient-form-and-lifecycle-fixes: `patient-phone-multi-field.spec.ts` reused `11987654321`, colliding with the import fixture's Ana Costa.

**How to apply:** When adding/reviewing a seeded spec that registers a patient, grep `src/__tests__/e2e/seeded/` AND the import CSV for the chosen digits and canonical form before trusting it; choose DDDs/numbers proven unused. A `page.waitForURL` timeout right after a patient-create submit in CI is almost always this collision, not an app bug — verify the duplicate-phone alert in the error-context page snapshot. Related: [[e2e-shared-seed-session-slot-collision]], [[e2e-action-binding-race-ssr-false]] (the sibling `manual-upload-flow` ai-transcription flake is the action-binding race, not this).
