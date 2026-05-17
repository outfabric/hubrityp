## ADDED Requirements

### Requirement: Psychologist can upload file attachments to a patient's prontuario

The system SHALL allow the psychologist to upload files (PDF, JPG, PNG, MP3, MP4) up to 50MB each to a patient's prontuario. Each upload MUST include a category classification. The file MUST be validated server-side via magic-bytes MIME detection (not client-supplied Content-Type). The stored filename MUST be a server-generated UUID with the detected extension — user-supplied filenames are stored only as `display_name` metadata after sanitization (path traversal characters stripped).

#### Scenario: Upload a PDF exam

- **WHEN** psychologist selects a PDF file (≤50MB), chooses category "Exame externo", and confirms upload
- **THEN** system validates MIME via magic bytes, generates a UUID filename, uploads to Storage at `${user_id}/${patient_id}/${uuid}.pdf`, persists an `evolution_attachments` row with the metadata, and shows success toast

#### Scenario: Upload rejected for exceeding size limit

- **WHEN** psychologist attempts to upload a file larger than 50MB
- **THEN** system rejects the upload immediately (before reading content) with error "Arquivo excede o limite de 50MB"

#### Scenario: Upload rejected for invalid MIME type

- **WHEN** psychologist uploads a file whose magic bytes do not match an allowed MIME type for the selected category
- **THEN** system rejects the upload with error "Tipo de arquivo nao permitido para esta categoria"

#### Scenario: Upload rejected for spoofed extension

- **WHEN** psychologist uploads a `.exe` file renamed to `.pdf` whose magic bytes reveal it is not a PDF
- **THEN** system rejects the upload with code `INVALID_MIME`

#### Scenario: Filename sanitization prevents path traversal

- **WHEN** psychologist uploads a file named `../../etc/passwd.pdf`
- **THEN** system stores `display_name` as `etcpasswd.pdf` (path separators and traversal sequences stripped) and uses a UUID for the actual Storage path

### Requirement: Audio attachments require active gravacao consent

The system SHALL verify that an active (signed and not revoked) consent term exists for the patient before allowing upload of audio files (category='audio'). This enforces CFP 13/2022 (gravacao consent) at the upload boundary.

#### Scenario: Audio upload blocked when no active consent

- **WHEN** psychologist selects category "Audio" for upload and the patient has no consent term with `signed_at IS NOT NULL AND revoked_at IS NULL`
- **THEN** system rejects the upload with code `CONSENT_REQUIRED` and the UI shows an Alert (warning variant): "Gravacoes requerem termo de consentimento assinado (CFP 13/2022). [Solicitar consentimento]"

#### Scenario: Audio upload succeeds with active consent

- **WHEN** psychologist uploads an MP3 file with category "Audio" and the patient has an active signed consent term
- **THEN** system marks `consent_verified = true` on the attachment row and proceeds with normal upload flow

#### Scenario: Audio upload blocked when consent was revoked

- **WHEN** psychologist attempts audio upload and the patient's consent term has `revoked_at` set
- **THEN** system treats this as no active consent and rejects with `CONSENT_REQUIRED`

### Requirement: Psychologist can list attachments for a patient

The system SHALL return all non-soft-deleted attachments for a given patient, ordered by `uploaded_at DESC`. The list MUST be filterable by category. Only attachments belonging to the authenticated psychologist (via `user_id = auth.uid()`) SHALL be returned.

#### Scenario: List all attachments

- **WHEN** psychologist opens the Anexos tab for a patient
- **THEN** system returns all attachments where `deleted_at IS NULL`, ordered by most recent first

#### Scenario: Filter by category

- **WHEN** psychologist selects "Imagem" in the category filter
- **THEN** system returns only attachments with `category = 'image'` for that patient

#### Scenario: Soft-deleted attachments hidden from list

- **WHEN** an attachment has `deleted_at` set
- **THEN** it does NOT appear in the default list view

#### Scenario: RLS prevents cross-psychologist access

- **WHEN** psychologist B attempts to list attachments for a patient belonging to psychologist A
- **THEN** the query returns zero results (RLS filters by `user_id = auth.uid()`)

### Requirement: Psychologist can view attachments via signed URL

The system SHALL generate short-lived signed URLs (5-minute expiry) for accessing attachment files from Supabase Storage. Each signed URL generation MUST write an audit log entry.

#### Scenario: Generate signed URL for PDF preview

