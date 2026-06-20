## 1. Shared hook: extend `useAutoSave` with `isDirty` + `saveNow()`

- [x] 1.1 In `src/modules/patients/lib/use-auto-save.ts`, add `isDirty: boolean` and `saveNow: () => Promise<void>` to the `AutoSaveResult` interface (additive, backward compatible — Anamnese keeps destructuring `{ status, lastSavedAt }`).
- [x] 1.2 Mirror dirty state into React state: set it from the debounce `useEffect` (content vs `lastSavedContentRef`) and clear it on successful save inside `executeSave`.
- [x] 1.3 Implement `saveNow()` as a stable `useCallback` that reads the latest content via a ref, clears the pending debounce `setTimeout`, and calls the existing `executeSave` (reusing the no-op check and `isSavingRef` in-flight guard).
- [x] 1.4 **Unit tests (immediately after 1.1–1.3)** in `src/__tests__/unit/modules/patients/lib/use-auto-save.test.ts`: `isDirty` is false initially, true after a content change, false again after save; `saveNow()` persists immediately without waiting for the 10s timer; `saveNow()` is a no-op when content is unchanged; `saveNow()` does not double-save when a debounced save is in flight; clicking resets the timer so the debounced save does not fire afterward.
- [x] 1.5 **Regression check** that existing Anamnese auto-save behavior is unchanged (existing `use-auto-save` tests still green; no signature change).

## 2. Evoluções — manual save button (`evolution-editor.tsx`)

- [ ] 2.1 Consume `isDirty` and `saveNow` from `useAutoSave`; render a shadcn `Button` labelled "Salvar" next to the `AutoSaveIndicator`.
- [ ] 2.2 Disable the button when `!isDirty || status === 'saving'`; on click call `saveNow()`.
- [ ] 2.3 **Unit tests (immediately after 2.1–2.2)** in `src/__tests__/unit/modules/medical-records/components/evolution-editor.test.tsx`: button disabled on clean mount, enabled after editing content, calls the save handler on click, disabled again after save resolves.

## 3. Plano — manual save button + validation toast (`treatment-plan/treatment-plan-tab.tsx`)

- [ ] 3.1 Consume `isDirty`/`saveNow`; render the "Salvar" `Button` next to the `AutoSaveIndicator`, disabled when `!isDirty || status === 'saving'`.
- [ ] 3.2 On click, await `saveNow()`; on the existing validation rejection (empty goal description / empty phase title), show a `sonner` toast with actionable pt-BR copy instead of relying on the silent error status.
- [ ] 3.3 **Unit tests (immediately after 3.1–3.2)** in `src/__tests__/unit/modules/medical-records/components/treatment-plan-tab.test.tsx`: button disabled when clean, enabled after editing a goal/phase/resource/criterion, click with valid content calls `upsertTreatmentPlan`, click with an empty-description goal shows a toast and does not persist.

## 4. Notas — manual save button (`personal-notes-tab.tsx`)

- [ ] 4.1 Consume `isDirty`/`saveNow`; render the "Salvar" `Button` next to the `AutoSaveIndicator` only in the unlocked editor view, disabled when `!isDirty || status === 'saving'`.
- [ ] 4.2 On click call `saveNow()`; confirm no button is rendered in the locked state.
- [ ] 4.3 **Unit tests (immediately after 4.1–4.2)** in `src/__tests__/unit/modules/medical-records/components/personal-notes-tab.test.tsx`: button disabled on clean unlocked mount, enabled after editing, calls `upsertPersonalNotes` on click, absent while locked.

## 5. Integration tests (real server actions + RLS)

- [ ] 5.1 In `src/__tests__/integration/sessions/` (or the evolutions integration folder), assert a manual save persists evolution content via the real `create/update-evolution` action under the owner's RLS context.
- [ ] 5.2 In the treatment-plan integration folder, assert a manual save persists via `upsertTreatmentPlan` and snapshots a new `treatment_plan_versions` row, and that an invalid goal is rejected (no row written).
- [ ] 5.3 In the personal-notes integration folder, assert a manual save persists via `upsertPersonalNotes` for an unlocked note under owner RLS, and is denied for a non-owner.

## 6. E2E tests (Playwright, seeded suite)

- [ ] 6.1 Evoluções flow in `src/__tests__/e2e/seeded/`: open editor → button disabled → type → button enabled → click "Salvar" before 10s → indicator shows "Salvo às HH:MM" → reload shows persisted content.
- [ ] 6.2 Plano flow: edit a goal → "Salvar" → persisted; add an empty-description goal → "Salvar" → toast shown, not persisted.
- [ ] 6.3 Notas flow (unlocked): edit → "Salvar" → persisted; verify no "Salvar" button in the locked state.
