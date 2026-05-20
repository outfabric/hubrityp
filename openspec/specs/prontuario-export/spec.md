# prontuario-export Specification

## Purpose

Defines the full PDF export lifecycle for the electronic medical record (prontuario): request with section/date-range filters, asynchronous generation via Inngest with status state machine (pending -> processing -> ready -> expired | failed), signed URL access with bounded expiry (24h default / 7d for large files), Supabase Realtime subscription for in-app status updates, email delivery for large files (>10MB), embedded scale chart SVG generation, personal notes opt-in with double confirmation, export modal with filter controls, Exportacoes sub-route page with real-time status cards, audit logging on every request and completion, RLS owner-scoped isolation (no client UPDATE/DELETE — only service-role transitions status), and daily expiry cron for Storage cleanup. Fulfills LGPD art. 18 (right of access), CFP 001/2009 art. 5 (patient access to prontuario), and RN-05.05 (export mechanism). Created by archiving change `prontuario-export-pdf`.

## Requirements

### Requirement: Psychologist can request a full prontuario PDF export

The system SHALL allow a psychologist to request a PDF export of a patient's complete prontuario. The request MUST validate that the psychologist owns the patient (via `auth.getUser()` session + RLS), persist the request in `prontuario_exports` with status `pending`, write an audit_log entry (`action='prontuario.export-request'`), and trigger an asynchronous Inngest event to generate the PDF.

#### Scenario: Successful export request

- **WHEN** psychologist submits the export modal with valid filters for a patient they own
- **THEN** system creates a `prontuario_exports` row with status='pending', creates an audit_log entry with action='prontuario.export-request' and metadata containing the filters and IP, triggers Inngest event `prontuario/export-pdf` with the exportId, and returns success

#### Scenario: Export request for patient not owned by psychologist

- **WHEN** an authenticated psychologist attempts to request export for a patient_id they do not own
- **THEN** system rejects the request with a NOT_FOUND error (not revealing whether the patient exists) and does NOT create any export row or audit entry

#### Scenario: Unauthenticated export request

- **WHEN** an anonymous user attempts to call requestProntuarioExport
- **THEN** system rejects with UNAUTHORIZED and no row is created

### Requirement: Export filters control which sections and date range are included

The system SHALL accept filters at request time controlling: date range (from/to, nullable for "all time"), section toggles (anamnese, evolucoes, hipoteses, planoTerapeutico, escalas, documentos, anexosIndex — all default to true), includePersonalNotes (default false), and optional deliveryEmail. Filters MUST be validated via Zod schema at the Server Action boundary.

#### Scenario: Date range filters evolutions and scales

- **WHEN** psychologist sets dateRange.from='2025-01-01' and dateRange.to='2025-06-30'
- **THEN** only evolutions created within that range and scale_applications applied within that range are included in the PDF; other sections (anamnesis, hypotheses, treatment plan) are included in full regardless of date range

#### Scenario: Section toggle excludes a section

- **WHEN** psychologist unchecks "Documentos" in the sections filter
- **THEN** the generated PDF does NOT contain the clinical documents reference table

#### Scenario: Invalid filter shape rejected

- **WHEN** a request sends malformed filters (e.g., dateRange.from is not a valid ISO datetime)
- **THEN** system rejects with VALIDATION_ERROR before creating any row

### Requirement: Personal notes are excluded by default and require double confirmation to include

The system SHALL default `includePersonalNotes` to false. To set it to true, the UI MUST present a destructive-style AlertDialog requiring the user to type "INCLUIR" as confirmation. The Server Action MUST accept the boolean as-is (the double-confirmation is a UI-level gate, not server-enforced — but the audit_log metadata records whether personal notes were included).

#### Scenario: Default export excludes personal notes

- **WHEN** psychologist submits the export modal without interacting with the personal notes toggle
- **THEN** the generated PDF does NOT contain the personal notes section, and audit metadata shows `includePersonalNotes: false`

#### Scenario: Personal notes included after double confirmation

