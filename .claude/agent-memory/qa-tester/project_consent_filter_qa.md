---
name: consent-filter-qa
description: "Pacientes sem consentimento" filter — /pacientes?filtro=sem-consentimento allowlist, chip+count, per-row copy/WhatsApp actions, minor guardian-phone routing, two recurring fragile spots (mobile a11y names, stale consentShare on pagination)
metadata:
  type: project
---

QA of the patient-list missing-consent pendência filter (`/pacientes?filtro=sem-consentimento`).

**Feature shape:** `resolvePatientListFilter` is a closed allowlist (`['sem-consentimento']`) — unknown/array/empty → null (degrades to full list, no chip, no error). The predicate mirrors the dashboard pendência exactly: `isNull(consent_signed_at) AND isNull(archived_at)`, owner-scoped — so the chip count ("Sem consentimento · N") equals the dashboard "N pacientes sem consentimento" count. Dashboard "Ver" link href is literally `/pacientes?filtro=sem-consentimento`. Page key-remounts on filter toggle (`key={missingConsent?...}`) so removing the chip replaces stale rows (PatientList seeds rows from props via useState and ignores later prop changes).

**Per-row actions (`patient-consent-row-actions.tsx`):** Copiar link + Enviar por WhatsApp. Token = 64-hex `/termo/<token>`, generated via `generateConsent` server action which REUSES the pending token (no duplication — verify with `SELECT count(*) FROM public.consent_terms` per patient). URL built client-side from `window.location.origin`, never in address bar/console (LGPD clean). Adults (individual/couple/elderly) → own phone; minors (child/adolescent) → primary guardian phone (batched lookup, `is_primary DESC, created_at ASC`). No-phone → WhatsApp `[disabled]` + tooltip "Cadastre um telefone para enviar pelo WhatsApp" (wrapped in a focusable span because disabled buttons don't fire Radix tooltip events); copy-link stays enabled.

**Two FRAGILE spots (qa-1, both MÉDIO) — BOTH FIXED + re-verified in qa-2 (2026-06-08):**
1. **Mobile a11y names.** Was: button labels in `<span class="hidden sm:inline">`, icons aria-hidden, so at ≤640px enabled buttons had bare `button` accessible name. FIXED: all copy-link buttons now carry `aria-label="Copiar link do termo"` and all WhatsApp `aria-label="Enviar por WhatsApp"` (enabled AND disabled). Verified at 375px via a11y snapshot — named buttons, not bare.
2. **Stale consentShare on pagination.** Was: `consentShare` dropped from page-2 fetch → all page-2 rows `sharePhone=null` → WhatsApp wrongly disabled. FIXED: seeded 30 unconsented patients w/ phones, paginated to page 2 (`&page=2`), all WhatsApp buttons enabled. Chip persists across pages ("Sem consentimento · N"), filter survives pagination.

LOW: copy-link `await navigator.clipboard.writeText` has NO `.catch` (false "Link copiado" possible on reject) — the session-form-modal and patient-detail drawer already have the `.catch`→error-toast fix; this row-action does not.

**Seeding recipe (fast):** create active psychologist via admin API (see [[authenticated-browser-qa-setup]]), then INSERT into public.patients directly (cols: user_id, full_name, patient_type default 'individual', phone nullable, status default 'active', consent_signed_at/archived_at nullable). Minor needs a public.patient_guardians row (patient_id, full_name, relationship, phone, is_primary=true). Note: `psql ... <<HEREDOC` intermittently committed nothing here — use `-v ON_ERROR_STOP=1 -c "..."` one statement per call. Bash var `UID` is readonly — use PSYID.

Testids: patient-consent-filter-chip, patient-consent-filter-remove (NOTE: the remove button testid is `-filter-remove`, NOT `-chip-remove`; its aria-label is "Remover filtro: sem consentimento"), patient-consent-row-actions, patient-consent-copy-link, patient-consent-whatsapp, patient-consent-whatsapp-tooltip-trigger, patient-list-missing-consent-empty, patient-list-view-all. Empty state: "Nenhum paciente sem consentimento pendente." + "Ver todos os pacientes" → /pacientes. Anonymous deep-link → 307 /login?redirectTo=...(preserved).
