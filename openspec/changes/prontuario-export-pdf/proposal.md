## Why

Psychologists must be able to export a patient's complete prontuario as a structured PDF — both for their own records and to fulfill the patient's right of access (LGPD art. 18 + CFP 001/2009 art. 5, codified as RN-05.05). The export aggregates data from six prior changes (evolutions, diagnostic hypotheses, treatment plan, scales, attachments, personal notes) and clinical documents into a single offline-readable file. Large exports (>10MB — PRD 05 §8 edge case) must be generated asynchronously and delivered via email with a signed URL. Every export request is audit-logged for LGPD traceability. This is the capstone change (#7 of 7) in the PRD 05 decomposition and completes the "Exportacao" requirement set (RF-05.32, RF-05.33, RF-05.34).

## What Changes

- New table `prontuario_exports` in `src/shared/db/schema/medical-records/` tracking export lifecycle (pending -> processing -> ready -> expired | failed)
- RLS on `prontuario_exports` (owner-scoped SELECT/INSERT; UPDATE/DELETE blocked from clients — only Inngest service-role transitions status)
- New Server Actions in `src/modules/medical-records/server/exports.ts`: `requestProntuarioExport`, `listProntuarioExports`, `getExportSignedUrl`
- Inngest job `prontuario/export-pdf`: aggregates all prontuario data, applies filters, builds PDF via pdfkit (with embedded scale charts via svg-to-pdfkit), uploads to Supabase Storage bucket `prontuario-exports`, updates row, triggers notification
- Inngest cron `prontuario/expire-exports`: daily cleanup setting expired rows and optionally deleting Storage objects
- Scale chart SVG builder (`src/modules/medical-records/lib/exports/scale-chart-svg.ts`) — hand-built SVG line chart from `(date, score)` pairs (no DOM, no Recharts at runtime)
- Export Modal in the prontuario shell header with filters (date range, section toggles, personal notes opt-in with double confirmation)
- "Exportacoes" sub-route page (`/pacientes/[id]/prontuario/exportacoes`) with Realtime status updates
- Email delivery via existing notifications module when file exceeds 10MB (signed URL, 7-day expiry)
- Audit log entries for both `prontuario.export-request` and `prontuario.export-completed`

## Capabilities

### New Capabilities
- `prontuario-export`: Full PDF export lifecycle — request with filters, async generation via Inngest, status state machine, signed URL access with bounded expiry, Realtime subscription for in-app updates, email delivery for large files, scale chart embedding, personal notes opt-in with double confirmation, audit logging, RLS isolation, daily expiry cron

### Modified Capabilities
<!-- No existing spec requirements are changing. This change adds a new capability that consumes data from all six prior changes but does not alter their behavior or contracts. -->

## Impact

- **Database:** 1 new table (`prontuario_exports`) + migration with RLS + indexes + CHECK constraint on status
- **Drizzle schema:** Addition to `src/shared/db/schema/medical-records/tables.ts` and `policies.ts`
- **Supabase Storage:** New private bucket `prontuario-exports` with per-user prefix policies
- **Module (`src/modules/medical-records/`):** New files in `lib/exports/`, `server/exports.ts`, `components/export-modal.tsx`, `components/exports-list.tsx`, `inngest/export-pdf.ts`, `inngest/expire-exports.ts`
- **Routes:** 1 new page `src/app/(app)/pacientes/[id]/prontuario/exportacoes/page.tsx` (inside existing prontuario shell, no new route-gating required — `/pacientes` prefix already classified as `'app'` by middleware)
- **Inngest:** 2 new functions registered in the serve handler (`prontuario/export-pdf`, `prontuario/expire-exports`)
- **Dependencies:** `svg-to-pdfkit` npm package (embeds SVG into pdfkit doc); pdfkit already installed
- **Notifications module:** Reuses `notify()` from `src/modules/notifications/server/notify.ts` for in-app notification; Resend email for large-file delivery
- **Regulatory:** LGPD art. 11 + art. 18 (right of access), CFP 001/2009 art. 5 (patient access to prontuario), RN-05.03 (personal notes excluded by default), RN-05.04 (RLS isolation), RN-05.05 (export mechanism for patient right of access), Lei 13.787/2018 (audit trail)
- **Security:** RLS on new table, signed URL with bounded expiry (24h default / 7d for email delivery), no raw clinical data in logs, audit trail on every request and completion, personal notes require explicit double-confirmed opt-in
- **Cross-change dependencies:** Depends on ALL six prior changes: foundation (audit_log, evolutions, prontuario shell), diagnostic-hypotheses, treatment-plan, scales-application, attachments-and-personal-notes, formal-documents
