## 1. Schema and Database

- [x] 1.1 Add `prontuarioExports` table definition to `src/shared/db/schema/medical-records/tables.ts` with all columns (id, user_id, patient_id, status, filters, storage_path, file_size, error_message, expires_at, created_at, completed_at), indexes, and CHECK constraint on status
- [x] 1.2 Add RLS policies to `src/shared/db/schema/medical-records/policies.ts` — SELECT and INSERT for authenticated scoped by `user_id = auth.uid()`, no UPDATE/DELETE for authenticated
- [x] 1.3 Re-export from `src/shared/db/schema/medical-records/index.ts` and `src/shared/db/schema/index.ts`
- [x] 1.4 Generate Drizzle migration via `npm run db:generate`, append RLS SQL + CHECK constraint + Storage bucket creation + Storage policies to the migration file
- [x] 1.5 Run `npm run db:migrate` and verify locally

## 2. Zod Schemas and Export Lib

- [x] 2.1 Create `src/modules/medical-records/lib/exports/export-schemas.ts` with `exportFiltersSchema`, `exportSectionsSchema`, and derived types
- [x] 2.2 Create `src/modules/medical-records/lib/exports/expiry-calculator.ts` — pure function computing expires_at from file_size threshold (10MB) and completed_at
- [x] 2.3 Create `src/modules/medical-records/lib/exports/scale-chart-svg.ts` — pure function taking `Array<{date: string; score: number}>` with scale metadata (min/max, thresholds) and returning an SVG string (line chart with axes, dots, threshold lines)
- [x] 2.4 Create barrel `src/modules/medical-records/lib/exports/index.ts`

## 3. PDF Section Builders

- [x] 3.1 Create `src/modules/medical-records/lib/exports/sections/footer.ts` — page footer renderer ("Pagina X de Y - Documento sigiloso — Salvia - Gerado em {timestamp}")
- [x] 3.2 Create `src/modules/medical-records/lib/exports/sections/cover-page.ts` — patient identification, psychologist info, export date/time, filters summary
- [x] 3.3 Create `src/modules/medical-records/lib/exports/sections/anamnesis-section.ts` — renders all standard anamnesis sections formatted as headings + body text
- [x] 3.4 Create `src/modules/medical-records/lib/exports/sections/evolutions-section.ts` — chronological by month with template-aware field rendering and addendum blocks
- [x] 3.5 Create `src/modules/medical-records/lib/exports/sections/hypotheses-section.ts` — table (CID-10, description, status, date)
- [x] 3.6 Create `src/modules/medical-records/lib/exports/sections/treatment-plan-section.ts` — goals list, phases, resources, criteria, version count footer
- [x] 3.7 Create `src/modules/medical-records/lib/exports/sections/scales-section.ts` — per-scale data table + embedded SVG chart via svg-to-pdfkit
- [x] 3.8 Create `src/modules/medical-records/lib/exports/sections/documents-section.ts` — reference table (type, title, status, date, references_cid10)
- [x] 3.9 Create `src/modules/medical-records/lib/exports/sections/attachments-section.ts` — category summary + reference table (display_name, category, size, uploaded_at)
- [x] 3.10 Create `src/modules/medical-records/lib/exports/sections/personal-notes-section.ts` — prominent warning header + content
- [x] 3.11 Create `src/modules/medical-records/lib/exports/pdf-builder.ts` — orchestrator that creates PDFKit doc, registers page event for footer, calls section builders in order, returns Buffer

## 4. Server Actions

- [x] 4.1 Create `src/modules/medical-records/server/exports.ts` with `requestProntuarioExport` — validates session via `auth.getUser()`, validates patient ownership, validates filters with Zod, inserts `prontuario_exports` row, writes audit_log, triggers Inngest event, returns `{ok: true, id}`
- [x] 4.2 Add `listProntuarioExports` — authenticated, returns user's exports (optionally filtered by patientId), reverse chronological, includes patient name join
- [x] 4.3 Add `getExportSignedUrl` — validates ownership + status='ready' + not expired, generates Supabase Storage signed URL with expiry matching row's expires_at

## 5. Inngest Functions

- [x] 5.1 Create `src/modules/medical-records/inngest/client.ts` (or extend existing if one exists for medical-records) with event types for `prontuario/export-pdf` and the cron
- [x] 5.2 Create `src/modules/medical-records/inngest/export-pdf.ts` — the main job with steps: update-status, fetch-patient, fetch-anamnesis, fetch-evolutions (with dateRange filter), fetch-hypotheses, fetch-treatment-plan, fetch-scales (with dateRange filter), fetch-documents, fetch-attachments, fetch-personal-notes (conditional), build-pdf, upload to Storage, complete (set status/path/size/expiry), notify (in-app + email if >10MB), audit-complete
- [x] 5.3 Create `src/modules/medical-records/inngest/expire-exports.ts` — daily cron at 06:00 UTC, selects expired-ready rows, updates status to 'expired', deletes Storage objects (non-fatal on failure)
- [x] 5.4 Register both functions in the Inngest serve handler (likely `src/app/api/inngest/route.ts`)

## 6. Frontend — Export Modal

