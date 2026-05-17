## Why

The prontuario shell (change #1) ships with "Anexos" and "Notas" tabs showing placeholder "Em breve" states. Psychologists need to (a) attach external files (exams, drawings, audio recordings) directly to a patient's prontuario with full audit trail and signed-URL access, and (b) keep private reflections in a password-protected area that is legally separated from the official prontuario (CFP 001/2009, art. 5). Audio attachments additionally require proof of signed gravacao consent (CFP 13/2022, RN-05.07) — this change enforces that gate at the upload boundary.

## What Changes

- New Drizzle tables `evolution_attachments` and `personal_notes` in `src/shared/db/schema/medical-records/tables.ts` with full RLS (owner-scoped, soft-delete for attachments)
- New private Supabase Storage bucket `patient-attachments` with per-user storage policies
- Server Actions for upload (MIME magic-bytes validation, 50MB limit, UUID filenames), list, signed-URL generation (5-min expiry), and soft-delete of attachments
- Server Actions for personal notes CRUD with optional argon2id password gate, 5-attempt lockout (15-min cooldown), and auto-save
- Audit log entries for all attachment and personal-notes operations (reusing the generic `audit_log` table from foundation change)
- Frontend: `AttachmentsTab` component replacing the placeholder, with category filter, inline preview (PDF/image), upload Sheet with dropzone, audio consent gate UI
- Frontend: `PersonalNotesTab` component replacing the placeholder, with regulatory banner, password lock screen, Tiptap editor, and password management Sheet
- New npm dependency: `argon2` (for personal notes password hashing)

## Capabilities

### New Capabilities
- `evolution-attachments`: File upload/list/view/delete with MIME validation, signed URLs, category classification, audio consent gate, soft delete, audit trail, and Supabase Storage integration
- `personal-notes`: Rich-text personal notes with optional argon2id password protection, lockout state machine, regulatory banner, auto-save, and explicit exclusion from default export

### Modified Capabilities
(none — no existing spec requirements change; the prontuario shell tab integration is an implementation detail of the foundation spec's EmptyTabPlaceholder replacement)

## Impact

- **Database:** 2 new tables + migration with RLS + indexes in `src/shared/db/schema/medical-records/`
- **Supabase Storage:** New private bucket `patient-attachments` with storage policies
- **Module:** `src/modules/medical-records/` gains `server/attachments.ts`, `server/personal-notes.ts`, `components/attachments-tab.tsx`, `components/personal-notes-tab.tsx`, `lib/attachment-schemas.ts`, `lib/personal-notes-schemas.ts`, `lib/mime-validator.ts`
- **Dependencies:** `argon2` npm package (native binding, requires build tooling in CI); `file-type` npm package for magic-bytes MIME detection (or equivalent pure-JS lib)
- **Routes:** No new routes — tabs render within existing `/pacientes/[id]/prontuario` page
- **External dependency:** `consent_terms` table (already exists in `src/shared/db/schema/patients/tables.ts`) — audio upload checks for active signed consent
- **Foundation dependency:** `audit_log` table and `logProntuarioAccess` server function from `prontuario-foundation-and-evolutions` change
- **Regulatory:** LGPD art. 11, CFP 001/2009 art. 5 (personal notes separation), CFP 13/2022 (audio consent gate), RN-05.03 (export exclusion), RN-05.04 (RLS isolation), RN-05.07 (consent verification)
- **Security:** Server-side MIME validation via magic bytes, UUID filenames (no path traversal), signed URL short expiry, argon2id slow hash with lockout, audit trail on every operation
