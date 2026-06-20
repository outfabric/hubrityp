## Context

The three large prontuário editors — Evoluções (`evolution-editor.tsx`), Plano (`treatment-plan/treatment-plan-tab.tsx`), and Notas (`personal-notes-tab.tsx`) — all consume the shared `useAutoSave` hook (`src/modules/patients/lib/use-auto-save.ts`) with a 10-second debounce. Today the hook returns only `{ status, lastSavedAt }`, and none of the three render a manual save control. The same hook is also consumed by `patient-anamnesis` (`anamnesis-tab.tsx`), which additionally maintains its own dirty tracking and `beforeunload`/unmount-flush guards.

The user goal for this change is **reassurance/control**: psychologists want a visible "Salvar" affordance that confirms their clinical record is persisted now, while the automatic 10s save keeps running as a safety net. The button must be **disabled when there are no unsaved changes**, which requires the hook to expose a dirty signal it currently computes internally but does not return.

Current `useAutoSave` internals relevant here:
- `lastSavedContentRef` holds the `JSON.stringify` snapshot of the last successfully saved content.
- `executeSave(content)` performs the no-op check, status transitions, and ref update.
- A `useEffect` debounce schedules `executeSave` and clears the timer on each change / unmount.
- `isSavingRef` guards against concurrent saves.

## Goals / Non-Goals

**Goals:**
- Add a manual **Salvar** button to all three editors that coexists with the 10s auto-save.
- Button is disabled when content is clean (equals last saved snapshot) and enabled when dirty.
- Clicking flushes the pending content immediately and resets the debounce timer (no duplicate save).
- Extend `useAutoSave` with `isDirty` and `saveNow()` in a backward-compatible, additive way — Anamnese must keep working untouched.
- On manual save, Plano's existing validation (empty goal description / empty phase title) surfaces as a user-facing toast.
- Author unit, integration, and E2E tests immediately alongside each code change.

**Non-Goals:**
- Removing or changing the auto-save behavior, interval, indicator, or server actions.
- Adding `beforeunload` / save-on-unmount data-loss guards to these three sections (logged as a separate follow-up; this change is about control/reassurance, not the silent-navigation-loss gap).
- Refactoring Anamnese to use the new `saveNow()`/`isDirty` (it has its own dirty/guard logic; out of scope).
- Any database, RLS, or server-action change.

## Decisions

### Decision 1: Extend `useAutoSave` with `isDirty` + `saveNow()` rather than tracking dirty state in each component

`isDirty` is already derivable inside the hook (`JSON.stringify(content) !== lastSavedContentRef.current`); exposing it avoids each of the three components re-implementing snapshot comparison and drifting from the hook's own no-op logic. `saveNow()` wraps the existing `executeSave(content)` plus clearing the active debounce timer so a click does not leave a stale timer that double-fires.

To make `isDirty` reactive (refs do not trigger re-render), the hook will mirror the dirty state into React state updated in the same effect that schedules the debounce and inside `executeSave` on success. `saveNow` is exposed as a stable `useCallback` that reads the latest content via a ref, mirroring the existing `saveFnRef` pattern.

**Alternatives considered:**
- *Track dirty + manual save entirely in each component.* Rejected: three-way duplication of the snapshot-compare logic the hook already owns; high risk of the button's notion of "dirty" disagreeing with the hook's no-op guard.
- *New separate `useManualSave` hook.* Rejected: would need its own snapshot/timer coordination with `useAutoSave`, creating two sources of truth for "saved content".

### Decision 2: Additive, backward-compatible hook return shape

`AutoSaveResult` gains `isDirty: boolean` and `saveNow: () => Promise<void>`. Existing consumers (Anamnese) destructure only `{ status, lastSavedAt }` and are unaffected. No signature change to `useAutoSave(content, saveFn, options)`.

### Decision 3: `saveNow()` reuses the in-flight guard and no-op check

`saveNow()` calls the same internal `executeSave`, so: (a) if a debounced save is already in flight, the `isSavingRef` guard prevents a concurrent duplicate; (b) if content is unchanged it no-ops; (c) on success it updates `lastSavedContentRef`, `lastSavedAt`, status, and clears `isDirty`. Clicking also clears the pending `setTimeout` so the 10s timer is reset, not left to fire redundantly.

### Decision 4: Button placement and disabled affordance reuse existing UI primitives

Each editor renders a shadcn `Button` next to the existing `AutoSaveIndicator`. `disabled={!isDirty || status === 'saving'}` ties the control to the hook's truth. Label "Salvar". The indicator continues to render status and timestamp; the button does not replace it.

### Decision 5: Plano manual-save validation surfaces as a toast

`treatment-plan-tab.tsx`'s `handleSave` already throws on empty goal description / empty phase title (auto-save swallows this into `status='error'`). For the manual path, the click handler awaits `saveNow()` and, on the validation rejection, shows a `sonner` toast (e.g. "Preencha a descrição de todas as metas antes de salvar.") so the user gets actionable feedback rather than a silent error indicator. Evoluções and Notas have no such field-level validation and simply flush.

### Decision 6: Personal Notes respects the locked state

The Salvar button in `personal-notes-tab.tsx` is only present/enabled when the notes are unlocked (password state already gates the editor). When locked, no editor and therefore no button is shown — consistent with current behavior.

## Risks / Trade-offs

- **[Double-save race: click during an in-flight debounced save]** → Mitigated by reusing `isSavingRef` inside `executeSave`; `saveNow()` is a no-op while a save is in flight, and the button is disabled when `status === 'saving'`.
- **[`isDirty` reactivity: refs do not re-render, button could stay stale]** → Mitigated by mirroring dirty into React state set in the debounce effect and on save success; covered by a unit test asserting enable-on-edit / disable-after-save.
- **[Hook change leaks into Anamnese behavior]** → Mitigated by additive return fields only; Anamnese destructures the original two fields. An integration/unit check confirms Anamnese auto-save still behaves identically.
- **[User assumes the button is the only thing saving and disables trust in auto-save]** → Indicator text is unchanged and still shows automatic "Salvo às HH:MM"; the button is supplementary. Documented in the spec scenarios.
- **[Out-of-scope guards create false sense of safety]** → Explicitly logged: the button does NOT prevent silent loss on navigation within the debounce window; the follow-up for `beforeunload`/unmount-flush is recorded in tasks as a non-implemented note.

## Migration Plan

No data migration. Pure client-side additive change. Rollback is reverting the component + hook edits; no persisted state or schema is touched. The hook change is backward compatible, so partial rollback (e.g. reverting one component) is safe.

## Open Questions

- Exact Portuguese copy for the Plano validation toast(s) — proposed defaults above; confirm during implementation against `ptbr-localization-quality` conventions.
- Whether the button should show a transient "Salvando…" label itself or rely solely on the existing indicator — leaning on the indicator (Decision 4) to avoid duplicate affordances.
