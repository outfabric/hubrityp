---
name: patient-phone-input-and-lifecycle-qa
description: QA of patient-form PhoneInput (+55 adornment, idempotent national mask) and archive/unarchive cache fix — field structure, DDD-55 case, the paste-mangling and unarchive-modal-copy MÉDIO traps, testids/routes
metadata:
  type: project
---

QA of the `patient-form-and-lifecycle-fixes` branch (worktree `/home/ubuntu/repos/hubrityp-patient-form-and-lifecycle-fixes`). Two fixes: shared `PhoneInput` + idempotent mask, and archive/unarchive cross-route cache staleness fix.

**PhoneInput design** (`src/modules/patients/components/phone-input.tsx`, helpers in `lib/patient-validators.ts`): the editable `<input type=tel inputmode=numeric>` holds ONLY the national part `DD NNNNN-NNNN`; `+55` is a fixed `aria-hidden=true tabIndex=-1` `<span>` adornment (color text-tertiary `rgb(120,113,108)`, user-select:none). Canonical value `+55 DD NNNNN-NNNN` lives only at the boundary via `toCanonical`/`toNationalDisplay`. This is why DDD-55 (Rio Grande do Sul) round-trips correctly — the old `maskPhone` re-fed its own `5`s as data. Stored format: patient/guardian phones = canonical `+55 DD NNNNN-NNNN` (via `formatPhone` in create-patient); reminder phone = E.164 `+55DDNNNNNNNNN` (no spaces, by design — patient-form.tsx ~L462).

**Five phone fields**, all PhoneInput: patient (`/pacientes/novo`, type Adulto), reminder ("Telefone alternativo para lembretes"), guardian (child/adolescent → "Adicionar responsável" reveals it), partner (Casal → "Parceiro(a)" section). Both new-patient and edit (`/pacientes/[id]/editar`) forms are 2-step (step1 → "Próximo" → step2 → "Salvar").

**Two MÉDIO traps — BOTH FIXED & re-verified in QA iteration 2 (commit `780ae5d`, 2026-06-20):**
1. **Paste mangling — FIXED.** `maskNationalPhone` (patient-validators.ts:91-101) now strips a leading `55` when `allDigits.length > 11 && startsWith('55')` BEFORE capping at 11, so paste behaves identically to typing. Verified: `+55 11 91234-5678`→`11 91234-5678`; `5511912345678`→`11 91234-5678`; the old false-pass `+55 91 91234-5678`→`91 91234-5678` (NOT `55 91912-3456`); DDD-55 preserved (`55999887766` typed→`55 99988-7766`, and even `+55 55 99988-7766` pasted→`55 99988-7766` since a ≤11-digit national number is never mistaken for a country code).
2. **Unarchive modal copy — FIXED.** `ArchiveConfirmModal` now takes an `isArchived` prop; header passes `isArchived={patient.status !== 'active'}` (patient-detail-header.tsx ~L505). Unarchive renders title "Desarquivar paciente", body "O paciente voltará a aparecer na listagem ativa e poderá ser atendido normalmente.", button "Desarquivar". Archive variant copy unchanged (CFP/Lei retention). Verified both variants via modal innerText.

**Archive cache fix VERIFIED working**: `revalidatePath('/pacientes')` + `revalidatePath('/pacientes/${id}','page')` in `src/app/(app)/pacientes/[id]/actions.ts` archive/unarchive/delete actions fixes the cross-route staleness — after archive→navigate-to-listing→re-open, the menu shows "Desarquivar" (does not revert). Menu label logic: `patient.status === 'active' ? 'Arquivar' : 'Desarquivar'` (header L464). Detail badge shows Ativo/Arquivado.

**Useful refs**: actions menu = button "Mais opções"; menuitem testids `patient-action-archive` etc; modal testids `archive-confirm-modal`/`-cancel`/`-submit`; form testids `patient-form`, `patient-form-step1`, `patient-form-fullname`, `patient-form-type`. Archive confirm body carries CFP Resolução 001/2009 + Lei 13.787/2018 retention copy. Mobile 375px: patient-detail page has a PRE-EXISTING horizontal overflow (729px) from a non-wrapping AI-transcription consent `<p>` (~647px), NOT the phone/lifecycle components; archive dialog itself fits 375px cleanly.

See [[authenticated_browser_qa_setup]], [[onboarding_checklist_and_tour_qa]] (cookie-injection workaround), [[playwright_cli_invocation]].
