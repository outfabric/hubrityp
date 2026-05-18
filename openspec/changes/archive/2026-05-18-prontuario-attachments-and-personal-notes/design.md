## Context

The prontuario shell (change #1) established the medical-records domain with `evolutions`, `evolution_versions`, and `audit_log` tables plus the prontuario tab page. This change (#5) activates the "Anexos" and "Notas" tabs by implementing file attachments with Supabase Storage and personal notes with argon2id password protection.

**Current state:**
- Domain schema lives at `src/shared/db/schema/medical-records/`
- Module structure at `src/modules/medical-records/` with lib/, server/, components/, inngest/
- `audit_log` table and `logProntuarioAccess` function are available for reuse
- `consent_terms` table exists at `src/shared/db/schema/patients/tables.ts` with `signedAt`, `revokedAt` columns — used to verify active gravacao consent
- Prontuario page renders tabs with `EmptyTabPlaceholder` for Anexos and Notas

**Constraints:**
- LGPD art. 11: all clinical attachments and notes are sensitive health data
- RN-05.03: personal notes excluded from default export
- RN-05.04: strict user_id isolation via RLS
- RN-05.07: audio attachments require active gravacao consent (CFP 13/2022)
- RF-05.25: max 50MB per file
- RF-05.28: signed URLs with 5-minute expiry
- Lei 13.787/2018: 20-year retention (soft-delete, not hard-delete for attachments)
- Personal notes password is a privacy convenience, not data-integrity control — no recovery mechanism

## Goals / Non-Goals

**Goals:**
- Drizzle schema + migration for `evolution_attachments` and `personal_notes` with RLS
- Supabase Storage bucket `patient-attachments` with storage policies
- Server-side MIME validation using magic bytes (not client-supplied Content-Type)
- File upload with UUID naming, category classification, and consent gate for audio
- Signed URL generation with 5-minute expiry and audit logging
- Soft-delete for attachments (preserves audit trail)
- Personal notes with Tiptap editor, auto-save, optional argon2id password
- Lockout state machine: 5 failed attempts -> 15-minute cooldown per patient_id
- Audit log entries for all operations
- Frontend tabs replacing placeholders with full UX

**Non-Goals:**
- End-to-end encryption of attachment content (Supabase Storage AES-256 at rest is sufficient for MVP)
- Virus/malware scanning (noted as future hardening)
- Video attachments beyond MP4 at 50MB limit
- Cloud import (Google Drive, Dropbox)
- Password recovery for personal notes (by design — see Decision #1)
- Export of personal notes (forward reference to change #7, prontuario-export)

## Decisions

### 1. No password recovery for personal notes

Personal notes password is a local privacy gate (e.g., psychologist shares a computer with a colleague or assistant). It is NOT a data-integrity mechanism. If the psychologist forgets the password, the content is still in the database (accessible via admin/support escalation in extremis, documented in ToS). We explicitly warn the user at password-set time: "Se voce esquecer esta senha, nao sera possivel recupera-la automaticamente."

**Alternative considered:** Email-based password reset flow.
**Rejected because:** It adds complexity disproportionate to the risk. The content is not encrypted at rest — the password gate is UX-level, not cryptographic. A reset flow would imply security guarantees we are not delivering.

### 2. argon2id over bcrypt for personal notes password

argon2id is the OWASP-recommended algorithm (2023+) for password hashing. It is memory-hard (resists GPU/ASIC attacks), time-configurable, and provides side-channel resistance (the "id" hybrid variant). bcrypt is limited to 72-byte inputs and has no memory-hardness parameter.

**Parameters:** memoryCost=65536 (64MB), timeCost=3, parallelism=4, hashLength=32. These are the `node-argon2` defaults and match OWASP recommendations for server-side hashing.

**Alternative considered:** bcrypt with cost factor 12.
**Rejected because:** argon2id provides better resistance against modern GPU attacks due to memory-hardness. The `argon2` npm package has native bindings with good performance (~300ms per hash on typical server hardware at default params).

### 3. Magic-bytes MIME validation (not Content-Type header)

The client-supplied `Content-Type` header (and file extension) is trivially spoofable. An attacker could upload a `.exe` renamed to `.pdf`. We use the `file-type` npm package which reads the first bytes of the file to determine the actual MIME type.

**Validation pipeline:**
1. Check file size <= 50MB (reject early, before reading content)
2. Read first 4KB of file buffer
3. `fileTypeFromBuffer(buffer)` returns detected MIME
4. Compare detected MIME against category-specific allowlists
5. If category=audio, verify consent_terms has an active (signed, not revoked) term for this patient
6. Generate UUID filename: `${crypto.randomUUID()}.${detectedExtension}`
7. Upload to Storage

**Alternative considered:** Trust Content-Type + extension validation only.
**Rejected because:** This is a security-critical path handling clinical data. A file that passes extension validation but contains malicious content (e.g., HTML with embedded JS stored as .pdf) could be served via signed URL and exploit the viewer's browser.

### 4. Soft-delete for attachments (not hard-delete)

Lei 13.787/2018 mandates 20-year retention. Even "deleted" attachments must remain auditable. We set `deleted_at` on the row and filter in the application layer. The Storage object is NOT deleted — it remains in the bucket for the retention period. A future Inngest cron (PRD 11) will handle physical deletion after 20 years.

**RLS implication:** Soft-deleted rows remain visible to the owner (RLS uses `user_id = auth.uid()` without filtering `deleted_at`). The application layer filters them from the UI list. This ensures the owner can still see audit history if needed.

### 5. Storage bucket policies (RLS-equivalent for objects)

Supabase Storage uses `storage.objects` policies. We configure:

```sql
-- Bucket: patient-attachments (private)
-- Insert: user can upload to their own prefix
CREATE POLICY "user can upload own attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'patient-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Select: user can read from their own prefix
CREATE POLICY "user can read own attachments"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'patient-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- No DELETE policy (retention mandate). Physical deletion via service-role only.
-- No UPDATE policy (files are immutable once uploaded).
```

The file path convention `${user_id}/${patient_id}/${uuid}.${ext}` ensures the first folder segment is always the user_id, which the policy checks.

### 6. Lockout state machine for personal notes

State transitions:
```
UNLOCKED (failed_attempts < 5, locked_until IS NULL or < now())
  |
  | wrong password
  v
INCREMENT failed_attempts
  |
  | if failed_attempts >= 5
  v
LOCKED (set locked_until = now() + 15 minutes)
  |
  | time passes (locked_until < now())
  v
COOLDOWN_EXPIRED (next attempt resets counter on success, continues incrementing on failure)
  |
  | correct password
  v
UNLOCKED (reset failed_attempts to 0, clear locked_until)
```

**Key behaviors:**
- During lockout, ALL read attempts are rejected — even with correct password. This prevents timing-based verification.
- After lockout expires, a correct password succeeds AND resets the counter. A wrong password increments again (can re-lock).
- Counter resets ONLY on successful verification.
- The lockout is per-patient_id (each personal_notes row has its own counter). One patient's lockout does not affect another.

### 7. Consent verification for audio uploads

Before uploading a file with category='audio', the server queries:
```sql
SELECT 1 FROM consent_terms
WHERE patient_id = $1
  AND user_id = auth.uid()
  AND signed_at IS NOT NULL
  AND revoked_at IS NULL
LIMIT 1
```

If no active consent exists, the upload is rejected with code `CONSENT_REQUIRED`. The frontend shows an inline Alert (warning variant) with a link to the "Solicitar consentimento" flow (already exists at patient detail page).

**Note:** We do not distinguish between general consent and specific "gravacao" consent in the current `consent_terms` table. The default consent template already includes a recording clause. A future change could add a `consent_type` column for granular control — for now, the existence of ANY active signed consent satisfies RN-05.07.

## Drizzle Table DDL Summary

```typescript
// Added to src/shared/db/schema/medical-records/tables.ts

export const evolutionAttachments = pgTable('evolution_attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),             // FK auth.users
  patientId: uuid('patient_id').notNull(),       // FK patients(id)
  evolutionId: uuid('evolution_id'),             // FK evolutions(id), nullable
  fileName: text('file_name').notNull(),         // Server-generated UUID + ext
  displayName: text('display_name').notNull(),   // Original user-supplied name, sanitized
  fileSize: bigint('file_size', { mode: 'number' }).notNull(),
  mimeType: text('mime_type').notNull(),
  storagePath: text('storage_path').notNull(),   // Full path in bucket
  category: text('category').notNull(),          // CHECK: 'exam'|'image'|'drawing'|'audio'|'other'
  consentVerified: boolean('consent_verified').notNull().default(false),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().default(sql`now()`),
  deletedAt: timestamp('deleted_at', { withTimezone: true }), // Soft delete
}, (table) => [
  index('idx_attachments_patient_uploaded').on(table.patientId, table.uploadedAt),
  index('idx_attachments_user_id').on(table.userId), // For RLS predicate performance
]);

export const personalNotes = pgTable('personal_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),             // FK auth.users
  patientId: uuid('patient_id').notNull(),       // FK patients(id), UNIQUE (1:1)
  content: text('content'),                      // Rich text (HTML from Tiptap)
  passwordHash: text('password_hash'),           // argon2id hash, nullable
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
}, (table) => [
  unique('personal_notes_patient_id_unique').on(table.patientId),
  index('idx_personal_notes_user_id').on(table.userId), // For RLS predicate performance
]);
```

## RLS Policies (SQL appended to migration)

```sql
-- evolution_attachments: owner-scoped, no DELETE (20-year retention)
ALTER TABLE evolution_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner can select attachments" ON evolution_attachments
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "owner can insert attachments" ON evolution_attachments
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner can update attachments" ON evolution_attachments
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
-- No DELETE policy: soft-delete via UPDATE (set deleted_at). Physical delete by service-role only.

-- personal_notes: owner-scoped, no DELETE
ALTER TABLE personal_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner can select personal_notes" ON personal_notes
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "owner can insert personal_notes" ON personal_notes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner can update personal_notes" ON personal_notes
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
-- No DELETE policy: personal notes are retained per Lei 13.787/2018.
```

## Server Action Signatures

```typescript
// --- Attachments (src/modules/medical-records/server/attachments.ts) ---

// uploadAttachment
input: { patientId: string; formData: FormData } // FormData contains file + category
output: { ok: true; id: string; displayName: string } | { ok: false; code: 'FILE_TOO_LARGE' | 'INVALID_MIME' | 'CONSENT_REQUIRED' | 'UNAUTHORIZED' }

// listAttachments
input: { patientId: string; category?: AttachmentCategory }
output: { attachments: AttachmentSummary[] } // Filters soft-deleted

// getAttachmentSignedUrl
input: { attachmentId: string }
output: { ok: true; signedUrl: string; expiresIn: 300 } | { ok: false; code: 'NOT_FOUND' | 'UNAUTHORIZED' }
// Side-effect: writes audit_log row (action='attachment.view-url')

// deleteAttachment
input: { attachmentId: string }
output: { ok: true } | { ok: false; code: 'NOT_FOUND' | 'UNAUTHORIZED' }
// Side-effect: sets deleted_at, writes audit_log row (action='attachment.delete')

// --- Personal Notes (src/modules/medical-records/server/personal-notes.ts) ---

// getPersonalNotes
input: { patientId: string; password?: string }
output: { ok: true; content: string | null; hasPassword: boolean; isLocked: boolean; remainingAttempts?: number; lockedUntilIso?: string }
       | { ok: false; code: 'LOCKED' | 'WRONG_PASSWORD' | 'UNAUTHORIZED'; remainingAttempts?: number; lockedUntilIso?: string }
// Side-effect: audit_log 'personal-notes.read' on success, 'personal-notes.password-failed' on failure

// upsertPersonalNotes
input: { patientId: string; content: string }
output: { ok: true } | { ok: false; code: 'UNAUTHORIZED' }
// Side-effect: audit_log 'personal-notes.update'

// setPersonalNotesPassword
input: { patientId: string; newPassword: string }
output: { ok: true } | { ok: false; code: 'UNAUTHORIZED' | 'WEAK_PASSWORD' }
// Side-effect: hashes password with argon2id, clears failed_attempts, audit_log 'personal-notes.password-set'

// removePersonalNotesPassword
input: { patientId: string; currentPassword: string }
output: { ok: true } | { ok: false; code: 'WRONG_PASSWORD' | 'LOCKED' | 'UNAUTHORIZED' }
// Side-effect: nulls password_hash, clears counters, audit_log 'personal-notes.password-removed'
```

## Module Structure (additions to existing medical-records module)

```
src/modules/medical-records/
  lib/
    attachment-schemas.ts       # Zod schemas: uploadAttachmentInput, category enum, MIME allowlists
    personal-notes-schemas.ts   # Zod schemas: password rules (min 6 chars), content input
    mime-validator.ts           # Magic-bytes validation using file-type, category->MIME mapping
    filename-sanitizer.ts      # Sanitize display_name (strip path traversal, special chars)
  server/
    attachments.ts             # uploadAttachment, listAttachments, getAttachmentSignedUrl, deleteAttachment
    personal-notes.ts          # getPersonalNotes, upsertPersonalNotes, setPersonalNotesPassword, removePersonalNotesPassword
  components/
    attachments-tab.tsx        # Main tab component (list + upload trigger)
    attachment-upload-sheet.tsx # Sheet with dropzone, category selector, consent warning
    attachment-card.tsx        # Individual file card with preview/download actions
    personal-notes-tab.tsx     # Main tab component (banner + lock screen + editor)
    personal-notes-lock.tsx    # Password input screen with lockout state display
    personal-notes-password-sheet.tsx  # Set/remove password Sheet
```

## UI Component Specifications

### AttachmentsTab
- Header: h3 "Anexos", Button primary "Anexar arquivo" (icon Paperclip)
- Optional filter Select by category (Exame externo / Imagem / Desenho / Audio / Outro / Todos)
- List: Card per attachment with:
  - File icon (FileText for PDF, Image for images, Mic for audio, Paperclip default)
  - Display name (truncated), file size (formatted: "1.2 MB"), category Badge, uploaded date
  - Actions: eye icon (preview/download), Trash2 (soft-delete with Modal confirmation)
- Inline preview: PDF via iframe with signed URL, images via img with signed URL
- Empty state: standard Salvia pattern (Upload icon, "Nenhum anexo", description, CTA)

### AttachmentUploadSheet
- Sheet right side with:
  - Dropzone (drag-and-drop, click-to-pick), file type legend, "Max 50MB" helper text
  - Category RadioGroup: Exame externo / Imagem / Desenho / Audio / Outro
  - If category=audio and no active consent: inline Alert warning variant with link
  - Progress bar during upload
  - Button primary "Anexar" (disabled when consent blocked or no file selected)

### PersonalNotesTab
- Top banner: bg warning-50, text warning-700, Lock icon: "Estas notas sao pessoais do(a) psicologo(a) e NAO fazem parte do prontuario oficial que o paciente pode acessar (Resolucao CFP 001/2009, art. 5)."
- If password set and not unlocked in session: lock screen (PersonalNotesLock)
- Once unlocked: Tiptap editor (reuses same configuration from evolutions), auto-save indicator
- Footer: link "Configurar senha extra" / "Remover senha extra" -> opens PersonalNotesPasswordSheet
- Info note: "Estas notas NAO entram na exportacao padrao. Para incluir explicitamente, marque a opcao ao exportar."

### PersonalNotesLock
- Centered Card with Lock icon, "Notas protegidas" heading
- Input password + Button "Desbloquear"
- If locked: countdown display "Bloqueado por X minutos" (calculates from lockedUntilIso)
- Failed attempt feedback: "Senha incorreta. Tentativas restantes: N"

## Risks / Trade-offs

- **[argon2 native binding in CI]** The `argon2` package requires native compilation. Mitigation: Most CI environments (GitHub Actions, Vercel) have Node.js build tools pre-installed. If issues arise, `@node-rs/argon2` is a pure Rust+NAPI alternative with pre-built binaries.
- **[Storage costs at scale]** Each psychologist could store up to 50MB * N attachments. At 10K psychologists, 100 attachments each = 50TB. Mitigation: Supabase Storage pricing is usage-based; file size limits and per-psychologist quotas can be added later.
- **[file-type detection limitations]** Some file types (plain text, CSV) lack magic bytes. Mitigation: For unrecognizable types, fall back to extension + Content-Type as secondary signals, but reject if the category expects a specific type (e.g., category=audio must have audio/* MIME detected).
- **[Lockout bypass via direct DB update]** If a user has direct DB access (e.g., via Supabase dashboard), they can reset `failed_attempts`. Mitigation: This is acceptable — the password gate is UX-level privacy, not cryptographic security. The data itself is not encrypted at rest.
- **[Soft-deleted files still consume storage]** Files remain in the bucket after soft-delete. Mitigation: Future Inngest cron for physical cleanup after retention period. Monitor storage growth in the meantime.

## Migration Plan

1. Add `evolution_attachments` and `personal_notes` table definitions to `src/shared/db/schema/medical-records/tables.ts`
2. Add RLS policies to `src/shared/db/schema/medical-records/policies.ts`
3. Run `npm run db:generate` to create migration
4. Manually append RLS SQL + FK constraints + CHECK constraint on `category` column to migration
5. Create Storage bucket `patient-attachments` via Supabase dashboard (or migration script)
6. Add storage policies via Supabase SQL editor (or include in migration)
7. Install `argon2` and `file-type` packages
8. Run `npm run db:migrate` locally and verify
9. Deploy: migration + package install happen automatically in CI

**Rollback:** Migration is additive (new tables + bucket). Rollback = drop tables + remove bucket + revert code. No existing data is affected.

## Open Questions

(none — all decisions are locked per user direction)
