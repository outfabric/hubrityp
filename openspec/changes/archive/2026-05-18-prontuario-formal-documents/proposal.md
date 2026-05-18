## Why

Brazilian psychologists are legally required (Resolução CFP 06/2019) to produce formal clinical documents — declaração, atestado, relatório, laudo psicológico, and parecer — with a mandatory structure including identification, demand description, procedures, analysis, conclusion, and signature space. Today these are created in Word with manual formatting, no versioning, and no audit trail. This change adds structured authoring with per-section Tiptap editors, CFP 06/2019-compliant PDF generation via pdfkit in an async Inngest job, Supabase Storage with signed URL access, a CID-10 consent gate (RN-05.06), and a draft/finalized state machine that preserves the legal integrity of finalized documents. It depends on the foundation (change #1 — audit_log, medical-records module), CID-10 search utility (change #2 — already in `src/modules/medical-records/lib/`), and Storage bucket policy patterns (change #5 — `patient-attachments` bucket approach).

## What Changes

- New `clinical_documents` table in `src/shared/db/schema/medical-records/` with RLS (owner-scoped SELECT/INSERT/UPDATE, no DELETE), status CHECK ('draft'/'finalized'), finalized-row update protection via RLS USING clause
- New Supabase Storage bucket `clinical-documents` (private) with per-user prefix policies mirroring change #5's `patient-attachments` pattern
- Discriminated Zod schemas per document type (declaracao, atestado, relatorio, laudo, parecer) with CFP 06/2019 mandatory section validation
- Server Actions: createDocument, updateDocument, finalizeDocument (with CID-10 consent gate per RN-05.06), listDocumentsByPatient, getDocumentDetail, getDocumentPdfUrl
- Inngest job `documents/generate-pdf`: reads document, builds CFP-compliant PDF with pdfkit (header, page numbering, watermark, signature block, CID-10 section), uploads to Storage, updates row
- Audit log integration on every action (create, update, finalize, view, pdf-download, pdf-generated)
- Frontend: "Documentos" tab activated (replaces "Em breve" placeholder), document type selector, structured editor with per-section Tiptap instances, finalize modal with CID-10 consent checkbox, read-only viewer, PDF download via signed URL, "Criar novo documento similar" clone flow
- ICP-Brasil digital signature placeholder (disabled button + "Em breve" badge — actual signing out of scope)

## Capabilities

### New Capabilities
- `clinical-documents`: Full lifecycle of formal clinical documents — creation, structured editing per CFP 06/2019, CID-10 consent gate, draft/finalized state machine, PDF generation via Inngest job, Storage with signed URL, RLS isolation, audit logging, finalization immutability, ICP-Brasil placeholder

### Modified Capabilities
<!-- No existing spec requirements are changing. The prontuario shell (foundation) already has a "Documentos" tab placeholder — this change fulfills it without altering existing behavior. -->

## Impact

- **Database:** 1 new table (`clinical_documents`) + migration with RLS + indexes + CHECK constraints + finalized-update protection
- **Drizzle schema:** Addition to `src/shared/db/schema/medical-records/tables.ts` and `policies.ts`
- **Supabase Storage:** New bucket `clinical-documents` with INSERT/SELECT policies scoped by `user_id` prefix path
- **Module (`src/modules/medical-records/`):** New files in `lib/schemas/`, `server/`, `components/`, `inngest/`
- **Routes:** 3 new pages under `src/app/(app)/pacientes/[id]/prontuario/documentos/` (list inline in tab, `/novo`, `/[docId]`)
- **Inngest:** New function `documents/generate-pdf` registered in the serve handler
- **Dependencies:** No new npm packages (pdfkit already installed; Inngest, Tiptap, Supabase Storage client already available)
- **Regulatory:** CFP 06/2019 (document structure), RN-05.04 (RLS isolation), RN-05.06 (CID-10 consent), LGPD art. 11 (sensitive health data, signed URL 5-min expiry), Lei 13.787/2018 (20-year retention, no DELETE)
- **Security:** RLS on table (including finalized-row protection), private Storage bucket, signed URL expiry, audit log on all actions, Zod validation at boundary, session-derived user_id
