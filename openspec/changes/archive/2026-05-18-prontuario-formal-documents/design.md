## Context

This is change #6 of the PRD 05 (Prontuário Eletrônico) decomposition. The foundation change established the `medical-records` module, `audit_log` table, and prontuario shell page with tabs. Change #2 added CID-10 search (`src/modules/medical-records/lib/cid10-search.ts`) and the `Cid10Combobox` component. Change #5 established the Supabase Storage pattern with private buckets and user-prefix-scoped policies (`patient-attachments` bucket).

This change implements the "Documentos" tab — formal clinical documents as defined by Resolução CFP 06/2019. The psychologist authors structured documents (declaração, atestado, relatório, laudo, parecer) through per-section editors, finalizes them (triggering PDF generation), and downloads the result. Finalized documents are immutable legal artifacts; any amendment requires creating a new document (clone-as-new pattern).

**Current state:**
- Module: `src/modules/medical-records/` with lib/, server/, components/, inngest/
- Schema domain: `src/shared/db/schema/medical-records/` (tables + policies + index barrel)
- `logProntuarioAccess` function: writes to `audit_log` via service-role
- `Cid10Combobox`: reusable component from change #2
- `useAutoSave` hook: from `src/modules/patients/lib/use-auto-save.ts`
- `generateConsentPdf`: existing pdfkit pattern at `src/modules/patients/lib/generate-consent-pdf.ts`
- Inngest client pattern: per-module `inngest/client.ts` with typed events (see `src/modules/whatsapp/inngest/client.ts`)
- Storage signed URL pattern: `src/modules/patients/server/get-patient-photo-url.ts` with 5-min expiry

**Constraints:**
- CFP 06/2019: mandatory structure for each document type (identification, demand, procedures, analysis, conclusion, signature)
- RN-05.04: strict user_id isolation via RLS
- RN-05.06: CID-10 codes in documents require explicit patient consent (server-side validation, not UI-only)
- LGPD art. 11: sensitive health data; signed URL 5-min expiry; private Storage bucket
- Lei 13.787/2018: 20-year retention; no DELETE; finalized docs never overwritten
- pdfkit 0.18.0 already installed — no new dependencies needed
- ICP-Brasil signing: placeholder only (out of scope for MVP)

## Goals / Non-Goals

**Goals:**
- `clinical_documents` table with full RLS + finalized-update protection
- Discriminated Zod schemas per document type (type-specific required fields)
- Server Actions for complete CRUD + finalize + CID-10 consent gate
- Inngest job for async PDF generation (pdfkit, CFP-compliant layout)
- Private Storage bucket `clinical-documents` with user-prefix policies
- Signed URL access with 5-min expiry and audit logging
- Frontend: document type selector, structured editor, finalize modal, read-only viewer, PDF download
- Audit log on every operation
- ICP-Brasil disabled placeholder

**Non-Goals:**
- ICP-Brasil actual digital signing (placeholder only — future change)
- AI-assisted document drafting (PRD 10 — a hook/placeholder for the button is acceptable but not functional)
- Bulk document generation
- Sharing documents via secure link to third parties
- Document templates (the structure is per-type from CFP 06/2019, not user-customizable)
- PDF/A compliance (standard PDF is acceptable)

## Decisions

### 1. pdfkit over Puppeteer/Chromium for PDF generation

pdfkit generates PDFs programmatically without a browser runtime. Puppeteer would require a Chromium binary (~400MB), making serverless deployment (Vercel) impractical and adding cold-start latency.

**Alternative considered:** Puppeteer with headless Chromium rendering HTML to PDF.
**Rejected because:** Binary size incompatible with serverless; cold start unacceptable (~3s); pdfkit is already installed and proven in the consent-PDF flow; direct API gives precise layout control for regulatory requirements (page numbering, signature block positioning).

### 2. Clone-as-new over addendum for finalized documents

Once a document is finalized (PDF generated, stored), the row is immutable. If the psychologist needs to change something, they create a new document (optionally cloned from the finalized content). There is no "v2 of the same document" — each row is a distinct legal artifact.

**Rationale:** CFP 06/2019 treats each issued document as a standalone legal artifact. An "addendum" pattern (used for evolutions per RN-05.02) is inappropriate here because formal documents are delivered to external parties (courts, insurance companies, schools). Once delivered, they cannot be retroactively amended — only superseded by a new document.

**Alternative considered:** Addendum pattern (append corrections to same row).
**Rejected because:** Formal documents have external recipients who hold the original. A new document with a new date is the correct legal approach per CFP orientation.

