## 1. Agenda — display copy + coupled tests

- [x] 1.1 Correct diacritics/cedillas in display copy under `src/modules/agenda/components/**` and `src/modules/agenda/server/**` user-facing messages (toasts, dialog text, labels, placeholders, aria-labels), leaving route segments, identifiers, and status tokens untouched
- [x] 1.2 Update coupled e2e assertions to corrected strings: `session-cancel.spec.ts`, `session-create.spec.ts`, `session-drag-drop.spec.ts`, `session-mark-done.spec.ts`, `session-no-show.spec.ts` (e.g. `'Sessao cancelada'` → `'Sessão cancelada'`)
- [x] 1.3 Update coupled unit assertions: `cancel-session-dialog.test.tsx`, `delete-session-dialog.test.tsx`, `session-action-buttons.test.tsx`
- [x] 1.4 Validate slice: lint + typecheck + unit + scoped integration/e2e for changed specs green

## 2. Medical-records / prontuário — display copy + label maps + coupled tests

- [x] 2.1 Correct display copy under `src/modules/medical-records/components/**` (toasts, dialog/modal text, labels, placeholders)
- [x] 2.2 Correct human-readable label map `DOCUMENT_TYPE_LABELS` in `src/modules/medical-records/lib/document-type-config.ts` (`Atestado Psicológico`, `Laudo Psicológico`, `Parecer Psicológico`, …) — DO NOT touch the stored enum tokens `['declaracao','atestado','relatorio','laudo','parecer']` or the DB `CHECK` constraint
- [x] 2.3 Correct Zod validation message prose in `src/modules/medical-records/lib/**` (e.g. `'Descricao obrigatoria'` → `'Descrição obrigatória'`); when a message lists enum tokens, accent the prose but keep the literal token spellings
- [x] 2.4 Correct generated-PDF metadata prose: `Subject`/`Title` in `lib/exports/pdf-builder.ts` and `lib/pdf/build-clinical-document-pdf.ts` (`'Exportação de Prontuário Psicológico'`, `'Sem título'`)
- [x] 2.5 Update coupled e2e assertions: `prontuario/treatment-plan.spec.ts`, `prontuario/clinical-documents.spec.ts`, `prontuario/attachments-and-notes.spec.ts`
- [x] 2.6 Update coupled unit assertions: `scale-public-form.test.tsx`, `exports/sections/cover-page.test.ts`, `inngest/remind-missing-evolution.test.ts`
- [x] 2.7 Validate slice: lint + typecheck + unit + scoped integration/e2e for changed specs green

## 3. Telepsicologia — display copy + coupled tests

- [ ] 3.1 Correct display copy under `src/modules/telepsicologia/components/**` (call controls, recording controls, lobby, prontuário drawer, in-call chat, aria-labels)
- [ ] 3.2 Update coupled unit assertions: `end-call-dialog.test.tsx`, `pre-call-lobby.test.tsx`, `prontuario-call-drawer.test.tsx`, `recording-controls.test.tsx`, `screen-share-indicator.test.tsx`
- [ ] 3.3 Validate slice: lint + typecheck + unit + scoped integration/e2e for changed specs green

## 4. Patients — display copy + coupled tests

- [ ] 4.1 Correct display copy under `src/modules/patients/components/**` and `src/app/(app)/pacientes/**` (forms, anamnesis tab, placeholders, dialog text) — leave the `/pacientes` route segment and identifiers untouched
- [ ] 4.2 Update any coupled unit/integration assertions surfaced by the patients copy changes (verify via grep after editing)
- [ ] 4.3 Validate slice: lint + typecheck + unit + scoped integration/e2e for changed specs green

## 5. WhatsApp — display copy + coupled tests

