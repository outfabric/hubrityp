---
name: patient-detail-mobile-overflow
description: /pacientes/[id] route overflows horizontally at 375px (main is ~729px wide) — pre-existing route-level layout bug, NOT caused by tab content; sidebar is correctly off-canvas
metadata:
  type: project
---

The patient detail route `/pacientes/[id]` has a horizontal-overflow bug at 375px: `document.documentElement.scrollWidth ≈ 729` vs `clientWidth 375`.

**Root cause (verified 2026-06-09):** the fixed sidebar IS correctly off-canvas at 375px (`nav[aria-label="Menu principal"]` → `position:fixed; left:-240px`), so it is NOT the cause. `<main>` itself is laid out ~729px wide and is not clamped to the viewport on this route. By contrast `/dashboard` and `/agenda` render at `scrollWidth=375` with the *same* off-canvas sidebar — so this overflow is specific to the patient-detail route's content shell, not the global app shell.

**How to apply:** This is a HOST-PAGE bug, present on the "Visão geral" tab (which predates any individual tab feature). When QA'ing any new tab on `/pacientes/[id]` (session history, financeiro, etc.), do NOT attribute the 375px overflow to the new tab — the tab's own components (cards/strip/chips) wrap fine and merely inherit the over-wide `<main>`. Report it as LOW/INFO against the host page, classify the tab feature on its own merits. This refines the older [[app-mobile-sidebar-overflow]] note (which said the global shell collapses fine — true for dashboard/agenda/pacientes-list, but the patient *detail* route still overflows for a different reason).

To detect: at 375px, `playwright-cli --raw eval "JSON.stringify({sw:document.documentElement.scrollWidth, cw:document.documentElement.clientWidth})"` and compare against the overview tab to confirm it is route-level, not feature-level.