### 3. Per-type discriminated Zod schemas (not one-size-fits-all)

Each document type has different mandatory sections. A declaração is brief (may lack analise); a laudo requires extensive analise. Using a discriminated union with `document_type` as discriminator enables type-specific validation while sharing common fields.

**Schema design:**
```typescript
const baseContentSchema = z.object({
  solicitante: z.string().min(1),
  psychologistInfo: z.object({ name: z.string(), crp: z.string(), contact: z.string().optional() }),
  demanda: z.string().min(1),
  procedimentos: z.string().min(1),
  conclusao: z.string().min(1),
  localData: z.object({ local: z.string(), data: z.string() }),
  cid10Codes: z.array(z.object({ code: z.string(), description: z.string() })).optional().default([]),
});

const laudoContentSchema = baseContentSchema.extend({
  analise: z.string().min(1), // mandatory for laudo
});

const declaracaoContentSchema = baseContentSchema.extend({
  analise: z.string().optional(), // optional for declaração
});
```

**Alternative considered:** Single schema with all fields optional + runtime validation per type.
**Rejected because:** Loses compile-time type safety; makes it trivial to finalize a laudo without the legally required "analise" section. Discriminated unions provide compile-time guarantees.

### 4. Finalized-row update protection via RLS USING clause

The UPDATE policy on `clinical_documents` includes a condition that excludes finalized rows:

```sql
CREATE POLICY "owner can update draft documents" ON clinical_documents
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND status = 'draft')
  WITH CHECK (auth.uid() = user_id);
```

This means any UPDATE on a row where `status = 'finalized'` silently returns 0 rows affected. The server action also validates at the application layer (returning 409 Conflict), but the RLS policy is the last-line-of-defense against IDOR or code bugs.

**Exception:** The Inngest job needs to update the row after PDF generation (set `pdf_storage_path`, `pdf_size`). This uses service-role (bypasses RLS). A justifying comment documents this.

**Alternative considered:** Application-layer-only enforcement (no RLS USING clause).
**Rejected because:** Defense-in-depth principle. If a code path accidentally allows an update to a finalized row (e.g., a missed status check), the RLS layer blocks it. Belt and suspenders.

### 5. Inngest job with step-based execution for idempotency

The `documents/generate-pdf` Inngest function uses `step.run()` for each discrete operation (read row, build PDF, upload, update row). If the function retries (network failure, timeout), already-completed steps are skipped.

**Idempotency strategy:**
- The event carries `documentId` as the idempotency key
- The first step checks if `pdf_storage_path` is already set — if yes, returns early (PDF already generated)
- Each step is individually retryable without side effects on previously completed work

```typescript
export const generateDocumentPdf = inngest.createFunction(
  {
    id: 'documents/generate-pdf',
    idempotency: 'event.data.documentId',
  },
  { event: 'documents/pdf.requested' },
  async ({ event, step }) => {
    const document = await step.run('read-document', async () => { /* ... */ });
    if (document.pdfStoragePath) return { status: 'already_generated' };
    const pdfBuffer = await step.run('build-pdf', async () => { /* ... */ });
    const storagePath = await step.run('upload-to-storage', async () => { /* ... */ });
    await step.run('update-document-row', async () => { /* ... */ });
    await step.run('write-audit-log', async () => { /* ... */ });
  }
);
```

### 6. Storage bucket `clinical-documents` with user-prefix policies

Mirrors the `patient-attachments` bucket from change #5. Path convention: `${user_id}/${patient_id}/${documentId}.pdf`.

```sql
-- Bucket: clinical-documents (private, no public access)
CREATE POLICY "user can upload own clinical documents"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'clinical-documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "user can read own clinical documents"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'clinical-documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- No DELETE or UPDATE policy (immutable once uploaded; retention mandate)
```

### 7. CID-10 consent gate — server-side enforcement

When `finalizeDocument` is called, the server checks if `content.cid10Codes` has any entries. If yes, `references_cid10` is computed as `true` and the caller MUST pass `cid10ConsentConfirmed: true`. If not, the action rejects with code `CID10_CONSENT_REQUIRED`.

This is NOT a UI-only check. Even if the frontend fails to enforce it (or is bypassed), the server-side validation prevents finalization without consent. Per RN-05.06, CID-10 in formal documents requires explicit patient consent due to sigilo profissional.