- **WHEN** psychologist toggles "Incluir notas pessoais" and types "INCLUIR" in the confirmation dialog and submits
- **THEN** the generated PDF contains the personal notes section with a prominent header "ATENCAO — Conteudo restrito ao psicologo" and audit metadata shows `includePersonalNotes: true`

#### Scenario: Personal notes toggle cancelled before confirmation

- **WHEN** psychologist toggles "Incluir notas pessoais" but dismisses the confirmation dialog without typing "INCLUIR"
- **THEN** the toggle remains off and the export proceeds without personal notes

### Requirement: PDF is generated asynchronously via Inngest job with status state machine

The system SHALL generate the PDF in a background Inngest function (`prontuario/export-pdf`). The export row MUST transition through states: `pending -> processing -> ready` on success, or `pending -> processing -> failed` on error. The job MUST be idempotent (same exportId = same execution), have a 5-minute timeout, and retry individual steps up to 3 times.

#### Scenario: Successful PDF generation

- **WHEN** Inngest processes the `prontuario/export-pdf` event for a valid export row
- **THEN** status transitions to 'processing', then to 'ready' with storage_path, file_size, completed_at, and expires_at set

#### Scenario: PDF generation failure after retries exhausted

- **WHEN** the Inngest job encounters an unrecoverable error (e.g., patient data inaccessible)
- **THEN** status transitions to 'failed' with a sanitized error_message (no PII, no SQL, no stack trace)

#### Scenario: Duplicate event delivery (idempotency)

- **WHEN** Inngest delivers the same event twice for the same exportId
- **THEN** only one execution proceeds; the duplicate is deduplicated by Inngest's function-level idempotency key

### Requirement: Generated PDF follows the prescribed structure

The generated PDF MUST contain the following sections in order (each controlled by the filters): cover page (always), anamnesis, evolutions (chronological by month), diagnostic hypotheses (table), treatment plan (current state), scales (per-scale table + line chart SVG), clinical documents (reference table), attachments (reference table with category summary), and personal notes (only if opted in, with warning header). Every page MUST have a footer: "Pagina X de Y - Documento sigiloso — Salvia - Gerado em {timestamp}".

#### Scenario: Full export with all sections

- **WHEN** all section filters are true and includePersonalNotes is true
- **THEN** the PDF contains all sections in the prescribed order with the footer on every page

#### Scenario: Export with empty evolutions in date range

- **WHEN** date range excludes all evolutions (no evolutions exist in the period)
- **THEN** the evolutions section renders with text "Nenhuma evolucao no periodo selecionado" instead of being omitted

#### Scenario: Scale section includes embedded SVG line chart

- **WHEN** a patient has 3+ applications of PHQ-9
- **THEN** the scales section for PHQ-9 contains a data table AND an embedded line chart showing score progression over time

### Requirement: Export PDF is stored in Supabase Storage with bounded expiry

The system SHALL upload the generated PDF to Storage bucket `prontuario-exports` with key pattern `${user_id}/${patient_id}/${exportId}.pdf`. The `expires_at` MUST be set to completion_time + 24 hours for exports <= 10MB, or completion_time + 7 days for exports > 10MB.

#### Scenario: Normal-size export gets 24-hour expiry

- **WHEN** the generated PDF is 2MB
- **THEN** expires_at is set to completed_at + 24 hours

#### Scenario: Large export gets 7-day expiry

- **WHEN** the generated PDF is 15MB
- **THEN** expires_at is set to completed_at + 7 days

#### Scenario: Storage path follows user-scoped prefix

- **WHEN** user abc-123 exports patient def-456 with export id ghi-789
- **THEN** the Storage key is `abc-123/def-456/ghi-789.pdf`

### Requirement: Psychologist can retrieve a signed URL for a ready export

The system SHALL provide a `getExportSignedUrl` Server Action that validates: the export exists, belongs to the requesting user, has status='ready', and has not expired (expires_at > now). The signed URL expiry MUST match the row's expires_at (not exceed it).

#### Scenario: Successful signed URL generation

- **WHEN** psychologist requests a signed URL for their own export with status='ready' and expires_at in the future
- **THEN** system returns a signed URL with expiry matching the row's expires_at

