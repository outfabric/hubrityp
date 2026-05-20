## Context

This is change #7 (capstone) of the PRD 05 decomposition. It aggregates data produced by all six prior changes into a single PDF document. The prior changes have established:

- `evolutions` + `evolution_versions` tables with Tiptap-stored JSONB content (change #1)
- `audit_log` generic table with service-role write path (change #1)
- `diagnostic_hypotheses` with CID-10 codes and status lifecycle (change #2)
- `treatment_plans` + `treatment_plan_versions` with JSONB goals/phases (change #3)
- `scale_applications` with scoring and classification (change #4)
- `evolution_attachments` + `personal_notes` with Storage integration (change #5)
- `clinical_documents` with PDF generation via pdfkit in Inngest (change #6)
- Patient anamnesis with standard sections (archived spec `patient-anamnesis`)
- Notification helper `notify()` at `src/modules/notifications/server/notify.ts`
- Inngest client pattern at `src/modules/whatsapp/inngest/client.ts`

**Constraints:**
- pdfkit + svg-to-pdfkit confirmed by user (no Puppeteer, no headless Chrome)
- Charts rendered as hand-built SVG strings (no DOM, no Recharts at runtime in the job)
- Personal notes excluded by default (RN-05.03); explicit opt-in with double confirmation
- LGPD art. 18 + RN-05.05: this export is the mechanism for patient right-of-access
- RN-05.04: strict user_id isolation via RLS
- Supabase Storage in sa-east-1 (data residency)
- File expiry: 24h for normal exports, 7 days for >10MB (email delivery)

## Goals / Non-Goals

**Goals:**
- `prontuario_exports` table with status state machine and RLS
- Zod schema for export filters (dateRange, sections, includePersonalNotes, deliveryEmail)
- Server Actions: requestProntuarioExport, listProntuarioExports, getExportSignedUrl
- Inngest job: aggregate all prontuario data, apply filters, build structured PDF, upload to Storage
- Scale chart SVG builder (line chart from timeseries data, no DOM dependency)
- Inngest cron: daily expiry cleanup
- In-app Realtime subscription on export status changes
- Email delivery (via Resend through existing notification patterns) for large exports
- Export Modal UI with filter controls and personal notes double-confirmation
- Exportacoes page with status list and download buttons
- Audit log entries for request and completion
- Unit, integration, and E2E tests

**Non-Goals:**
- Patient-facing delivery (RN-05.05 export is for psychologist to hand off; separate sharing flow is future)
- Partial re-export (e.g., "re-export only evolutions section")
- Format other than PDF (no DOCX, no ZIP)
- Embedding full attachment binaries in the PDF (index/reference only — file size and re-encryption costs)
- Embedding full clinical document PDF bodies (reference-only table listing)
- ICP-Brasil digital signature on the export PDF
- Custom cover-page branding
- Streaming PDF download (file must be fully generated before access)

## Decisions

### 1. pdfkit + svg-to-pdfkit over Puppeteer/headless Chrome

pdfkit generates PDFs programmatically without a browser runtime. Combined with svg-to-pdfkit for chart embedding, this provides:
- No heavy dependency (Chrome binary ~300MB)
- Deterministic output (no CSS rendering differences)
- Fast generation (no browser boot latency)
- Works in serverless (Inngest runs on Vercel functions)
- Lower memory footprint

**Alternative considered:** Puppeteer rendering an HTML template.
**Rejected because:** Puppeteer adds ~300MB Chrome dependency, requires special serverless handling (chrome-aws-lambda or similar), has non-deterministic layout, and is orders of magnitude slower for structured documents.

### 2. Per-export row (state machine) over ad-hoc on-demand generation

Each export request creates a `prontuario_exports` row that tracks status through `pending -> processing -> ready -> expired|failed`. Benefits:
- **Observability:** Dashboard shows all exports with status, timing, file size
- **Retry:** Failed exports can be retried without re-submitting the form
- **Audit:** Every export attempt is recorded (regulatory requirement)
- **Reuse:** If an identical export was recently generated and not expired, future optimization could return the cached file
- **Rate limiting:** Can limit concurrent exports per user by counting `pending`/`processing` rows

**Alternative considered:** Generate on-demand and return a temporary signed URL immediately.
**Rejected because:** Large prontuarios (100+ evolutions, multiple scales with charts) can take 10-30s to generate — too long for a synchronous request. The async pattern with status tracking matches the PRD §8 edge case requirement ("Gerar em background, enviar por email com link seguro").

### 3. Scale chart SVG built by hand (no Recharts/DOM at runtime)

The Inngest job runs in a serverless Node.js environment without a DOM. Recharts requires React DOM rendering. Instead, a pure-function SVG builder at `src/modules/medical-records/lib/exports/scale-chart-svg.ts` takes `Array<{ date: string; score: number }>` and produces a valid `<svg>` string with:
- Axes (X: dates, Y: score range)
- Line path connecting data points
- Dots at each data point
- Optional horizontal threshold lines (classification boundaries)
- Configurable dimensions (default 500x200 for PDF embedding)

The SVG is then embedded into the PDF via `svg-to-pdfkit`.

**Alternative considered:** Use `@react-pdf/renderer` which supports React components.
**Rejected because:** It introduces a parallel PDF rendering engine (react-pdf vs pdfkit), cannot reuse the PDF section builders from change #6 (clinical documents already use pdfkit), and has its own SVG limitations.

### 4. Attachments and clinical documents as index only (not embedded)

The export PDF lists attachments and clinical documents as reference tables (filename, type, date, size) without embedding the actual binary content. Reasons:
- File size: embedding 20 attachments at 10MB each = 200MB PDF (impractical)
- Re-encryption: Storage files have their own signed-URL access; embedding would require downloading and re-encoding each one
- Clinical documents already have their own PDFs — embedding would duplicate content
- The PRD explicitly says "apenas referencia, nao embute todos" (RF-05.32)

### 5. Expiry strategy: 24h default, 7 days for email delivery

Normal exports are accessed immediately via the in-app Downloads area and Realtime notification. A 24-hour expiry balances accessibility with storage cost and security (shorter windows reduce exposure if a URL leaks).

For exports >10MB, the psychologist receives an email with a signed URL. Email delivery adds latency (inbox delays, mobile access) so the expiry extends to 7 days. The `expires_at` is computed at completion time based on `file_size`.

### 6. Realtime subscription for status updates (not polling)

The Exportacoes page subscribes to `prontuario_exports` changes filtered by `user_id` using Supabase Realtime. When the Inngest job updates status to `ready` (or `failed`), the client receives the update immediately without polling. Additionally, a Sonner toast fires on transition to `ready`.

This requires that the Inngest job (service-role) performs the UPDATE on the actual table (not a function/RPC), since Realtime hooks into WAL changes on the table itself.

### 7. Personal notes double-confirmation via AlertDialog

Personal notes are excluded by default (RN-05.03). To include them, the user must:
1. Toggle the "Incluir notas pessoais" switch in the Export Modal
2. An AlertDialog appears requiring the user to type "INCLUIR" to confirm
3. Only after typing the exact string and clicking "Confirmar" does the toggle activate

This mirrors the destructive-confirmation pattern from the design system (`rules.md` "Confirmacao destrutiva") adapted for a privacy-sensitive opt-in rather than a deletion. The UX copy makes consequences explicit: "Notas pessoais sao de uso exclusivo do(a) psicologo(a) e nao devem ser entregues ao paciente."

### 8. Storage bucket layout and policies

Bucket: `prontuario-exports` (private, no public access)
Key pattern: `${user_id}/${patient_id}/${exportId}.pdf`

Storage policies (INSERT + SELECT scoped by user_id prefix):
```sql
-- INSERT: user can upload to their own prefix
CREATE POLICY "owner_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'prontuario-exports' AND (storage.foldername(name))[1] = auth.uid()::text);

-- SELECT: user can read from their own prefix
CREATE POLICY "owner_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'prontuario-exports' AND (storage.foldername(name))[1] = auth.uid()::text);

-- No UPDATE/DELETE for authenticated users — managed by service-role cron
```

The Inngest job uses service-role to upload (bypasses the INSERT policy) since it runs outside user context. The signed URL generation uses the authenticated client (respects SELECT policy).

### 9. Aggregation strategy and data fetching in the Inngest job

The job fetches data in steps for resilience (each step is independently retryable):

```
Step 1: "update-status" → SET status='processing'
Step 2: "fetch-patient"  → patient demographics (name, DOB, contact, treatment start)
Step 3: "fetch-anamnesis" → full anamnesis content (all standard sections + custom)
Step 4: "fetch-evolutions" → paginated evolutions with versions (apply dateRange filter)
Step 5: "fetch-hypotheses" → diagnostic_hypotheses list
Step 6: "fetch-treatment-plan" → current plan + version_count
Step 7: "fetch-scales" → scale_applications grouped by scale_key (apply dateRange filter)
Step 8: "fetch-documents" → clinical_documents metadata (NOT pdf bodies)
Step 9: "fetch-attachments" → evolution_attachments metadata
Step 10: "fetch-personal-notes" → ONLY if filters.includePersonalNotes=true
Step 11: "build-pdf" → construct PDF via pdfkit section builders
Step 12: "upload" → upload to Storage, get file_size
Step 13: "complete" → update row (status='ready', storage_path, file_size, expires_at, completed_at)
Step 14: "notify" → if file_size > 10MB: send email; always: insert in-app notification
Step 15: "audit-complete" → audit_log row (action='prontuario.export-completed')
```

Each fetch step uses the service-role Drizzle client (the Inngest job runs outside user session context) but scopes queries by `user_id` from the export row. This is safe because:
- The export row's `user_id` was set from `auth.getUser()` at request time (Server Action)
- The job reads the `user_id` from the row it owns (the `exportId` is the only input)
- No user-supplied ID reaches the aggregation queries

### 10. PDF section builders (pure functions)

Each prontuario section maps to a builder function:

```
src/modules/medical-records/lib/exports/
  scale-chart-svg.ts        — (data) => SVG string
  pdf-builder.ts            — orchestrator: creates doc, calls section builders
  sections/
    cover-page.ts           — patient ID, psychologist info, export metadata
    anamnesis-section.ts    — renders anamnesis standard sections
    evolutions-section.ts   — chronological by month, template-aware rendering
    hypotheses-section.ts   — table with CID-10, description, status, date
    treatment-plan-section.ts — goals list, phases, resources, criteria
    scales-section.ts       — per-scale: data table + embedded SVG chart
    documents-section.ts    — reference table (type, title, status, date)
    attachments-section.ts  — reference table with category summary
    personal-notes-section.ts — content with prominent warning header
    footer.ts               — "Pagina X de Y • Documento sigiloso — Salvia • Gerado em {timestamp}"
```

Each builder receives a `PDFKit.PDFDocument` instance and the relevant data, appending pages as needed. The orchestrator calls them in order and handles page numbering via pdfkit's page event.

### 11. Email delivery for large exports

When `file_size > 10_000_000` (10MB), the job enqueues a transactional email via Resend (same pattern as existing email notifications in the codebase). The email contains:
- Subject: "Sua exportacao de prontuario esta pronta"
- Body: patient name (first name only for privacy), file size, expiry date, signed URL button
- The signed URL has 7-day expiry (vs 24h for in-app)

The email is sent to `filters.deliveryEmail` (if provided) or the psychologist's account email.

**Service-role justification:** The Inngest job uses service-role to generate the signed URL with custom expiry (7 days). This is acceptable because: (1) the job already runs with service-role for the entire aggregation, (2) the URL is scoped to the specific file, (3) the URL has bounded expiry, (4) the recipient is verified (psychologist's own email or explicitly provided alternative).

## Drizzle Table DDL

```typescript
// Addition to src/shared/db/schema/medical-records/tables.ts

export const prontuarioExports = pgTable('prontuario_exports', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),              // FK auth.users
  patientId: uuid('patient_id').notNull(),        // FK patients(id)
  status: text('status').notNull().default('pending'), // CHECK in ('pending','processing','ready','failed','expired')
  filters: jsonb('filters').notNull(),            // ExportFiltersSchema
  storagePath: text('storage_path'),              // set on completion
  fileSize: bigint('file_size', { mode: 'number' }), // bytes, set on completion
  errorMessage: text('error_message'),            // set on failure (sanitized, no PII)
  expiresAt: timestamp('expires_at', { withTimezone: true }), // set on completion
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => [
  index('idx_prontuario_exports_user_created').on(table.userId, table.createdAt),
  index('idx_prontuario_exports_status_expires').on(table.status, table.expiresAt),
  // CHECK constraint added in raw SQL in migration
]);
```

## RLS Policies

```sql
ALTER TABLE prontuario_exports ENABLE ROW LEVEL SECURITY;

-- SELECT: owner can view their own exports
CREATE POLICY "owner can select prontuario_exports" ON prontuario_exports
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- INSERT: owner can create exports for themselves
CREATE POLICY "owner can insert prontuario_exports" ON prontuario_exports
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- No UPDATE policy for authenticated role — only service-role (Inngest job) updates status
-- No DELETE policy — exports expire naturally; cleanup is via service-role cron
```

## Filters Zod Schema

```typescript
// src/modules/medical-records/lib/exports/export-schemas.ts

import { z } from 'zod';

export const exportSectionsSchema = z.object({
  anamnese: z.boolean().default(true),
  evolucoes: z.boolean().default(true),
  hipoteses: z.boolean().default(true),
  planoTerapeutico: z.boolean().default(true),
  escalas: z.boolean().default(true),
  documentos: z.boolean().default(true),
  anexosIndex: z.boolean().default(true),
});

export const exportFiltersSchema = z.object({
  dateRange: z.object({
    from: z.string().datetime().nullable().default(null),
    to: z.string().datetime().nullable().default(null),
  }).default({ from: null, to: null }),
  sections: exportSectionsSchema.default({}),
  includePersonalNotes: z.boolean().default(false),
  deliveryEmail: z.string().email().optional(),
});

export type ExportFilters = z.infer<typeof exportFiltersSchema>;
export type ExportSections = z.infer<typeof exportSectionsSchema>;
```

## Inngest Job Idempotency and Retry Behavior

- **Idempotency:** The function uses `id: 'prontuario/export-pdf-${event.data.exportId}'` ensuring only one execution per export row. If the same event is re-delivered, Inngest deduplicates.
- **Retry:** Each step has automatic retry (Inngest default: 3 retries with exponential backoff). If all retries fail for a step, the function marks the export as `failed` with a sanitized error message.
- **Timeout:** Function-level timeout of 5 minutes (generous for large prontuarios).
- **Concurrency:** Limited to 5 concurrent executions per account (prevents Storage/DB overload during bulk exports).

## Inngest Cron: expire-exports

Runs daily at 03:00 UTC-3 (06:00 UTC). Logic:
1. SELECT rows WHERE `status = 'ready' AND expires_at < now()`
2. For each: UPDATE status to 'expired'
3. Optionally: DELETE the Storage object (saves cost; the row remains for audit)
4. Log count of expired exports (structured, no PII)

Uses service-role for both the UPDATE and Storage deletion.

## Risks / Trade-offs

- **[Large PDF generation time]** A prontuario with 200+ evolutions, 10 scales with charts, and extensive anamnesis could take 30-60s to generate. Mitigation: Inngest function timeout is set to 5 minutes; step-based architecture allows partial retry without re-fetching all data; pdfkit streams pages without holding entire PDF in memory.
- **[svg-to-pdfkit compatibility]** The `svg-to-pdfkit` library has known limitations with complex SVG features (filters, masks, transforms). Mitigation: The scale chart SVG builder outputs only simple elements (rect, line, circle, text, path) that are well-supported. Snapshot tests verify output.
- **[Storage cost for expired exports]** Exports that remain in Storage after expiry consume space. Mitigation: The cron job deletes Storage objects on expiry. If deletion fails, it logs and retries on the next daily run.
- **[Realtime subscription on large table]** As `prontuario_exports` grows, the Realtime subscription must be filtered correctly to avoid receiving other users' updates. Mitigation: Subscribe with filter `user_id=eq.${currentUserId}` — Supabase Realtime supports column equality filters. RLS also applies to Realtime channels.
- **[Email deliverability]** Signed URL in email could be flagged by spam filters (long URL, unfamiliar domain). Mitigation: Use Resend (good deliverability reputation), keep email body clean and minimal, add text fallback with copy-paste URL.
- **[JSONB content rendering]** Evolution content is template-specific JSONB. The PDF builder must handle all template types (TCC, psicanalise, sistemica, aba, livre, custom). Mitigation: Each template type has a rendering branch in `evolutions-section.ts`; unknown template types fall back to JSON-pretty-print (defensive). Unit tests cover all known templates.

## Migration Plan

1. Generate Drizzle migration for `prontuario_exports` table
2. Append RLS SQL + CHECK constraint to the generated migration file
3. Create Storage bucket `prontuario-exports` via Supabase dashboard or migration SQL
4. Append Storage policies to migration
5. Run `npm run db:migrate` locally
6. Register Inngest functions in the serve handler
7. Deploy: migration runs automatically; Inngest functions picked up on deploy
8. Rollback: table is new (additive) — drop table reverts. Storage bucket can be emptied and deleted.

## Open Questions

(none — all decisions are locked per user direction)