**Alternative considered:** Store consent as a separate `consent_terms` row.
**Rejected because:** The consent here is document-specific (the patient consents to CID-10 appearing in THIS specific document), not a standing consent. A boolean on the document row (`cid10_consent_confirmed`) captures the fact adequately. The audit log records when it was confirmed.

### 8. Auto-save for drafts with debounced server action

The editor auto-saves every 10 seconds (same pattern as evolutions). Only drafts can be auto-saved. The `updateDocument` action validates `status = 'draft'` before persisting. The `useAutoSave` hook from `@/modules/patients/lib/use-auto-save.ts` is reused.

### 9. Psychologist info snapshot at document creation

When `createDocument` is called, the psychologist's current name, CRP, and optional contact info are snapshotted into `content.psychologistInfo`. This ensures the PDF reflects the psychologist's identity at the time of document creation, even if they later update their profile.

**Alternative considered:** Read psychologist info at PDF generation time.
**Rejected because:** If the psychologist changes their profile between creation and finalization (unlikely but possible), the document content would be inconsistent with what they reviewed. The snapshot-at-creation approach ensures WYSIWYG fidelity.

## Drizzle Table DDL

```typescript
// Addition to src/shared/db/schema/medical-records/tables.ts

export const clinicalDocuments = pgTable('clinical_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),             // FK auth.users — direct for RLS
  patientId: uuid('patient_id').notNull(),       // FK patients(id)
  documentType: text('document_type').notNull(), // CHECK: 'declaracao'|'atestado'|'relatorio'|'laudo'|'parecer'
  title: text('title').notNull(),
  content: jsonb('content').notNull(),           // Per-type structured JSONB (see Zod schemas)
  pdfStoragePath: text('pdf_storage_path'),      // Set by Inngest job after generation
  pdfSize: bigint('pdf_size', { mode: 'number' }), // bytes
  digitallySigned: boolean('digitally_signed').notNull().default(false),
  signatureMethod: text('signature_method'),     // CHECK: 'icp_brasil'|'physical' (nullable)
  status: text('status').notNull().default('draft'), // CHECK: 'draft'|'finalized'
  referencesCid10: boolean('references_cid10').notNull().default(false),
  cid10ConsentConfirmed: boolean('cid10_consent_confirmed').notNull().default(false),
  finalizedAt: timestamp('finalized_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
}, (table) => [
  index('idx_clinical_documents_patient_type_created')
    .on(table.patientId, table.documentType, table.createdAt),
  index('idx_clinical_documents_status_finalized')
    .on(table.status, table.finalizedAt),
  index('idx_clinical_documents_user_id')
    .on(table.userId), // For RLS predicate performance
]);
```

## RLS Policies (SQL appended to migration)

```sql
ALTER TABLE clinical_documents ENABLE ROW LEVEL SECURITY;

-- SELECT: owner only
CREATE POLICY "owner can select clinical_documents" ON clinical_documents
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- INSERT: owner only (user_id must match caller)
CREATE POLICY "owner can insert clinical_documents" ON clinical_documents
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- UPDATE: owner only AND only draft documents
-- Finalized documents cannot be updated via authenticated role.
-- The Inngest job uses service-role to set pdf_storage_path after generation.
CREATE POLICY "owner can update draft clinical_documents" ON clinical_documents
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND status = 'draft')
  WITH CHECK (auth.uid() = user_id);

-- No DELETE policy — retention mandate (Lei 13.787/2018, 20 years)

-- CHECK constraints
ALTER TABLE clinical_documents
  ADD CONSTRAINT chk_clinical_document_type
  CHECK (document_type IN ('declaracao', 'atestado', 'relatorio', 'laudo', 'parecer'));

ALTER TABLE clinical_documents
  ADD CONSTRAINT chk_clinical_document_status
  CHECK (status IN ('draft', 'finalized'));

ALTER TABLE clinical_documents
  ADD CONSTRAINT chk_clinical_document_signature_method
  CHECK (signature_method IS NULL OR signature_method IN ('icp_brasil', 'physical'));
```

## Content JSONB Shapes Per Document Type