#### Scenario: Signed URL for non-ready export rejected

- **WHEN** psychologist requests a signed URL for an export with status='processing'
- **THEN** system rejects with NOT_READY error

#### Scenario: Signed URL for expired export rejected

- **WHEN** psychologist requests a signed URL for an export where expires_at < now()
- **THEN** system rejects with EXPIRED error

#### Scenario: Signed URL for another user's export rejected

- **WHEN** psychologist B requests a signed URL for an export owned by psychologist A
- **THEN** system rejects with NOT_FOUND (does not reveal existence)

### Requirement: Psychologist can list their exports

The system SHALL provide a `listProntuarioExports` Server Action returning the psychologist's exports in reverse chronological order, optionally filtered by patientId. Each entry includes: id, patient name, status, filters summary, file_size, created_at, completed_at, expires_at.

#### Scenario: List all exports across patients

- **WHEN** psychologist calls listProntuarioExports without patientId filter
- **THEN** all exports owned by the psychologist are returned, newest first

#### Scenario: List exports for a specific patient

- **WHEN** psychologist calls listProntuarioExports with patientId=X
- **THEN** only exports for patient X owned by the psychologist are returned

#### Scenario: Another psychologist's exports are never visible

- **WHEN** psychologist B calls listProntuarioExports
- **THEN** no exports owned by psychologist A appear in the results (enforced by RLS)

### Requirement: In-app notification and Realtime update on export completion

The system SHALL insert an in-app notification (via `notify()`) when an export completes (ready or failed). The Exportacoes page MUST subscribe to Supabase Realtime on `prontuario_exports` filtered by user_id to receive status transitions without polling. A Sonner toast MUST fire when status transitions to 'ready'.

#### Scenario: Export completes while user is on Exportacoes page

- **WHEN** the Inngest job marks an export as 'ready' and the psychologist has the Exportacoes page open
- **THEN** the export card updates to 'ready' status in real-time and a Sonner success toast appears with "Exportacao pronta. Clique para baixar."

#### Scenario: Export completes while user is elsewhere

- **WHEN** the Inngest job marks an export as 'ready' and the psychologist is on a different page
- **THEN** an in-app notification is created (visible in the notification area) with actionUrl pointing to the Exportacoes page

#### Scenario: Export fails notification

- **WHEN** the Inngest job marks an export as 'failed'
- **THEN** an in-app notification is created with type 'export_failed' and a Sonner error toast appears if the user is on the Exportacoes page

### Requirement: Email delivery with signed URL for large exports (>10MB)

The system SHALL send a transactional email (via Resend) when the generated PDF exceeds 10MB. The email MUST contain: subject "Sua exportacao de prontuario esta pronta", patient first name (no full name for email privacy), file size, expiry date, and a signed URL button. The email is sent to `filters.deliveryEmail` if provided, otherwise to the psychologist's account email.

#### Scenario: Large export triggers email with 7-day signed URL

- **WHEN** the Inngest job completes an export with file_size > 10MB
- **THEN** a transactional email is sent to the delivery email with a signed URL valid for 7 days

#### Scenario: Normal-size export does not trigger email

- **WHEN** the Inngest job completes an export with file_size <= 10MB
- **THEN** no email is sent; only the in-app notification and Realtime update are used

### Requirement: RLS isolates exports between psychologists

The system SHALL enforce Row Level Security on `prontuario_exports` with per-operation policies: SELECT and INSERT scoped to `user_id = auth.uid()`. No UPDATE or DELETE policies exist for the authenticated role — only service-role (Inngest job) can transition status.

#### Scenario: Psychologist A cannot see psychologist B's exports

- **WHEN** psychologist A queries prontuario_exports
- **THEN** only rows where user_id matches psychologist A's auth.uid() are returned

#### Scenario: Psychologist cannot update export status directly

- **WHEN** a psychologist attempts to UPDATE a prontuario_exports row via the authenticated role
- **THEN** the operation is denied (no UPDATE policy)

#### Scenario: Psychologist cannot delete exports

- **WHEN** a psychologist attempts to DELETE from prontuario_exports
- **THEN** the operation is denied (no DELETE policy)

