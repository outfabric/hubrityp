---
name: ai-transcription-review-ui
description: AI transcription review UI feature — routes, states, review-form gating, seeding recipe, and QA findings
metadata:
  type: project
---

The AI transcription review feature lives at `/dashboard/transcricoes` (list, gated as `/dashboard*` 'app' class) and `/dashboard/transcricoes/[id]/revisar` (review). List has 3 buckets via Radix Tabs: Pendentes (status='ready' AND saved_to_prontuario=false), Revisadas (status='reviewed'), Falhas (status='failed'). Empty state: H4 "Nenhuma transcrição ainda" + "Ver pacientes" CTA → `/dashboard/pacientes`.

Review page branches by status:
- `ready` → DraftWarningBanner (warning/yellow, role=alert) + optional RiskAlertBanner + form. Save button (`save-to-prontuario-btn`) disabled until `reviewed-checkbox` checked. Discard requires typing exact word `DESCARTAR` (case-sensitive) in a confirm dialog; Esc cancels.
- `failed`/`cancelled` → no form; friendly pt-BR error message (ERROR_CODE_LABELS, e.g. gemini_429) + "Tentar de novo" retry link to `/pacientes/[id]/prontuario`.
- NOT_FOUND / INVALID_INPUT (malformed UUID) → neutral `transcription-not-found` Alert, no crash. Privacy-correct: does not reveal cross-tenant existence; URL carries only the transcription UUID (no patient name / note content).

**Seeding recipe (for scenarios needing data):** create confirmed user via GoTrue admin API (`POST :54321/auth/v1/admin/users` with `email_confirm:true` + user_metadata fullName/crpNumber/crpUf/termsAcceptedAt/privacyAcceptedAt/sensitiveDataConsentAt — the `handle_new_user` trigger reads these), then `update profiles set status='active'`. Insert a `patients` row (only user_id + full_name required), then an `ai_transcriptions` row (user_id, patient_id, source required). `generated_note` jsonb needs `schemaVersion:1`. **`risk_alerts` items require `kind`/`excerpt`/`confidence` (low|medium|high) — NOT `severity`; a wrong field is silently dropped on Zod parse and the risk banner won't render.** Local stack starts with 0 public tables; run `docker exec <app> npm run db:migrate` first (see [[local-env-setup-notes]]).

**Known accessibility-polish (LOW):** Alert's AlertTitle renders H5, so review page jumps H1→H5 and not-found state has H5 with no H1 (WCAG 1.3.1 heading order). Transcrições has no sidebar nav entry — reachable only by deep link (possible by-design; product confirm).

**Dev/env console noise (not bugs):** local CSP warnings for internal docker host `supabase_kong_hubrityp:8000` and React dev-mode `eval() is not supported`. Filter these when sweeping for real app errors.
