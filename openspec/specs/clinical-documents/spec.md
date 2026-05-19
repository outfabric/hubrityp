### Requirement: Psychologist can create a clinical document for a patient

The system SHALL allow psychologists to create clinical documents for their patients. Each document MUST have a `document_type` from the allowed set: 'declaracao', 'atestado', 'relatorio', 'laudo', 'parecer'. On creation, the system MUST snapshot the psychologist's current identity (name, CRP, contact) into the document's `content.psychologistInfo` field. The initial status MUST be 'draft'. The system SHALL write an `audit_log` entry with action='document.create' on every creation.

#### Scenario: Create a laudo document

- **WHEN** psychologist submits a new document with documentType='laudo', patientId=valid_patient
- **THEN** system persists a clinical_documents row with status='draft', user_id=auth.uid(), psychologistInfo snapshot from profile, and writes an audit_log entry

#### Scenario: Create a document with initial content

- **WHEN** psychologist submits a new document with documentType='declaracao' and initialContent containing solicitante and demanda
- **THEN** system persists the document with the provided initial content merged with the psychologistInfo snapshot

#### Scenario: Reject creation for unauthorized patient

- **WHEN** psychologist attempts to create a document for a patient_id that does not belong to them
- **THEN** system rejects with code 'UNAUTHORIZED' and does not persist any row

### Requirement: Psychologist can update a draft clinical document

The system SHALL allow the owning psychologist to update the content and title of a clinical document ONLY when its status is 'draft'. Updates to finalized documents MUST be rejected. The system SHALL write an `audit_log` entry with action='document.update' on every successful update.

#### Scenario: Update content of a draft document

- **WHEN** psychologist updates the content of a document with status='draft'
- **THEN** system persists the updated content, sets updated_at=now, and writes an audit_log entry

#### Scenario: Reject update to a finalized document

- **WHEN** psychologist attempts to update a document with status='finalized'
- **THEN** system rejects with code 'ALREADY_FINALIZED' and does not modify the row

#### Scenario: RLS blocks update to finalized document at database level

- **WHEN** a direct SQL UPDATE is attempted on a clinical_documents row with status='finalized' using the authenticated role
- **THEN** the database returns 0 rows affected due to the RLS USING clause excluding finalized rows

#### Scenario: Auto-save persists draft content every 10 seconds

- **WHEN** the editor has unsaved changes and 10 seconds elapse
- **THEN** the system auto-saves the current content via updateDocument, showing "Salvo as HH:MM" indicator

### Requirement: Psychologist can finalize a clinical document with CID-10 consent gate

The system SHALL allow the owning psychologist to finalize a draft document, transitioning its status to 'finalized'. Before finalization, the system MUST validate that all mandatory sections for the document type are filled. If the document references CID-10 codes (content.cid10Codes is non-empty), the system MUST require `cid10ConsentConfirmed=true` per RN-05.06; otherwise finalization MUST be rejected with code 'CID10_CONSENT_REQUIRED'. Upon successful finalization, the system SHALL set status='finalized', finalizedAt=now(), enqueue the PDF generation Inngest job, and write an audit_log entry with action='document.finalize'.

#### Scenario: Finalize a laudo without CID-10

- **WHEN** psychologist finalizes a laudo document that has all mandatory sections filled and no CID-10 codes
- **THEN** system sets status='finalized', finalizedAt=now(), enqueues 'documents/pdf.requested' event, and writes audit_log entry

#### Scenario: Finalize a document with CID-10 and consent confirmed

- **WHEN** psychologist finalizes a document containing cid10Codes=[{code:'F32.0', description:'...'}] with cid10ConsentConfirmed=true
- **THEN** system sets status='finalized', references_cid10=true, cid10_consent_confirmed=true, enqueues PDF generation, and writes audit_log entry

#### Scenario: Reject finalization without CID-10 consent when codes present

- **WHEN** psychologist finalizes a document containing CID-10 codes but cid10ConsentConfirmed is false or absent
- **THEN** system rejects with code 'CID10_CONSENT_REQUIRED' and does not change status