- [ ] 5.1 Correct display copy under `src/modules/whatsapp/components/**` (inbox, analytics dashboard, connect dialog, health banner, reminder settings)
- [ ] 5.2 Update coupled e2e assertions: `whatsapp/inbox/inbox-list-and-open.spec.ts`, `whatsapp/inbox/risk-alert-flow.spec.ts`, `whatsapp/session-disable-reminders.spec.ts`
- [ ] 5.3 Update coupled integration/unit assertions: `integration/whatsapp/inbox/risk-flow.int.test.ts`, `unit/.../lib/inbox/detect-risk-keywords.test.ts` (only if asserting on display copy, not on stored keyword tokens)
- [ ] 5.4 Validate slice: lint + typecheck + unit + scoped integration/e2e for changed specs green

## 6. Sessions — display copy + coupled tests

- [ ] 6.1 Correct display copy under `src/modules/sessions/components/**` (edit-scope dialog, recurrence form section)
- [ ] 6.2 Update coupled unit assertions: `edit-scope-dialog.test.tsx`, `recurrence-form-section.test.tsx`
- [ ] 6.3 Validate slice: lint + typecheck + unit + scoped integration/e2e for changed specs green

## 7. Auth / onboarding / oauth + page metadata + email templates

- [ ] 7.1 Correct display copy under `src/modules/auth/**`, `src/modules/registration/**`, `src/modules/onboarding/**`, `src/modules/oauth/**`, `src/modules/password-recovery/**` (forms, pending cards, tour copy)
- [ ] 7.2 Correct page metadata prose (`title`/`description`) in route `layout.tsx`/`page.tsx` files (e.g. `confirmar-sessao/layout.tsx` `'Confirme ou cancele sua sessão agendada.'`) — leave URL segments untouched
- [ ] 7.3 Correct transactional email subjects/bodies under `src/shared/lib/mail/**` (account-locked, password-changed, nps-detractor-followup)
- [ ] 7.4 Update any coupled unit/integration assertions surfaced by these changes (verify via grep after editing)
- [ ] 7.5 Validate slice: lint + typecheck + unit + scoped integration/e2e for changed specs green

## 8. Clinical scales — conservative diacritic fix + review markers

- [ ] 8.1 In `src/modules/medical-records/lib/scales/**` (AUDIT, SDQ, …) add ONLY unambiguous diacritics to prompts/options (`frequencia`→`frequência`, `ultimo`→`último`, `voce`→`você`, `nao`→`não`); do NOT reword or restructure
- [ ] 8.2 Add a `TODO(clinical-review)` marker on each touched scale (canonical validated wording verification deferred to clinical review)
- [ ] 8.3 Validate slice: lint + typecheck + unit green (scale-public-form / scale unit tests)

## 9. cspell guard — install, configure, allowlist, wire into CI

- [ ] 9.1 Add `cspell` + a pt-BR dictionary dev dependency (confirm package via Context7/npm); add `npm run spell` script
- [ ] 9.2 Create cspell config scoped to `src/**` (TS/TSX), excluding generated output (drizzle `migrations/meta/`, lockfiles, build artifacts)
- [ ] 9.3 Author the allowlist / project dictionary encoding intentional ASCII: route segments (`pacientes`, `configuracoes`, `transcricoes`, `confirmar-sessao`, `sessao`, `caixa-de-entrada`), stored enum tokens (`declaracao`, `atestado`, `relatorio`, `laudo`, `parecer`, `cancelled`), and vendor/technical/domain terms (Twilio, Asaas, Inngest, Drizzle, Supabase, Gemini, PIX, CRP, CPF, LGPD, …)
- [ ] 9.4 Run `npm run spell` over the whole tree; fix any residual user-facing misspellings it surfaces that the per-module passes missed (the exhaustiveness backstop)
- [ ] 9.5 Wire the spell step into the lint/CI pipeline so future PRs are guarded (blocking once the tree is clean)
- [ ] 9.6 Final validation: full lint + typecheck + unit + integration + e2e-seeded green, and `npm run spell` clean
