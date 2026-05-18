## 1. Dependencies and Database Schema

- [x] 1.1 Install npm packages: `argon2` and `file-type` (add to `package.json` dependencies)
- [x] 1.2 Add `evolution_attachments` and `personal_notes` table definitions to `src/shared/db/schema/medical-records/tables.ts` (columns, indexes, unique constraints per design.md DDL)
- [x] 1.3 Add RLS policies to `src/shared/db/schema/medical-records/policies.ts`: `evolutionAttachmentsPolicies` (SELECT/INSERT/UPDATE owner-scoped, no DELETE) and `personalNotesPolicies` (SELECT/INSERT/UPDATE owner-scoped, no DELETE)
- [x] 1.4 Update `src/shared/db/schema/medical-records/index.ts` barrel to re-export new tables and policies
- [x] 1.5 Run `npm run db:generate`, manually append RLS policies + FK constraints (user_id -> auth.users, patient_id -> patients, evolution_id -> evolutions nullable) + CHECK constraint on `category` column (`'exam','image','drawing','audio','other'`) to the generated migration file
- [x] 1.6 Add Supabase Storage bucket creation SQL and storage policies (INSERT/SELECT scoped to `(storage.foldername(name))[1] = auth.uid()::text`, no DELETE) to the migration or a separate setup script
- [x] 1.7 Run `npm run db:migrate` locally and verify tables + RLS + storage policies exist
- [x] 1.8 **Integration test:** Create `src/__tests__/integration/medical-records/attachments-schema.int.test.ts` — verify `evolution_attachments` table exists, RLS enabled, SELECT/INSERT/UPDATE policies exist, no DELETE policy, UNIQUE on `personal_notes.patient_id`, CHECK constraint on category column

## 2. Module Lib — Schemas, Validators, Helpers

- [x] 2.1 Create `src/modules/medical-records/lib/attachment-schemas.ts` — Zod schemas: `attachmentCategorySchema` (enum: 'exam'|'image'|'drawing'|'audio'|'other'), `uploadAttachmentInputSchema` (patientId uuid, category), MIME allowlists per category (exam: pdf; image: jpg/png/webp; drawing: jpg/png/webp; audio: mp3/mp4/m4a/wav; other: pdf/jpg/png/doc/docx), max file size constant (50MB)
- [x] 2.2 Create `src/modules/medical-records/lib/personal-notes-schemas.ts` — Zod schemas: `personalNotesPasswordSchema` (string min 6), `upsertPersonalNotesInputSchema` (patientId uuid, content string), `getPersonalNotesInputSchema` (patientId uuid, password optional string)
- [x] 2.3 Create `src/modules/medical-records/lib/mime-validator.ts` — `validateMimeType(buffer: Buffer, category: AttachmentCategory): { valid: boolean; detectedMime: string | undefined; detectedExt: string | undefined }` using `file-type` package magic-bytes detection; maps detected MIME against per-category allowlist
- [x] 2.4 Create `src/modules/medical-records/lib/filename-sanitizer.ts` — `sanitizeDisplayName(original: string): string` strips path separators (`/`, `\\`, `..`), control characters, and trims to 255 chars; `generateStorageFilename(ext: string): string` returns `${crypto.randomUUID()}.${ext}`
- [x] 2.5 **Unit test:** Create `src/__tests__/unit/modules/medical-records/lib/mime-validator.test.ts` — test: magic-bytes check rejects renamed .exe posing as .pdf; accepts real PDF; accepts real PNG for image category; rejects PNG for audio category; handles file with no detectable type gracefully
- [x] 2.6 **Unit test:** Create `src/__tests__/unit/modules/medical-records/lib/filename-sanitizer.test.ts` — test: path traversal stripped (`../../etc/passwd.pdf` -> `etcpasswd.pdf`); special characters handled; empty name returns fallback; 255+ char name truncated
- [x] 2.7 **Unit test:** Create `src/__tests__/unit/modules/medical-records/lib/attachment-schemas.test.ts` — test: category enum validates correct values, rejects invalid; file size boundary (50MB exact accepted, 50MB+1 rejected); patientId must be valid UUID
- [x] 2.8 **Unit test:** Create `src/__tests__/unit/modules/medical-records/lib/personal-notes-schemas.test.ts` — test: password min 6 chars accepted, 5 chars rejected; content string accepted; patientId UUID validated

