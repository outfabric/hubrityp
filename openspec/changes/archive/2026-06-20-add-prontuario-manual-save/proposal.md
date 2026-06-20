## Why

The "Evoluções", "Plano", and "Notas" sections of the prontuário auto-save every 10 seconds but expose no manual save control. Psychologists working on legally-mandated clinical records (Lei 13.787/2018) have no explicit "it is saved now" affordance and must trust a silent background timer. Adding a manual **Salvar** button that coexists with auto-save gives users direct control and reassurance over when their clinical notes are persisted, without removing the safety of automatic saving.

## What Changes

- Add a manual **Salvar** button to the three large prontuário editors: Evoluções (`evolution-editor.tsx`), Plano (`treatment-plan-tab.tsx`), and Notas (`personal-notes-tab.tsx`).
- The button **coexists** with the existing 10-second auto-save — it does not replace it. Clicking it flushes the pending content immediately and resets the debounce timer.
- The button is **disabled when there are no unsaved changes** (clean state) and enabled only when the current content differs from the last saved snapshot.
- Extend the shared `useAutoSave` hook (`src/modules/patients/lib/use-auto-save.ts`) with two backward-compatible additive return fields: `isDirty` (boolean) and `saveNow()` (manual flush + timer reset). The existing Anamnese consumer is unaffected.
- On manual save, validation errors already enforced by Plano (empty goal description / empty phase title) surface as a user-facing toast instead of only a silent `error` status.
- The existing `AutoSaveIndicator` ("Salvo às HH:MM" / "Salvando…" / "Erro ao salvar") remains and continues to reflect status after both automatic and manual saves.

This change does **not** add the `beforeunload` / save-on-unmount data-loss guards (present in Anamnese but missing here); that gap is logged as out-of-scope follow-up work, because the stated goal of this change is user reassurance/control, not closing the silent-navigation-loss gap.

## Capabilities

### New Capabilities
<!-- None — this modifies existing prontuário capabilities. -->

### Modified Capabilities
- `evolutions`: the evolution editor gains a manual Salvar control coexisting with auto-save (disabled when clean, flush + timer reset on click).
- `treatment-plan`: the treatment plan editor gains a manual Salvar control coexisting with auto-save, with validation errors surfaced as a toast on explicit save.
- `personal-notes`: the personal notes editor gains a manual Salvar control coexisting with auto-save (respecting the locked/unlocked password state).

## Impact

- **Shared hook**: `src/modules/patients/lib/use-auto-save.ts` — additive `isDirty` + `saveNow()` return fields (also used by `patient-anamnesis`; must remain backward compatible).
- **Components**: `evolution-editor.tsx`, `treatment-plan/treatment-plan-tab.tsx`, `personal-notes-tab.tsx` in `src/modules/medical-records/components/`.
- **Server actions**: unchanged — manual save reuses the existing `create/update-evolution`, `upsertTreatmentPlan`, and `upsertPersonalNotes` actions.
- **Tests**: unit (hook `isDirty`/`saveNow`, per-component button enable/disable + flush), integration (manual save persists via the real server action + RLS), and E2E (button disabled→enabled on edit, click saves before the 10s window) — authored immediately alongside each code change.
- **Out of scope (logged follow-up)**: porting Anamnese's `beforeunload` + save-on-unmount guards to these three sections.