- **WHEN** psychologist clicks to preview a PDF attachment
- **THEN** system generates a signed URL with 300-second expiry, writes audit_log row (action='attachment.view-url'), and renders the PDF in an iframe

#### Scenario: Generate signed URL for image preview

- **WHEN** psychologist clicks to preview an image attachment
- **THEN** system generates a signed URL and renders the image inline via `<img>` tag

#### Scenario: Signed URL expires after 5 minutes

- **WHEN** a signed URL is accessed after 5 minutes
- **THEN** Supabase Storage returns a 403/expired error

#### Scenario: Audit log records URL generation

- **WHEN** a signed URL is generated
- **THEN** an `audit_log` row is created with action='attachment.view-url', resource_type='attachment', resource_id=attachment_id

### Requirement: Psychologist can soft-delete attachments

The system SHALL allow the psychologist to soft-delete attachments by setting `deleted_at = now()`. The Storage object MUST NOT be physically deleted (20-year retention mandate). Each soft-delete MUST write an audit log entry.

#### Scenario: Soft-delete an attachment

- **WHEN** psychologist confirms deletion of an attachment via the destructive Modal
- **THEN** system sets `deleted_at = now()` on the row, writes audit_log (action='attachment.delete'), and removes the attachment from the visible list

#### Scenario: Confirmation modal shows retention notice

- **WHEN** psychologist clicks the delete icon on an attachment
- **THEN** system shows a destructive Modal: "Tem certeza? O arquivo sera removido do prontuario (mantemos uma copia auditavel por 5 anos)."

#### Scenario: Storage object not physically deleted

- **WHEN** an attachment is soft-deleted
- **THEN** the file remains in the `patient-attachments` bucket at its original path

### Requirement: RLS enforces owner-scoped access on evolution_attachments

The system SHALL enable RLS on `evolution_attachments` with per-operation policies: SELECT, INSERT, UPDATE scoped to `user_id = auth.uid()`. There SHALL be no DELETE policy (retention mandate enforced at RLS layer).

#### Scenario: Owner can SELECT own attachments

- **WHEN** psychologist queries `evolution_attachments`
- **THEN** only rows where `user_id` matches auth.uid() are returned

#### Scenario: Owner can INSERT with own user_id

- **WHEN** psychologist inserts an attachment row with `user_id = auth.uid()`
- **THEN** the INSERT succeeds

#### Scenario: INSERT rejected for mismatched user_id

- **WHEN** a request attempts to INSERT with a `user_id` different from auth.uid()
- **THEN** the INSERT is rejected by RLS

#### Scenario: No DELETE policy exists

- **WHEN** any authenticated user attempts to DELETE from `evolution_attachments`
- **THEN** the operation is rejected (no DELETE policy)

### Requirement: Storage policies enforce per-user file isolation

The system SHALL configure Supabase Storage policies on the `patient-attachments` bucket to ensure users can only upload to and read from their own prefix (`${user_id}/...`). No DELETE policy SHALL exist for the authenticated role.

#### Scenario: User can upload to own prefix

- **WHEN** psychologist uploads a file to path `${their_user_id}/${patient_id}/${uuid}.ext`
- **THEN** the Storage upload succeeds

#### Scenario: User cannot upload to another user's prefix

- **WHEN** psychologist attempts to upload to path `${other_user_id}/${patient_id}/${uuid}.ext`
- **THEN** the Storage upload is rejected by the policy

#### Scenario: User can read from own prefix

- **WHEN** psychologist requests a file from `${their_user_id}/...`
- **THEN** the Storage read succeeds

#### Scenario: User cannot read from another user's prefix

- **WHEN** psychologist requests a file from `${other_user_id}/...`
- **THEN** the Storage read is rejected (returns 403)

### Requirement: Attachment operations generate audit log entries

The system SHALL write audit_log entries for upload, view-url generation, and delete operations. Each entry MUST include the authenticated user_id, action, resource_type='attachment', and the attachment's resource_id.

#### Scenario: Upload audit entry

- **WHEN** a file is successfully uploaded
- **THEN** system writes audit_log with action='attachment.upload', resource_id=new_attachment_id

#### Scenario: View-URL audit entry

- **WHEN** a signed URL is generated
- **THEN** system writes audit_log with action='attachment.view-url', resource_id=attachment_id

#### Scenario: Delete audit entry

- **WHEN** an attachment is soft-deleted
- **THEN** system writes audit_log with action='attachment.delete', resource_id=attachment_id
