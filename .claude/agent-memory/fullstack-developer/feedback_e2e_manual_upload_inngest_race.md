---
name: e2e-manual-upload-inngest-race
description: ai-transcription manual-upload-flow.spec is flaky — DB row sometimes 0 after upload; fire-and-forget Inngest event from confirmAudioUpload races the assertion; passes on retry
metadata:
  type: feedback
---

`src/__tests__/e2e/seeded/ai-transcription/manual-upload-flow.spec.ts:27` ("creates DB row") intermittently asserts `rows.toHaveLength(1)` and gets `0`. Confirmed flaky, NOT a regression: under `CI=true` (2 retries) it fails attempt 1 then passes on retry in the same run.

**Why:** `confirmAudioUpload` fire-and-forgets an Inngest event. The seeded suite deliberately points `INNGEST_EVENT_API_BASE_URL` at a non-routable address (`http://127.0.0.1:1`) so the send fails fast; the Server Action's DB insert and the click→assertion timing race (see [[e2e-action-binding-race-ssr-false]] for the sibling pattern). When the spec reads the row before the action's insert commits, it sees `[]`.

**How to apply:** If a regression sweep flags this spec as failing, do NOT treat it as a regression unless the branch touches `src/modules/ai-transcription/**` or the upload Server Action. Re-run the FULL e2e:seeded with `CI=true` (so retries are enabled); a flake recovers on retry → it's pre-existing. Local `retries:0` will make it look like a hard failure when it isn't. A real fix would settle the action (waitForResponse / poll the row) rather than asserting immediately. `src/__tests__/e2e/seeded/ai-transcription/review-discard.spec.ts:47` ("discard confirms and redirects") belongs to the same flake family — both fail under full-suite parallelism (`fullyParallel`, 2 workers) and both pass deterministically when re-run in isolation / reduced parallelism. Confirmed 2026-06-18: full run failed both, isolated re-run passed both 3/3.
