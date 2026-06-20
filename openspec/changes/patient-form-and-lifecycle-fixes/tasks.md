## 1. Phone input — idempotent mask helper (+ unit tests immediately)

- [x] 1.1 Add `maskNationalPhone(raw)` to `src/modules/patients/lib/patient-validators.ts`: strip non-digits, cap at 11, format progressively as `DD NNNNN-NNNN`; no `+55` literal in the parsed/returned text.
- [x] 1.2 Add `toCanonical(national)` and `toNationalDisplay(canonical)` boundary helpers (colocated in `patient-validators.ts` or the component): `toCanonical('')` → `''`, otherwise `'+55 ' + maskNationalPhone(national)`; `toNationalDisplay` strips a leading `+55`/`55` and returns the national mask.
- [x] 1.3 Unit tests in `src/__tests__/unit/modules/patients/lib/patient-validators.test.ts`: idempotency (`maskNationalPhone(maskNationalPhone(x)) === maskNationalPhone(x)`), `11912345678` → `11 91234-5678`, DDD-55 (`55999887766` → `55 99988-7766`), partial-input progression, empty → `''`, and `toCanonical`/`toNationalDisplay` round-trip from `+55 11 91234-5678`.
- [x] 1.4 Run the unit suite for the file and confirm green before moving on.

## 2. Phone input — shared `PhoneInput` component (+ unit/component tests immediately)

- [ ] 2.1 Create `src/modules/patients/components/phone-input.tsx`: controlled component, external `value`/`onChange` in canonical `+55 DD NNNNN-NNNN` (or `''`), internal editable text = national mask, non-editable `+55` adornment (`aria-hidden`, design-system tokens), focus ring on the wrapper.
- [ ] 2.2 Forward `data-testid`, `id`, `aria-invalid`, `placeholder`, `disabled`, `onBlur`, `name`, `ref` to the inner `<input>`; set `type="tel"` and `inputMode="numeric"`.
- [ ] 2.3 Component/unit test for `PhoneInput`: typing digits emits canonical onChange values, the `+55` prefix is not part of the editable value, empty input emits `''`, and prefill of `+55 11 91234-5678` renders `11 91234-5678`. Assert `data-testid` lands on the `<input>`.
- [ ] 2.4 Run the new component test and confirm green.

## 3. Wire `PhoneInput` into all five phone fields (+ adjust existing tests immediately)

- [ ] 3.1 Replace the patient phone field wiring in `patient-form.tsx` (currently `onChange={maskPhone(...)}`) with `PhoneInput`, preserving `data-testid="patient-form-phone"`.
- [ ] 3.2 Replace the reminder phone field with `PhoneInput` (`data-testid="reminder-phone"`); verify the existing `reminder_phone` submit normalization still yields a single `+55` (no double prefix).
- [ ] 3.3 Replace the guardian phone field(s) in the creation form with `PhoneInput` (`data-testid="guardian-${index}-phone"`).
- [ ] 3.4 Replace the partner phone field with `PhoneInput` (`data-testid="partner-phone"`).
- [ ] 3.5 Replace the guardian phone field in `patient-guardians-section.tsx` (add/edit form, `data-testid="guardian-form-phone"`) with `PhoneInput`, keeping the shadcn `FormField` integration.
- [ ] 3.6 Remove `maskPhone` (and its now-unused imports) if no call site remains; otherwise keep only for prefill normalization and note why. Update/adjust any existing unit/integration tests that referenced `maskPhone`.
- [ ] 3.7 Run lint + type-check on the touched files and confirm green.

## 4. Phone input — E2E regression (child registration multi-phone)

- [ ] 4.1 Add a seeded E2E (`src/__tests__/e2e/seeded/`) that registers a `child` patient, typing into the patient phone, reminder phone, and guardian phone fields, asserting each displays the typed number (no `55` corruption) and the patient is created with canonical phones.
- [ ] 4.2 Run the seeded E2E for this flow and confirm green.

## 5. Lifecycle cache — `revalidatePath` in Server Actions (+ integration tests immediately)

- [ ] 5.1 Import `revalidatePath` in `src/app/(app)/pacientes/[id]/actions.ts` and call it in `archivePatient` and `unarchivePatient` for `/pacientes` and `/pacientes/[id]` (page) after a successful mutation.
- [ ] 5.2 Add `revalidatePath('/pacientes')` to `deletePatient` after a successful delete.
- [ ] 5.3 Integration tests in `src/__tests__/integration/patients/` against real Postgres: archive then unarchive transitions (`status`/`archived_at`), and the `already_archived` / `not_archived` guards; assert the actions complete and return `ok` (revalidation invocation asserted via spy/mock where the harness allows).
- [ ] 5.4 Run the integration suite for these tests and confirm green.

## 6. Lifecycle cache — E2E regression (archive → navigate → re-open)

- [ ] 6.1 Add a seeded E2E: archive a patient from the detail page, navigate to `/pacientes`, confirm it is absent under the default active filter, re-open the patient, and assert the actions menu reads "Desarquivar" (never a stale "Arquivar"); then unarchive and assert it reads "Arquivar".
- [ ] 6.2 Run the seeded E2E for this flow and confirm green.

## 7. Verification

- [ ] 7.1 Run the full unit + integration + seeded E2E patient suites; confirm all green.
- [ ] 7.2 Run lint, format, and type-check across the change; confirm clean (no `--no-verify`).
- [ ] 7.3 Manual smoke (or qa-tester): child registration phone entry and archive/unarchive label across navigation.