#### Scenario: Reject finalization with missing mandatory sections

- **WHEN** psychologist finalizes a laudo document missing the 'analise' section (mandatory for laudo)
- **THEN** system rejects with code 'VALIDATION_ERROR' and does not change status

#### Scenario: Reject finalization of already-finalized document

- **WHEN** psychologist attempts to finalize a document with status='finalized'
- **THEN** system rejects with code 'ALREADY_FINALIZED'

### Requirement: System generates CFP 06/2019-compliant PDF via async job

The system SHALL generate a PDF for finalized documents using pdfkit in an Inngest background job triggered by 'documents/pdf.requested'. The PDF MUST include: psychologist header (name, CRP, contact), document title/type, all content sections as labeled paragraphs, CID-10 codes (if present), local and date, signature block ("Assinatura — ICP-Brasil ou manuscrita + carimbo CRP"), page numbering ("Pagina X de Y" centered at footer), and a diagonal watermark "DOCUMENTO PSICOLOGICO" (light gray, 11% opacity). The generated PDF SHALL be stored in Supabase Storage bucket 'clinical-documents' at path `${user_id}/${patient_id}/${documentId}.pdf`. The system SHALL update the document row with pdf_storage_path and pdf_size, and write an audit_log entry with action='document.pdf-generated'.

#### Scenario: PDF generated successfully for a finalized laudo

- **WHEN** the Inngest job 'documents/generate-pdf' runs for a finalized laudo document
- **THEN** system generates a PDF with all mandatory sections, uploads to Storage at the correct path, updates pdf_storage_path and pdf_size on the document row, and writes audit_log entry

#### Scenario: PDF generation is idempotent on retry

- **WHEN** the Inngest job runs for a document that already has pdf_storage_path set
- **THEN** system returns early without regenerating or re-uploading the PDF

#### Scenario: PDF includes page numbering

- **WHEN** a multi-page document is generated
- **THEN** each page contains "Pagina X de Y" centered at the footer

#### Scenario: PDF includes watermark on every page

- **WHEN** the PDF is generated
- **THEN** each page contains a diagonal "DOCUMENTO PSICOLOGICO" watermark at 11% opacity

### Requirement: Psychologist can access PDF via signed URL with 5-minute expiry

The system SHALL provide a signed URL (5-minute expiration) for downloading the PDF of a finalized document. The signed URL MUST only be generated if the requesting psychologist owns the document (user_id = auth.uid()). The system SHALL write an audit_log entry with action='document.pdf-download' on every signed URL generation.

#### Scenario: Generate signed URL for own finalized document

- **WHEN** psychologist requests the PDF URL for a finalized document they own that has pdf_storage_path set
- **THEN** system returns a signed URL with 5-minute expiry and writes audit_log entry

#### Scenario: Reject signed URL for document without PDF ready

- **WHEN** psychologist requests the PDF URL for a document where pdf_storage_path is null
- **THEN** system rejects with code 'PDF_NOT_READY'

#### Scenario: Reject signed URL for another psychologist's document

- **WHEN** psychologist A requests the PDF URL for a document owned by psychologist B
- **THEN** system rejects with code 'NOT_FOUND' (RLS prevents visibility)

### Requirement: Psychologist can list documents by patient with filtering

The system SHALL allow the owning psychologist to list clinical documents for a patient, ordered by created_at DESC. The system SHALL support filtering by document_type and status. The system SHALL write an audit_log entry with action='document.list' on each list access.

#### Scenario: List all documents for a patient

- **WHEN** psychologist requests documents for a patient they own without filters
- **THEN** system returns all clinical documents for that patient ordered by created_at DESC

#### Scenario: Filter documents by type

- **WHEN** psychologist requests documents with filter type='laudo'
- **THEN** system returns only laudo documents for that patient

#### Scenario: Filter documents by status

- **WHEN** psychologist requests documents with filter status='finalized'
- **THEN** system returns only finalized documents for that patient