### Requirement: Audit log entries for export request and completion

The system SHALL write audit_log entries for every export operation: `prontuario.export-request` on request (with metadata: filters, IP) and `prontuario.export-completed` on completion (with metadata: file_size, expires_at, delivery_method). Both entries reference the export row via resource_type='prontuario_export' and resource_id=exportId.

#### Scenario: Request creates audit entry

- **WHEN** requestProntuarioExport succeeds
- **THEN** an audit_log row is created with action='prontuario.export-request', resource_type='prontuario_export', resource_id=exportId, metadata containing filters and requesting IP

#### Scenario: Completion creates audit entry

- **WHEN** the Inngest job transitions an export to 'ready'
- **THEN** an audit_log row is created with action='prontuario.export-completed', metadata containing file_size, expires_at, and delivery_method ('in_app' or 'email')

### Requirement: Daily cron expires old exports and cleans Storage

The system SHALL run an Inngest cron function (`prontuario/expire-exports`) daily that: identifies exports with status='ready' and expires_at < now(), updates their status to 'expired', and deletes the corresponding Storage object. Failures to delete Storage objects MUST be logged but MUST NOT prevent the status update.

#### Scenario: Expired export transitions to 'expired' status

- **WHEN** an export has status='ready' and expires_at is in the past
- **THEN** the cron job updates status to 'expired'

#### Scenario: Storage object deletion failure is non-fatal

- **WHEN** Storage deletion fails for an expired export (e.g., object already deleted)
- **THEN** the status still transitions to 'expired' and the error is logged (without PII)

#### Scenario: Only 'ready' exports are eligible for expiry

- **WHEN** an export has status='failed' and its created_at is old
- **THEN** the cron does NOT touch it (only 'ready' exports expire)

### Requirement: Export modal provides filter controls with confirmation flow

The system SHALL present an Export Modal triggered by a "Exportar prontuario" button (Lucide `Download` icon) in the prontuario shell header. The modal MUST contain: info Alert about audit logging, DateRangePicker for date filtering, section checkbox list (all checked by default except personal notes which is unchecked and visually separated), personal notes toggle with destructive AlertDialog, optional email field, and "Gerar exportacao" primary button.

#### Scenario: Modal opens with default filter values

- **WHEN** psychologist clicks "Exportar prontuario" button
- **THEN** a modal opens with all sections checked, personal notes unchecked, date range set to "all time", and the email field empty

#### Scenario: Submission triggers export request and closes modal

- **WHEN** psychologist configures filters and clicks "Gerar exportacao"
- **THEN** the system calls requestProntuarioExport, shows a Sonner toast "Exportacao solicitada. Voce sera notificado quando estiver pronta.", and closes the modal

### Requirement: Exportacoes page displays export history with real-time status

The system SHALL render an Exportacoes sub-route at `/pacientes/[id]/prontuario/exportacoes` showing a list of the psychologist's exports for that patient. Each export is displayed as a Card with: created date, filters as Badges, status indicator (spinner for pending/processing, Download button for ready, disabled state for expired, retry option for failed). The page MUST subscribe to Realtime for live status updates.

#### Scenario: Export in processing state shows spinner

- **WHEN** an export has status='processing'
- **THEN** the Card shows a spinning indicator and text "Em processamento"

#### Scenario: Ready export shows download button

- **WHEN** an export has status='ready' and not expired
- **THEN** the Card shows a "Baixar" button that triggers getExportSignedUrl and initiates download

#### Scenario: Expired export shows disabled state

- **WHEN** an export has status='expired'
- **THEN** the Card shows "Expirado" badge and the download button is disabled

#### Scenario: Failed export shows retry option

- **WHEN** an export has status='failed'
- **THEN** the Card shows error state with "Solicitar novamente" button that opens the export modal pre-filled with the same filters

#### Scenario: Empty state when no exports exist

- **WHEN** no exports exist for the patient
- **THEN** the page shows an empty state with Download icon, h4 "Nenhuma exportacao ainda", description "Use o botao 'Exportar prontuario' para gerar um PDF completo."
