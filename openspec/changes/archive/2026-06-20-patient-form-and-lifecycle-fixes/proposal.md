## Why

Two production bugs in the patient module degrade core CRUD flows:

1. **Phone fields corrupt on input.** The progressive mask (`maskPhone`) is not idempotent: it renders a literal `+55` prefix into the editable value, then re-reads that `55` as data digits on the next keystroke. Typing a real number (e.g. `11912345678`) collapses into `+55 55 55555-5555`. This affects every phone field in the patient forms — patient phone, reminder phone, partner phone, and (most visibly) the guardian phones on a "child" registration.
2. **Archive/unarchive UI shows the wrong action after navigation.** The `archivePatient`/`unarchivePatient` Server Actions mutate the database but never call `revalidatePath`, relying solely on the client `router.refresh()`. Per Next.js, `router.refresh()` clears only the *current* route's client cache and never invalidates the server-side cache — so after archiving and navigating away and back, the stale Router Cache serves `status="active"` and the actions menu offers "Arquivar" again instead of "Desarquivar".

Both are confirmed, reproducible, and break the user's trust in basic data entry and lifecycle management.

## What Changes

- **Phone input becomes idempotent and unambiguous.** Replace the per-field inline `maskPhone(onChange)` wiring with a single controlled `PhoneInput` component that renders `+55` as a **non-editable visual prefix** and keeps only the national portion (DDD + number) in the editable text. Externally the component still speaks the canonical `+55 DD NNNNN-NNNN` string, so validators, schemas, submit payloads, and `wa.me` links are unchanged. A new national-only mask helper is idempotent by construction, which also fixes the DDD-55 (Rio Grande do Sul) edge case the old `55`-strip heuristic could mangle.
- **Apply the new input to all five patient phone fields**: patient phone, reminder phone, guardian phone (creation form), partner phone, and guardian phone (detail-page add/edit form).
- **Patient lifecycle mutations invalidate server-side cache.** `archivePatient`, `unarchivePatient`, and `deletePatient` call `revalidatePath` for the listing (`/pacientes`) and the detail route (`/pacientes/[id]`), matching the established codebase convention (WhatsApp settings, reminder templates, evolution creation). The actions-menu label and the listing then reflect the true status after any navigation.

## Capabilities

### New Capabilities
<!-- None — both fixes are corrections to existing, already-specced behavior. -->

### Modified Capabilities
- `patient-crud`: phone fields in the create/edit forms gain an explicit requirement that input is masked idempotently behind a fixed `+55` prefix (covering patient, reminder, guardian, and partner phones); the archive/unarchive requirement gains an explicit cache-invalidation guarantee so listing and detail reflect the new status after navigation.
- `patient-detail`: the actions-menu requirement gains an explicit guarantee that the Arquivar/Desarquivar label reflects the patient's current persisted status after a lifecycle change (no stale label across client-side navigation).

## Impact

- **Code (UI):** new `PhoneInput` component (`src/modules/patients/components/`); rewiring of phone fields in `patient-form.tsx` and `patient-guardians-section.tsx`. `data-testid`s on the inner `<input>` are preserved so existing e2e/integration selectors keep working.
- **Code (lib):** new idempotent national-phone mask helper in `patient-validators.ts`; `maskPhone` retained only where prefill normalization is still needed (or removed once all call sites migrate).
- **Code (actions):** `revalidatePath` added to `archivePatient`, `unarchivePatient`, `deletePatient` in `src/app/(app)/pacientes/[id]/actions.ts`.
- **No DB / schema / RLS changes.** Storage format (`+55 DD NNNNN-NNNN`), validators, and server impls are untouched.
- **Tests:** unit (mask idempotency + DDD-55), integration (lifecycle actions revalidate), and E2E (child registration multi-phone entry; archive→navigate→re-open label) added alongside each code change.