```typescript
// Base fields (shared by all types)
interface BaseDocumentContent {
  solicitante: string;          // Who requested the document
  psychologistInfo: {           // Snapshot at creation
    name: string;
    crp: string;
    contact?: string;
  };
  demanda: string;              // Description of the demand
  procedimentos: string;        // Procedures used (Tiptap HTML)
  conclusao: string;            // Conclusion (Tiptap HTML)
  localData: {
    local: string;              // e.g. "São Paulo, SP"
    data: string;               // e.g. "16 de maio de 2026"
  };
  cid10Codes: Array<{ code: string; description: string }>; // Optional CID-10 references
}

// Declaração: brief, analise optional
interface DeclaracaoContent extends BaseDocumentContent {
  analise?: string;
}

// Atestado: includes period/validity
interface AtestadoContent extends BaseDocumentContent {
  analise?: string;
  period?: string;              // e.g. "3 dias" or "16/05/2026 a 19/05/2026"
  validity?: string;            // e.g. "30 dias"
}

// Relatório: full structure, analise mandatory
interface RelatorioContent extends BaseDocumentContent {
  analise: string;              // Mandatory
}

// Laudo psicológico: full structure, extensive analise mandatory
interface LaudoContent extends BaseDocumentContent {
  analise: string;              // Mandatory, typically longer
}

// Parecer: full structure, analise mandatory
interface ParecerContent extends BaseDocumentContent {
  analise: string;              // Mandatory
}
```

## PDF Builder Structure

The PDF builder follows the existing `generateConsentPdf` pattern — a pure async function returning a `Buffer`, no DB/Supabase dependencies.

```typescript
// src/modules/medical-records/lib/pdf/build-clinical-document-pdf.ts

export async function buildClinicalDocumentPdf(input: ClinicalDocumentPdfInput): Promise<Buffer> {
  // Uses pdfkit with bufferPages: true for page numbering
  const doc = new PDFDocument({
    size: 'A4',
    margin: 60,
    bufferPages: true,
    info: { Title: input.title, Author: input.psychologistInfo.name },
  });

  // 1. Header: psychologist name, CRP, contact
  buildHeader(doc, input.psychologistInfo);

  // 2. Title: document type label + title
  buildTitle(doc, input.documentType, input.title);

  // 3. Body sections (each as labeled paragraph)
  buildSection(doc, 'Solicitante', input.content.solicitante);
  buildSection(doc, 'Descrição da Demanda', input.content.demanda);
  buildSection(doc, 'Procedimento(s)', input.content.procedimentos);
  if (input.content.analise) {
    buildSection(doc, 'Análise', input.content.analise);
  }
  buildSection(doc, 'Conclusão', input.content.conclusao);

  // 4. CID-10 codes (if any)
  if (input.content.cid10Codes?.length) {
    buildCid10Section(doc, input.content.cid10Codes);
  }

  // 5. Local and date
  buildLocalData(doc, input.content.localData);

  // 6. Signature block
  buildSignatureBlock(doc, input.psychologistInfo.crp);

  // 7. Post-processing: page numbering + watermark
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    addPageNumber(doc, i + 1, range.count);
    addWatermark(doc);
  }

  doc.end();
  return collectBuffer(doc);
}
```

**Helper functions (pure, individually testable):**
- `buildHeader(doc, info)` — psychologist identification block
- `buildTitle(doc, type, title)` — document type label + title
- `buildSection(doc, label, htmlContent)` — strips Tiptap HTML to plain text runs (or uses a minimal HTML-to-text converter for bold/italic/lists)
- `buildCid10Section(doc, codes)` — renders CID-10 codes as a labeled list
- `buildLocalData(doc, localData)` — local and date line
- `buildSignatureBlock(doc, crp)` — signature line + "Assinatura — ICP-Brasil ou manuscrita + carimbo CRP {crp}"
- `addPageNumber(doc, current, total)` — "Página X de Y" centered at footer
- `addWatermark(doc)` — diagonal "DOCUMENTO PSICOLÓGICO" in light gray, 11% opacity, rotated 45 degrees
- `collectBuffer(doc)` — promise wrapper collecting chunks

## Inngest Job Sequence

```
Event: 'documents/pdf.requested' { documentId: string }
       │
       ▼
Step 1: read-document
       │  Fetch clinical_documents row via service-role (bypass RLS)
       │  If pdf_storage_path already set → return early (idempotent)
       ▼
Step 2: build-pdf
       │  Call buildClinicalDocumentPdf(row) → Buffer
       ▼
Step 3: upload-to-storage
       │  Upload to bucket 'clinical-documents'
       │  Path: ${user_id}/${patient_id}/${documentId}.pdf
       │  Use service-role Storage client
       ▼
Step 4: update-document-row
       │  SET pdf_storage_path, pdf_size on the row (service-role, justified)
       ▼
Step 5: write-audit-log
       │  logProntuarioAccess({ action: 'document.pdf-generated', resourceType: 'clinical_document', resourceId })
       ▼
Done
```

## Server Action Signatures