#### Scenario: RLS prevents listing another psychologist's patient documents

- **WHEN** psychologist A requests documents for a patient owned by psychologist B
- **THEN** system returns an empty list (RLS filters out non-owned rows)

### Requirement: Psychologist can view document detail

The system SHALL allow the owning psychologist to view the full content of a clinical document. The system SHALL write an audit_log entry with action='document.view' on every detail access.

#### Scenario: View draft document detail

- **WHEN** psychologist requests detail for a draft document they own
- **THEN** system returns the full document content including all sections and metadata

#### Scenario: View finalized document detail

- **WHEN** psychologist requests detail for a finalized document they own
- **THEN** system returns the full document content in read-only mode with pdf_storage_path and finalized_at

#### Scenario: Reject detail for non-owned document

- **WHEN** psychologist requests detail for a document owned by another psychologist
- **THEN** system rejects with code 'NOT_FOUND'

### Requirement: RLS enforces tenant isolation with no DELETE capability

The system SHALL enforce row-level security on the `clinical_documents` table such that each psychologist can only SELECT, INSERT, and UPDATE (draft only) their own documents. There SHALL be no DELETE policy — documents are retained for 20 years per Lei 13.787/2018. The UPDATE policy MUST exclude rows with status='finalized' via the USING clause, providing database-level protection against modification of finalized documents.

#### Scenario: Psychologist B cannot read psychologist A's documents

- **WHEN** psychologist B queries clinical_documents for a patient owned by psychologist A
- **THEN** the query returns 0 rows

#### Scenario: Psychologist B cannot update psychologist A's documents

- **WHEN** psychologist B attempts to UPDATE a clinical_documents row owned by psychologist A
- **THEN** the database returns 0 rows affected

#### Scenario: No user can DELETE clinical documents

- **WHEN** any authenticated user attempts to DELETE a clinical_documents row
- **THEN** the database rejects the operation (no DELETE policy exists)

#### Scenario: Authenticated user cannot update finalized documents

- **WHEN** the document owner attempts to UPDATE a clinical_documents row with status='finalized'
- **THEN** the database returns 0 rows affected due to USING clause

### Requirement: Audit log records every clinical document operation

The system SHALL write to `audit_log` (via service-role) for every clinical document operation: create, update, finalize, view, list, pdf-download, and pdf-generated. Each entry MUST include user_id, action, resource_type='clinical_document', resource_id=document_id, and relevant metadata. Audit log writes MUST NOT fail the parent operation (fire-and-forget with internal error logging).

#### Scenario: Audit entry on document creation

- **WHEN** a clinical document is created
- **THEN** audit_log receives a row with action='document.create', resource_id=new_document_id

#### Scenario: Audit entry on finalization

- **WHEN** a clinical document is finalized
- **THEN** audit_log receives a row with action='document.finalize', metadata including document_type

#### Scenario: Audit entry on PDF generation

- **WHEN** the Inngest job completes PDF generation
- **THEN** audit_log receives a row with action='document.pdf-generated', metadata including pdf_size

#### Scenario: Audit entry on PDF download

- **WHEN** a signed URL is generated for PDF download
- **THEN** audit_log receives a row with action='document.pdf-download'

### Requirement: Finalized documents support clone-as-new for amendments

The system SHALL allow psychologists to create a new document by cloning the content of a finalized document. The new document MUST be a separate row with status='draft', a new id, and fresh created_at. The original finalized document MUST remain unchanged.

#### Scenario: Clone a finalized laudo into a new draft

- **WHEN** psychologist clicks "Criar novo documento similar" on a finalized laudo
- **THEN** system creates a new draft document with the same content and document_type, a new id, fresh timestamps, and navigates to the editor

#### Scenario: Original document unchanged after clone

- **WHEN** a new document is cloned from a finalized document and the clone is edited
- **THEN** the original finalized document's content and metadata remain unchanged

### Requirement: ICP-Brasil digital signature is presented as a disabled placeholder