- [x] 6.1 Create `src/modules/medical-records/components/export-modal.tsx` — Dialog with h3 title, info Alert, DateRangePicker, sections checkboxes, personal notes toggle with AlertDialog confirmation, optional email input, Cancel (ghost) and "Gerar exportacao" (primary) buttons
- [x] 6.2 Add "Exportar prontuario" button (Download icon) in the prontuario shell header (modify existing prontuario page/layout)
- [x] 6.3 Wire modal form submission to `requestProntuarioExport` Server Action with loading state, Sonner toast on success, modal close

## 7. Frontend — Exportacoes Page

- [x] 7.1 Create `src/app/(app)/pacientes/[id]/prontuario/exportacoes/page.tsx` — RSC page that fetches initial export list, renders ExportsList client component
- [x] 7.2 Create `src/modules/medical-records/components/exports-list.tsx` — client component with Supabase Realtime subscription on `prontuario_exports` filtered by user_id, renders Card per export with status-dependent UI (spinner/download/expired/retry)
- [x] 7.3 Implement empty state for no exports: Download icon, h4 "Nenhuma exportacao ainda", description "Use o botao 'Exportar prontuario' para gerar um PDF completo."
- [x] 7.4 Implement Sonner toast trigger on Realtime status transition to 'ready' or 'failed'
- [x] 7.5 Add navigation link to Exportacoes page from the prontuario shell (e.g., in the header near the export button)

## 8. Module Barrel Update

- [x] 8.1 Update `src/modules/medical-records/index.ts` barrel to export new public API surface (Server Actions, schemas, component types)

## 9. Unit Tests

- [x] 9.1 Create `src/__tests__/unit/modules/medical-records/exports/export-schemas.test.ts` — validates exportFiltersSchema (dateRange validity, sections shape, includePersonalNotes default false, deliveryEmail optional)
- [x] 9.2 Create `src/__tests__/unit/modules/medical-records/exports/expiry-calculator.test.ts` — file_size threshold logic (<=10MB -> 24h, >10MB -> 7d)
- [x] 9.3 Create `src/__tests__/unit/modules/medical-records/exports/scale-chart-svg.test.ts` — given `[(date, score)]` produces valid `<svg>` string with axes, line, dots; snapshot test for known fixture; handles edge cases (1 point, empty array)
- [x] 9.4 Create `src/__tests__/unit/modules/medical-records/exports/sections/cover-page.test.ts` — verifies cover page builder produces expected pdfkit calls with patient/psychologist info
- [x] 9.5 Create `src/__tests__/unit/modules/medical-records/exports/sections/evolutions-section.test.ts` — verifies monthly grouping, template-aware rendering for TCC/livre/psicanalise, addendum formatting
- [x] 9.6 Create `src/__tests__/unit/modules/medical-records/exports/sections/hypotheses-section.test.ts` — table rendering with CID-10 codes and status badges
- [x] 9.7 Create `src/__tests__/unit/modules/medical-records/exports/sections/attachments-section.test.ts` — category summary counting and table row rendering
- [x] 9.8 Create `src/__tests__/unit/modules/medical-records/exports/filter-application.test.ts` — dateRange clips evolutions correctly, sections=false skips block, personalNotes default excluded

## 10. Integration Tests

- [x] 10.1 Create `src/__tests__/integration/medical-records/exports/request-export.int.test.ts` — requestProntuarioExport creates row + audit_log entry + asserts Inngest event emitted with correct payload
- [x] 10.2 Create `src/__tests__/integration/medical-records/exports/rls-isolation.int.test.ts` — psicólogo B cannot SELECT/INSERT/sign-url psicólogo A's exports (negative auth test)
- [x] 10.3 Create `src/__tests__/integration/medical-records/exports/export-job.int.test.ts` — mock Inngest run with seeded patient data: job produces non-empty PDF buffer, status transitions pending->processing->ready, storage_path set, expires_at set correctly based on file_size
- [x] 10.4 Create `src/__tests__/integration/medical-records/exports/personal-notes-exclusion.int.test.ts` — includePersonalNotes=false: known personal notes content NOT present in produced PDF text; includePersonalNotes=true: content IS present
- [x] 10.5 Create `src/__tests__/integration/medical-records/exports/signed-url.int.test.ts` — getExportSignedUrl during status≠ready -> rejected; after expires_at -> rejected; for another user -> rejected
- [x] 10.6 Create `src/__tests__/integration/medical-records/exports/expire-cron.int.test.ts` — cron transitions ready->expired rows and optionally cleans Storage
- [x] 10.7 Create `src/__tests__/integration/medical-records/exports/audit-entries.int.test.ts` — verifies both request and completion audit_log entries with correct action and metadata
- [x] 10.8 Create `src/__tests__/integration/medical-records/exports/email-delivery.int.test.ts` — email delivery path triggered when mocked file_size >10MB; not triggered when <=10MB

## 11. E2E Tests

- [ ] 11.1 Create `src/__tests__/e2e/seeded/prontuario/export.spec.ts` — open prontuario -> click "Exportar prontuario" -> set date range -> uncheck "Documentos" -> submit -> toast appears -> navigate to Exportacoes page -> assert export appears with status; Inngest runs sync in e2e env -> status becomes ready -> click "Baixar" -> assert PDF download starts and file is non-empty
- [ ] 11.2 Add personal notes scenario to e2e: toggle personal notes on -> AlertDialog requires "INCLUIR" typed -> submit -> export includes personal notes section header (verify via integration assertion or PDF text parse)
- [ ] 11.3 Add date range exclusion scenario: filter date range that excludes all evolutions -> export PDF generates with "Nenhuma evolucao no periodo selecionado" text