```typescript
// src/modules/medical-records/server/clinical-documents.ts

// createDocument
input: { patientId: string; documentType: DocumentType; title?: string; initialContent?: Partial<BaseDocumentContent> }
output: { ok: true; id: string } | { ok: false; code: 'UNAUTHORIZED' | 'VALIDATION_ERROR' }
// Side-effect: snapshots psychologistInfo, writes audit_log 'document.create'

// updateDocument
input: { documentId: string; content: DocumentContent; title?: string }
output: { ok: true } | { ok: false; code: 'UNAUTHORIZED' | 'NOT_FOUND' | 'ALREADY_FINALIZED' }
// Side-effect: writes audit_log 'document.update'. Returns 409-equivalent if status='finalized'

// finalizeDocument
input: { documentId: string; cid10ConsentConfirmed?: boolean }
output: { ok: true } | { ok: false; code: 'UNAUTHORIZED' | 'NOT_FOUND' | 'ALREADY_FINALIZED' | 'CID10_CONSENT_REQUIRED' | 'VALIDATION_ERROR' }
// Side-effect: validates required sections per type, checks CID-10 consent if needed,
//   sets status='finalized' + finalized_at=now(), enqueues 'documents/pdf.requested' event,
//   writes audit_log 'document.finalize'

// listDocumentsByPatient
input: { patientId: string; filters?: { type?: DocumentType; status?: 'draft' | 'finalized' } }
output: { documents: DocumentSummary[] }
// Side-effect: writes audit_log 'document.list'

// getDocumentDetail
input: { documentId: string }
output: { ok: true; document: DocumentFull } | { ok: false; code: 'NOT_FOUND' | 'UNAUTHORIZED' }
// Side-effect: writes audit_log 'document.view'

// getDocumentPdfUrl
input: { documentId: string }
output: { ok: true; signedUrl: string; expiresIn: 300 } | { ok: false; code: 'NOT_FOUND' | 'UNAUTHORIZED' | 'PDF_NOT_READY' }
// Side-effect: writes audit_log 'document.pdf-download'
```

## Module File Additions

```
src/modules/medical-records/
  lib/
    schemas/
      clinical-documents.ts       # Discriminated Zod schemas per document type
    pdf/
      build-clinical-document-pdf.ts  # Pure PDF builder (pdfkit)
      pdf-helpers.ts                  # buildHeader, buildSection, addPageNumber, addWatermark, etc.
      html-to-text.ts                 # Minimal Tiptap HTML → plain text for PDF rendering
  server/
    clinical-documents.ts           # All Server Actions (create, update, finalize, list, detail, pdfUrl)
  inngest/
    client.ts                       # Inngest client + event types for documents module
    generate-document-pdf.ts        # Inngest function: documents/generate-pdf
  components/
    documents-tab.tsx               # Tab content: list + filters + new doc button
    document-type-selector.tsx      # 5-card grid for selecting document type
    document-editor.tsx             # Structured editor with per-section Tiptap instances
    document-viewer.tsx             # Read-only rendering + PDF download for finalized docs
    document-card.tsx               # List item card with type icon, status badge, actions
    finalize-modal.tsx              # Destructive confirmation + CID-10 consent checkbox
    documents-empty-state.tsx       # Salvia empty state for no documents
```

## UI Component Tree

