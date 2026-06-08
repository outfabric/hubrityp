---
name: feedback-tests-interleaved-with-code
description: In OpenSpec tasks.md, interleave each test task immediately after the code task that motivates it — never batch all tests at the end
metadata:
  type: feedback
---

When structuring an OpenSpec change's `tasks.md` (and when implementing), place each automated test task (unit / integration / e2e) **immediately after** the code change that motivates it — do NOT collect all tests into a separate phase at the end of the change.

**Why:** the user wants the implementing code agent to still hold the context of the change it just made when it writes the corresponding test, so it doesn't have to re-read/re-derive the change before testing. Batching tests at the end forces a costly context re-acquisition and risks tests that miss the original intent.

**How to apply:** in `tasks.md`, structure sections as `code subtask → its test subtask(s) → next code subtask → its test subtask(s)`. Specify unit, integration, and e2e tests only where relevant and recommended for the surface being changed (pure logic → unit; Server Action / RLS / query / integration → integration; critical UI flow → e2e). See [[feedback-fullstack-developer-security]] for the parallel rule that gated surfaces also need a negative-auth test.