## 3. Server Actions — Attachments

- [x] 3.1 Create `src/modules/medical-records/server/attachments.ts` with `uploadAttachment(patientId, formData)` — authenticates via getUser(), validates category + file size + MIME via magic bytes, checks consent for audio, generates UUID filename, uploads to `patient-attachments` bucket at `${userId}/${patientId}/${uuid}.${ext}`, persists `evolution_attachments` row, writes audit_log 'attachment.upload'
- [x] 3.2 Add `listAttachments(patientId, category?)` to attachments.ts — authenticates, queries evolution_attachments WHERE patient_id AND deleted_at IS NULL (optionally filtered by category), ordered by uploaded_at DESC
- [x] 3.3 Add `getAttachmentSignedUrl(attachmentId)` to attachments.ts — authenticates, verifies ownership via RLS query, generates 5-min signed URL via `supabase.storage.from('patient-attachments').createSignedUrl(path, 300)`, writes audit_log 'attachment.view-url'
- [x] 3.4 Add `deleteAttachment(attachmentId)` to attachments.ts — authenticates, verifies ownership, sets `deleted_at = now()` (UPDATE, not DELETE), writes audit_log 'attachment.delete'
- [x] 3.5 **Integration test:** Create `src/__tests__/integration/medical-records/attachments-crud.int.test.ts` — test: uploadAttachment persists row + storage object; listAttachments returns non-deleted items; getAttachmentSignedUrl returns time-bound URL; soft-deleted attachment hidden from list; audit_log entries written for upload, view-url, delete; RLS negative (psychologist B cannot list/sign-url psychologist A's attachments)
- [x] 3.6 **Integration test:** Create `src/__tests__/integration/medical-records/attachments-consent-gate.int.test.ts` — test: audio upload blocked when no active consent; audio upload succeeds with active consent; audio upload blocked when consent is revoked

## 4. Server Actions — Personal Notes

- [x] 4.1 Create `src/modules/medical-records/server/personal-notes.ts` with `getPersonalNotes(patientId, password?)` — authenticates via getUser(), queries personal_notes row; if no password_hash set returns content directly; if password_hash set: checks locked_until > now() (reject if locked), verifies password via argon2.verify(), on success resets failed_attempts and returns content with audit_log 'personal-notes.read', on failure increments failed_attempts (and sets locked_until if reaching 5) with audit_log 'personal-notes.password-failed'
- [x] 4.2 Add `upsertPersonalNotes(patientId, content)` to personal-notes.ts — authenticates, upserts personal_notes row (INSERT ON CONFLICT UPDATE on patient_id), writes audit_log 'personal-notes.update'
- [x] 4.3 Add `setPersonalNotesPassword(patientId, newPassword)` to personal-notes.ts — authenticates, validates password min length, hashes with argon2id (default params: memoryCost=65536, timeCost=3, parallelism=4), updates password_hash + resets failed_attempts to 0, writes audit_log 'personal-notes.password-set'
- [x] 4.4 Add `removePersonalNotesPassword(patientId, currentPassword)` to personal-notes.ts — authenticates, checks lockout, verifies current password via argon2, if correct: nulls password_hash + failed_attempts + locked_until, writes audit_log 'personal-notes.password-removed'; if wrong: increments failed_attempts (can trigger lockout)
- [x] 4.5 **Unit test:** Create `src/__tests__/unit/modules/medical-records/server/personal-notes-lockout.test.ts` — test lockout state machine in isolation: 5 failed attempts triggers lockout; verify locked_until set; subsequent reads rejected even with correct password while locked; after cooldown period, correct password succeeds and resets counter; wrong password after cooldown re-increments
- [x] 4.6 **Integration test:** Create `src/__tests__/integration/medical-records/personal-notes-crud.int.test.ts` — test: upsertPersonalNotes auto-saves (no password); getPersonalNotes returns content; setPersonalNotesPassword + getPersonalNotes with wrong password increments; 5x wrong -> lockout; during lockout correct password still rejected; after lockout window correct password succeeds and resets; RLS negative (psychologist B blocked from A's notes); audit_log entries for all actions
- [x] 4.7 **Unit test:** Create `src/__tests__/unit/modules/medical-records/lib/argon2-roundtrip.test.ts` — test: argon2id hash/verify roundtrip (hash then verify returns true; wrong password returns false; hash format starts with `$argon2id$`)

## 5. Module Barrel Update

- [x] 5.1 Update `src/modules/medical-records/index.ts` barrel to re-export: attachment actions (uploadAttachment, listAttachments, getAttachmentSignedUrl, deleteAttachment), personal notes actions (getPersonalNotes, upsertPersonalNotes, setPersonalNotesPassword, removePersonalNotesPassword), attachment schemas and types, personal notes schemas

## 6. Frontend — Attachments Tab

- [x] 6.1 Create `src/modules/medical-records/components/attachment-card.tsx` (Client Component) — Card with file icon (FileText for PDF, Image for images, Mic for audio, Paperclip default), display_name truncated, file size formatted ("1.2 MB"), category Badge, uploaded date, action buttons (eye for preview, Trash2 for delete)
- [x] 6.2 Create `src/modules/medical-records/components/attachment-upload-sheet.tsx` (Client Component) — Sheet (right side) with: dropzone area (drag-and-drop + click-to-pick), file type legend, "Max 50MB" helper text; category RadioGroup (Exame externo / Imagem / Desenho / Audio / Outro); if category=audio and no active consent: inline Alert warning variant with "Solicitar consentimento" link; progress bar during upload; Button primary "Anexar" disabled when blocked; Sonner toast on success/error
- [x] 6.3 Create `src/modules/medical-records/components/attachments-tab.tsx` (Client Component) — replaces EmptyTabPlaceholder for "Anexos" tab; header with h3 "Anexos" + Button primary "Anexar arquivo" (Paperclip icon); optional category filter Select; list of AttachmentCard items; inline preview (iframe for PDF, img for images with signed URLs); empty state (Upload icon, "Nenhum anexo", CTA); destructive Modal for delete confirmation with retention notice

## 7. Frontend — Personal Notes Tab

- [x] 7.1 Create `src/modules/medical-records/components/personal-notes-lock.tsx` (Client Component) — centered Card with Lock icon, "Notas protegidas" h4 heading; Input type password + Button "Desbloquear"; locked state shows countdown "Bloqueado por X minutos" (computed from lockedUntilIso); failed attempt shows "Senha incorreta. Tentativas restantes: N"
- [x] 7.2 Create `src/modules/medical-records/components/personal-notes-password-sheet.tsx` (Client Component) — Sheet with two modes: set (new password input + confirm + warning about no recovery) and remove (current password input + Button "Remover senha"); validation inline; Sonner toast on success
- [x] 7.3 Create `src/modules/medical-records/components/personal-notes-tab.tsx` (Client Component) — replaces EmptyTabPlaceholder for "Notas" tab; top banner (bg warning-50, text warning-700, Lock icon, regulatory text); if password set + not unlocked this session: renders PersonalNotesLock; once unlocked: Tiptap editor (same config reused from evolutions), auto-save indicator; footer links "Configurar senha extra" / "Remover senha extra" opening PersonalNotesPasswordSheet; info note about export exclusion
- [x] 7.4 Update `src/modules/medical-records/components/prontuario-tabs.tsx` — replace EmptyTabPlaceholder for "Anexos" tab with AttachmentsTab component; replace EmptyTabPlaceholder for "Notas" tab with PersonalNotesTab component; add Lock icon to "Notas" tab label

## 8. End-to-End Tests

- [x] 8.1 **E2E (Playwright, seeded):** Create `src/__tests__/e2e/seeded/prontuario/attachments-and-notes.spec.ts` — test: upload PDF -> assert preview iframe loads -> verify attachment in list; upload image -> assert inline preview; try upload audio without consent -> blocked UI shown with warning Alert; seed active consent term -> upload audio succeeds; soft-delete attachment -> confirm modal -> removed from list
- [x] 8.2 **E2E (Playwright, seeded):** Add personal notes tests to same spec file — test: set password -> reload -> lock screen shown -> type wrong password 5x -> assert lockout message with countdown; wait (or mock time) -> correct password -> content visible; personal notes write/auto-save persists across page reload; verify banner text present