```
/pacientes/[id]/prontuario — Tab "Documentos" (replaces EmptyTabPlaceholder)
  └─ DocumentsTab (inline in tab)
       ├─ Header: h3 "Documentos clinicos", Button primary [FilePlus2] "Novo documento"
       ├─ Filters: Select (type), Badge filter (status: all/draft/finalized)
       ├─ DocumentsList
       │    └─ DocumentCard[]
       │         ├─ Icon (per-type mapping), title, created date
       │         ├─ Badge status (neutral='Rascunho', success='Finalizado')
       │         └─ Actions: "Editar" (draft) / "Visualizar" (finalized) / "Baixar PDF" (finalized+ready)
       └─ DocumentsEmptyState (when no documents)

/pacientes/[id]/prontuario/documentos/novo/page.tsx
  └─ DocumentTypeSelector
       ├─ 2-col grid (1-col mobile) of 5 Cards
       │    ├─ FileText + "Declaração" + "Para declarar comparecimento ou acompanhamento"
       │    ├─ Stamp + "Atestado" + "Para atestar condição ou ausência"
       │    ├─ ClipboardList + "Relatório" + "Relato descritivo de acompanhamento"
       │    ├─ BookOpen + "Laudo psicológico" + "Avaliação técnica fundamentada"
       │    └─ FileSignature + "Parecer" + "Opinião técnica sobre questão específica"
       └─ On select → createDocument() → navigate to editor

/pacientes/[id]/prontuario/documentos/[docId]/page.tsx
  ├─ [status=draft] DocumentEditor
  │    ├─ Header: title input, status Badge "Rascunho", Button primary "Finalizar e gerar PDF"
  │    │          Button link "Salvar rascunho", disabled Button "Assinar com e-CPF" + Badge "Em breve"
  │    ├─ Sections (scroll or tabs): Solicitante, Demanda, Procedimentos, Análise, Conclusão, Local e Data, CID-10
  │    │    └─ Each: label + Tiptap editor instance (reuse config from evolutions)
  │    ├─ CID-10 section: Cid10Combobox (reuse from change #2) + list of selected codes
  │    └─ AutoSaveIndicator (aria-live="polite")
  │
  └─ [status=finalized] DocumentViewer
       ├─ Header: title, status Badge "Finalizado", Button primary "Baixar PDF" [Download]
       │          Button secondary "Criar novo documento similar", disabled Button "Assinar com e-CPF" + Badge "Em breve"
       ├─ Read-only rendering of all sections (same layout as editor but non-interactive)
       └─ Lock icon + "Este documento foi finalizado e não pode ser editado."
```

## Lucide Icon Mapping (document types)

| Document type | Icon | Label |
|---|---|---|
| declaracao | `FileText` | Declaração |
| atestado | `Stamp` | Atestado |
| relatorio | `ClipboardList` | Relatório |
| laudo | `BookOpen` | Laudo psicológico |
| parecer | `FileSignature` | Parecer |

Additional icons: `FilePlus2` (new document), `Download` (PDF download), `Lock` (finalized state), `AlertTriangle` (CID-10 consent warning).

## Risks / Trade-offs

- **[Tiptap HTML in PDF]** Tiptap stores rich text as HTML. The PDF builder needs to convert HTML to plain text runs (bold/italic/lists). A minimal `html-to-text.ts` parser handles common tags; exotic formatting (tables, images embedded in text) is stripped. Mitigation: Formal documents are predominantly text with occasional bold/lists; the parser covers the realistic surface area.
- **[PDF generation latency]** Building a multi-page laudo PDF takes ~500ms-2s depending on length. Running in an Inngest step means the user sees "Gerando PDF..." and waits. Mitigation: Toast feedback + poll/Realtime subscription for completion; the Inngest step is fast enough that wait is typically <3s total (including network).
- **[Storage costs]** Each finalized document generates a PDF (~50-200KB typical). At 10K psychologists, 50 documents/year = 500K PDFs/year (~50GB/year). Supabase Storage pricing is usage-based; this is manageable. No cleanup needed (20-year retention).
- **[RLS USING clause blocks Inngest update]** The UPDATE policy only allows updates to draft rows. The Inngest job (which sets pdf_storage_path on a finalized row) must use service-role. This is documented and justified in code comments.
- **[Auto-save race with finalize]** If auto-save fires at the same moment as finalize, the update may silently fail (row is now finalized, USING clause blocks it). Mitigation: The auto-save hook checks response; if the update returns 0 rows, it stops retrying. The UI disables auto-save once finalize is clicked.
- **[references_cid10 computed server-side]** The `references_cid10` boolean is derived from `content.cid10Codes.length > 0` at save time. If the user removes CID-10 codes and saves, the flag is cleared. This prevents stale consent requirements. The finalize action recomputes it from the current content.

## Migration Plan

1. Add `clinicalDocuments` table definition to `src/shared/db/schema/medical-records/tables.ts`
2. Add RLS policies to `src/shared/db/schema/medical-records/policies.ts`
3. Run `npm run db:generate` to create migration
4. Manually append RLS SQL + FK constraints (`user_id REFERENCES auth.users(id)`, `patient_id REFERENCES patients(id)`) + CHECK constraints to the generated migration
5. Create Storage bucket `clinical-documents` (via Supabase dashboard or migration script) with storage policies
6. Run `npm run db:migrate` locally and verify
7. Register the Inngest function in the serve handler (`src/app/api/inngest/route.ts`)
8. Deploy: migration + function registration happen automatically in CI

**Rollback:** Migration is additive (new table + bucket). Rollback = DROP TABLE clinical_documents + remove bucket + revert code. No existing data affected.

## Open Questions

(none — all decisions are locked per user direction)