The system SHALL display a "Assinar com e-CPF" button in both the editor (draft) and viewer (finalized) states. The button MUST be disabled with an adjacent Badge showing "Em breve". The `signature_method` column MUST exist in the schema with CHECK constraint ('icp_brasil'|'physical') but SHALL NOT be settable through the UI in this version.

#### Scenario: ICP-Brasil button shown as disabled in editor

- **WHEN** psychologist views the document editor
- **THEN** a disabled "Assinar com e-CPF" button is visible with "Em breve" badge, and it cannot be interacted with

#### Scenario: ICP-Brasil button shown as disabled in viewer

- **WHEN** psychologist views a finalized document
- **THEN** a disabled "Assinar com e-CPF" button is visible with "Em breve" badge

### Requirement: Document type selector offers five CFP 06/2019 document types

The system SHALL present a type selection screen with five options when creating a new document: Declaracao, Atestado, Relatorio, Laudo psicologico, Parecer. Each option MUST display a Lucide icon, the type label, and a one-line description. Selecting an option SHALL create the document and navigate to the editor.

#### Scenario: Five document types displayed

- **WHEN** psychologist navigates to the "Novo documento" page
- **THEN** system displays 5 card options in a 2-column grid (single column on mobile): Declaracao, Atestado, Relatorio, Laudo psicologico, Parecer

#### Scenario: Selecting a type creates a draft and navigates to editor

- **WHEN** psychologist clicks the "Laudo psicologico" card
- **THEN** system creates a new draft laudo document and navigates to the editor page for that document

### Requirement: Structured editor enforces per-type section layout

The system SHALL render a structured editor with labeled sections matching CFP 06/2019 requirements. Each section MUST use a Tiptap editor instance. Sections MUST vary by document type: declaracao and atestado have optional 'analise'; relatorio, laudo, and parecer have mandatory 'analise'. The CID-10 section MUST use the Cid10Combobox component from change #2. The editor MUST respect accessibility requirements (aria-labelledby on sections, focus trap in finalize modal).

#### Scenario: Laudo editor shows all mandatory sections

- **WHEN** psychologist opens the editor for a laudo document
- **THEN** system displays sections: Solicitante, Demanda, Procedimentos, Analise (required), Conclusao, Local e Data, CID-10 (opcional)

#### Scenario: Declaracao editor shows analise as optional

- **WHEN** psychologist opens the editor for a declaracao document
- **THEN** system displays sections with Analise clearly marked as optional and not required for finalization

#### Scenario: CID-10 combobox allows adding codes

- **WHEN** psychologist uses the CID-10 section to search for 'F32'
- **THEN** system displays matching CID-10 codes via Cid10Combobox and allows selection

### Requirement: Finalize modal confirms irreversibility with CID-10 consent checkbox

The system SHALL display a destructive confirmation modal when the psychologist clicks "Finalizar e gerar PDF". The modal MUST state: "Apos finalizacao, este documento nao podera ser editado. Uma nova versao exige criar um novo documento." If the document references CID-10 codes, the modal MUST include a mandatory checkbox: "Confirmo que o paciente consentiu com a inclusao do(s) codigo(s) CID-10 (RN-05.06)." The confirm button MUST be disabled until the checkbox is checked (when applicable). The modal MUST have focus trap and close on Escape.

#### Scenario: Modal without CID-10 consent (no codes)

- **WHEN** psychologist clicks "Finalizar e gerar PDF" on a document without CID-10 codes
- **THEN** modal displays irreversibility warning without the consent checkbox, and confirm button is enabled

#### Scenario: Modal with CID-10 consent required

- **WHEN** psychologist clicks "Finalizar e gerar PDF" on a document containing CID-10 codes
- **THEN** modal displays irreversibility warning WITH consent checkbox, and confirm button is disabled until checkbox is checked

#### Scenario: Confirm triggers finalization

- **WHEN** psychologist confirms in the modal (with consent if required)
- **THEN** system calls finalizeDocument, shows toast "Gerando PDF...", and transitions to viewer once PDF is ready
