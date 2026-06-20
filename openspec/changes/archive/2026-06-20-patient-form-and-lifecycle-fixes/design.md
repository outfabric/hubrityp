## Context

Two independent defects in the patient module, both confirmed by reading the code and (for the cache bug) the Next.js docs.

**Bug 1 — phone mask.** `maskPhone(raw)` in `src/modules/patients/lib/patient-validators.ts` strips non-digits and then prepends a literal `+55 ` to its output. It is wired into `onChange` of five controlled inputs (`patient-form.tsx`: patient phone, reminder phone, guardian phone, partner phone; `patient-guardians-section.tsx`: guardian add/edit phone). Because the rendered `+55` lives inside the editable value, the next keystroke feeds those two `5` digits back in as data. Simulation of typing `11912345678` yields `+55 55 55555-5555`. The `digits.startsWith('55')` guard only fires at length 12–13, by which point the digit string is already polluted, so it never protects the typing path. A naive "strip leading 55" fix is also wrong for DDD 55 (Rio Grande do Sul).

**Bug 2 — archive label staleness.** `archivePatient`/`unarchivePatient`/`deletePatient` in `src/app/(app)/pacientes/[id]/actions.ts` mutate the DB but never call `revalidatePath`. The detail header derives its menu label purely from `patient.status` (`patient-detail-header.tsx:464`) and `getPatientImpl` returns archived patients (no status filter), so the logic is correct — but it relies on `router.refresh()` alone. Next.js docs confirm `router.refresh()` "clears the Client Cache for the current route, but does **not** invalidate the server-side cache." After archiving and navigating away/back, the un-invalidated Router Cache serves the stale `status="active"` payload and the menu reverts to "Arquivar". The codebase already uses `revalidatePath` for the same class of problem elsewhere (WhatsApp settings, reminder templates, evolution creation), so this is a convention violation.

## Goals / Non-Goals

**Goals:**
- Phone input that is idempotent and free of the `55` corruption, across all five patient-form phone fields, while keeping the stored/submitted/validated format exactly `+55 DD NNNNN-NNNN`.
- Correctly handle DDD 55 (Rio Grande do Sul).
- Archive/unarchive/delete reflect true status across the listing and detail route after any navigation, via server-side cache invalidation matching the existing convention.
- Tests authored alongside each code change (unit → integration → E2E) so the agent retains change context when writing them.

**Non-Goals:**
- No change to the database schema, RLS, stored phone format, or the canonical validators (`isValidBrazilianPhone`, `phoneNumberSchema`).
- No redesign of the actions menu, archive modal, or listing beyond the label/cache correctness.
- No change to the bespoke `reminder_phone` submit normalization beyond what is needed to keep it consistent with the new input contract.
- No introduction of a third-party phone-mask/intl-tel library.

## Decisions

### Decision 1: A shared `PhoneInput` component that speaks canonical externally, national internally

The editable text holds only the national portion (`11 91234-5678`); `+55` is rendered as a non-editable adornment. The component is a controlled input whose external `value`/`onChange` contract is the **canonical** `+55 DD NNNNN-NNNN` string (or `''` when empty).

- **In (prop → display):** strip a leading `+55 ` / `55` country code, show the national mask.
- **Out (typing → onChange):** mask the national digits, emit `'+55 ' + national` (or `''` when the national part is empty so `.optional().or(z.literal(''))` and required checks still behave).

Why canonical-external: it is a near drop-in replacement. The form field stays canonical, so `isValidBrazilianPhone`, Zod schemas, submit payloads, prefill, and `wa.me` are untouched. Speaking national-only externally was rejected — it would ripple into schemas, validators, and the `reminder_phone` conversion for no benefit.

Why a component (not just a better helper): five call sites across two different form stacks (the custom `FormField` in `patient-form.tsx` and the shadcn `Form`/`FormField` in `patient-guardians-section.tsx`). One agnostic controlled component keeps them consistent and is the single place the prefix/mask logic lives. The component must accept and forward `data-testid`, `aria-invalid`, `placeholder`, `id`, `disabled`, `onBlur` to the inner `<input>`.

### Decision 2: A new idempotent national mask helper, not a patched `maskPhone`

Add `maskNationalPhone(raw)` to `patient-validators.ts`: strip non-digits, cap at 11, format progressively as `DD NNNNN-NNNN`. It is idempotent by construction because the editable text it parses never contains the `+55` literal — which is also exactly why DDD 55 is preserved (there is no country code in the parsed string to confuse it). The old `maskPhone` is kept only if still needed for prefill normalization; otherwise removed once all five sites migrate. Boundary helpers (`toNationalDisplay`, `toCanonical`) may be colocated or inlined in the component.

`Input` (`src/shared/ui/input.tsx`) is a bare `<input>` with no prefix slot, so `PhoneInput` wraps it: a flex container styled as one field with the `+55` span (`aria-hidden`, `text-text-tertiary`) on the left and the input to its right; focus ring on the wrapper. `type="tel"`, `inputMode="numeric"`.

### Decision 3: `revalidatePath` in the lifecycle Server Actions

Add to `archivePatient`, `unarchivePatient` (and `deletePatient` for listing freshness):

```
revalidatePath('/pacientes');                 // listing (active/archived filters)
revalidatePath('/pacientes/[id]', 'page');    // detail route
```

Keep the client `router.refresh()` in the header for immediate in-place feedback; `revalidatePath` fixes the cross-navigation staleness that `router.refresh()` provably cannot. This matches the existing convention and adds no new dependency.

### Decision 4: Tests interleaved with each change

Per the change directive, tests land in the same task block as the code they cover:
- **Unit** (`src/__tests__/unit/modules/patients/lib/patient-validators.test.ts`): `maskNationalPhone` idempotency, the `11912345678 → 11 91234-5678` case, DDD-55, partial-input progression, empty → `''`.
- **Integration** (`src/__tests__/integration/patients/`): archive/unarchive against real Postgres asserting status transitions (the server impls already have guards) — and, where feasible, that the actions invoke revalidation; at minimum cover the `already_archived`/`not_archived` guards.
- **E2E** (`src/__tests__/e2e/seeded/`): (a) child registration entering patient + reminder + guardian phones, asserting no `55` corruption and successful create; (b) archive on detail → navigate to listing → re-open patient → assert menu reads "Desarquivar".

## Risks / Trade-offs

- **[Cursor jumps on mid-string edits]** Re-masking a controlled input can move the caret when editing in the middle. → Append-at-end is the common path; keep the mask minimal and, if needed, restore caret position. Covered by the E2E typing test.
- **[Existing selectors break]** Wrapping the input could orphan `data-testid`s used by integration/e2e. → Contract: `data-testid`, `aria-invalid`, `id` always land on the inner `<input>`; assert in tests.
- **[`reminder_phone` double formatting]** `patient-form.tsx` has bespoke submit normalization for `reminder_phone`. → Since the field value stays canonical, that path is unaffected; verify it still produces a single `+55` on submit.
- **[`revalidatePath` dynamic segment syntax]** Wrong path/type silently no-ops. → Use `revalidatePath('/pacientes/[id]', 'page')` form; the E2E navigation test is the backstop that proves invalidation actually happened.
- **[Over-broad revalidation]** Revalidating `/pacientes` invalidates the whole listing cache. → Acceptable and intended; listing must reflect archive/delete.
