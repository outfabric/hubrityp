import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// `evolutions` stores clinical evolution records (prontuario) belonging to a
// psychologist. Each evolution is tied to a patient and optionally to a session.
// The `session_id` column has a UNIQUE constraint to enforce 1:1 relationship
// (one evolution per session). Content is stored as structured JSONB following
// the template type schema.
//
// RLS policies enforce owner-scoped access via `user_id = auth.uid()`.
// NO DELETE policy — Lei 13.787/2018 mandates 20-year clinical record retention.
export const evolutions = pgTable(
  'evolutions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // FK to `auth.users`. Cross-schema reference emitted manually in migration.
    userId: uuid('user_id').notNull(),

    // FK to `patients(id)`. Emitted manually in migration.
    patientId: uuid('patient_id').notNull(),

    // FK to `sessions(id)`, UNIQUE. Emitted manually in migration.
    sessionId: uuid('session_id'),

    templateType: text('template_type').notNull(),
    content: jsonb('content').notNull(),
    currentVersion: integer('current_version').notNull().default(1),

    // True when the initial content of this evolution originated from an AI
    // transcription (the psychologist reviewed and saved an AI-generated note).
    aiAssisted: boolean('ai_assisted').notNull().default(false),

    // Backlink to the source `ai_transcriptions` row, when applicable. FK with
    // ON DELETE SET NULL is emitted manually in the migration (cross-table FKs
    // in this repo are appended by hand, not via Drizzle `.references()`), so
    // deleting a transcription nulls this column without dropping the evolution.
    aiTranscriptionId: uuid('ai_transcription_id'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_evolutions_patient_created').on(table.patientId, table.createdAt),
    // Supports audit/statistics queries: "AI-assisted evolutions for this user".
    index('idx_evolutions_user_ai_assisted').on(table.userId, table.aiAssisted),
    unique('evolutions_session_id_unique').on(table.sessionId),
  ],
);

export type Evolution = typeof evolutions.$inferSelect;
export type NewEvolution = typeof evolutions.$inferInsert;

// `evolution_versions` stores immutable version snapshots of an evolution.
// Each version is linked to its parent evolution via `evolution_id` (FK with
// ON DELETE CASCADE). The combination (evolution_id, version_number) is UNIQUE.
//
// RLS policies use a JOIN-scoped subquery checking the parent evolution's
// `user_id`. NO DELETE policy — immutable version trail per Lei 13.787/2018.
export const evolutionVersions = pgTable(
  'evolution_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // FK to `evolutions(id)` ON DELETE CASCADE. Emitted manually in migration.
    evolutionId: uuid('evolution_id').notNull(),

    versionNumber: integer('version_number').notNull(),
    content: jsonb('content').notNull(),
    isAddendum: boolean('is_addendum').notNull().default(false),

    // FK to `auth.users`. Cross-schema reference emitted manually in migration.
    modifiedBy: uuid('modified_by').notNull(),

    reason: text('reason'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('idx_evolution_versions_evolution').on(table.evolutionId, table.versionNumber),
    unique('evolution_versions_evo_version_unique').on(table.evolutionId, table.versionNumber),
  ],
);

export type EvolutionVersion = typeof evolutionVersions.$inferSelect;
export type NewEvolutionVersion = typeof evolutionVersions.$inferInsert;

// `audit_log` stores an immutable trail of security/clinical-relevant actions.
// Written exclusively by service-role (Server Actions, Inngest jobs) — no
// INSERT/UPDATE/DELETE policies for authenticated users. Users can only SELECT
// their own entries.
//
// The `ip_address` column stores inet as text for Drizzle compatibility.
// `metadata` is a JSONB bag for action-specific context (never PII).
//
// NO INSERT/UPDATE/DELETE policy — service-role writes only, immutable trail.
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // FK to `auth.users`. Cross-schema reference emitted manually in migration.
    userId: uuid('user_id').notNull(),

    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id'),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    ipAddress: text('ip_address'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('idx_audit_log_user_created').on(table.userId, table.createdAt),
    index('idx_audit_log_resource').on(table.resourceType, table.resourceId),
  ],
);

export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;

// `diagnostic_hypotheses` stores clinical diagnostic hypotheses linked to a
// patient. Each hypothesis requires at least one of `description` (free-text)
// or `cid10_code` (CID-10 catalog reference) via a CHECK constraint.
// Status tracks the lifecycle: 'investigating' → 'confirmed' or 'discarded'.
//
// RLS policies enforce owner-scoped access via `user_id = auth.uid()`.
// NO DELETE policy — Lei 13.787/2018 mandates retention; "discard" is a
// status transition, not a hard delete.
export const diagnosticHypotheses = pgTable(
  'diagnostic_hypotheses',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // FK to `auth.users`. Cross-schema reference emitted manually in migration.
    userId: uuid('user_id').notNull(),

    // FK to `patients(id)`. Emitted manually in migration.
    patientId: uuid('patient_id').notNull(),

    description: text('description'), // free-text hypothesis
    cid10Code: varchar('cid10_code', { length: 10 }), // e.g. 'F32.0'
    cid10Description: text('cid10_description'), // official description

    // CHECK constraint in migration: status IN ('investigating','confirmed','discarded')
    status: text('status').notNull().default('investigating'),

    notes: text('notes'), // optional observation / discard reason

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('idx_diagnostic_hypotheses_patient_status_created').on(
      table.patientId,
      table.status,
      table.createdAt,
    ),
    index('idx_diagnostic_hypotheses_user_id').on(table.userId),
  ],
);

export type DiagnosticHypothesis = typeof diagnosticHypotheses.$inferSelect;
export type NewDiagnosticHypothesis = typeof diagnosticHypotheses.$inferInsert;

// `treatment_plans` stores the current treatment plan for a patient.
// Each patient has at most one treatment plan (UNIQUE on patient_id).
// The plan contains goals, phases, resources, and success criteria.
//
// RLS policies enforce owner-scoped access via `user_id = auth.uid()`.
// NO DELETE policy — Lei 13.787/2018 mandates 20-year clinical record retention.
export const treatmentPlans = pgTable(
  'treatment_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // FK to `auth.users`. Cross-schema reference emitted manually in migration.
    userId: uuid('user_id').notNull(),

    // FK to `patients(id)`, UNIQUE (one plan per patient). Emitted manually in migration.
    patientId: uuid('patient_id').notNull(),

    goals: jsonb('goals')
      .notNull()
      .default(sql`'[]'::jsonb`),
    phases: jsonb('phases')
      .notNull()
      .default(sql`'[]'::jsonb`),
    resources: text('resources'), // Tiptap HTML string
    successCriteria: text('success_criteria'), // Tiptap HTML string
    currentVersion: integer('current_version').notNull().default(1),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    unique('treatment_plans_patient_id_unique').on(table.patientId),
    index('idx_treatment_plans_user_id').on(table.userId),
  ],
);

export type TreatmentPlan = typeof treatmentPlans.$inferSelect;
export type NewTreatmentPlan = typeof treatmentPlans.$inferInsert;

// `treatment_plan_versions` stores immutable version snapshots of a treatment plan.
// Each version is linked to its parent plan via `plan_id` (FK with ON DELETE CASCADE).
// The combination (plan_id, version_number) is UNIQUE.
//
// RLS policies use a JOIN-scoped subquery checking the parent plan's `user_id`.
// NO DELETE policy — immutable version trail per Lei 13.787/2018.
export const treatmentPlanVersions = pgTable(
  'treatment_plan_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // FK to `treatment_plans(id)` ON DELETE CASCADE. Emitted manually in migration.
    planId: uuid('plan_id').notNull(),

    versionNumber: integer('version_number').notNull(),
    content: jsonb('content').notNull(), // Full snapshot {goals, phases, resources, successCriteria}

    // FK to `auth.users`. Cross-schema reference emitted manually in migration.
    modifiedBy: uuid('modified_by').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    unique('treatment_plan_versions_plan_version_unique').on(table.planId, table.versionNumber),
    index('idx_treatment_plan_versions_plan_desc').on(table.planId, table.versionNumber),
  ],
);

export type TreatmentPlanVersion = typeof treatmentPlanVersions.$inferSelect;
export type NewTreatmentPlanVersion = typeof treatmentPlanVersions.$inferInsert;

// `scale_applications` stores standardized psychological scale/questionnaire
// applications linked to a patient. Each row represents a single administration
// of a validated instrument (PHQ-9, GAD-7, SDQ, AUDIT, WHOQOL-BREF).
// The `scale_key` column is constrained via a CHECK to the supported instrument
// set. `remote_token` enables patient self-report: if `applied_remotely` is
// true, a unique token is generated so the patient can complete the scale via a
// public link.
//
// RLS policies enforce owner-scoped access via `user_id = auth.uid()`.
// NO DELETE policy — Lei 13.787/2018 mandates 20-year clinical record retention.
export const scaleApplications = pgTable(
  'scale_applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // FK to `auth.users`. Cross-schema reference emitted manually in migration.
    userId: uuid('user_id').notNull(),

    // FK to `patients(id)`. Emitted manually in migration.
    patientId: uuid('patient_id').notNull(),

    // CHECK constraint in migration: scale_key IN ('phq9','gad7','sdq','audit','whoqol-bref')
    scaleKey: text('scale_key').notNull(),

    appliedAt: timestamp('applied_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    responses: jsonb('responses')
      .notNull()
      .default(sql`'{}'::jsonb`),
    totalScore: integer('total_score'),
    classification: text('classification'),
    notes: text('notes'),

    appliedRemotely: boolean('applied_remotely').notNull().default(false),
    remoteToken: varchar('remote_token', { length: 64 }), // UNIQUE WHERE NOT NULL
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('idx_scale_apps_patient_scale_applied').on(
      table.patientId,
      table.scaleKey,
      table.appliedAt,
    ),
    unique('scale_applications_remote_token_unique').on(table.remoteToken),
  ],
);

export type ScaleApplication = typeof scaleApplications.$inferSelect;
export type NewScaleApplication = typeof scaleApplications.$inferInsert;

// `evolution_attachments` stores file attachments associated with a patient's
// prontuario. Each attachment is tied to a psychologist (`user_id`) and a
// patient, and optionally linked to a specific evolution record. Files are
// stored in Supabase Storage under a `patient-attachments` bucket with the
// path convention `${user_id}/${patient_id}/${uuid}.${ext}`.
//
// A CHECK constraint on `category` limits values to the allowed set.
// Soft-delete via `deleted_at` — physical deletion is prohibited per
// Lei 13.787/2018 (20-year retention). A future Inngest cron handles cleanup.
//
// RLS policies enforce owner-scoped access via `user_id = auth.uid()`.
// NO DELETE policy — retention mandate.
export const evolutionAttachments = pgTable(
  'evolution_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // FK to `auth.users`. Cross-schema reference emitted manually in migration.
    userId: uuid('user_id').notNull(),

    // FK to `patients(id)`. Emitted manually in migration.
    patientId: uuid('patient_id').notNull(),

    // FK to `evolutions(id)`, nullable. Emitted manually in migration.
    evolutionId: uuid('evolution_id'),

    fileName: text('file_name').notNull(), // Server-generated UUID + ext
    displayName: text('display_name').notNull(), // Original user-supplied name, sanitized
    fileSize: bigint('file_size', { mode: 'number' }).notNull(),
    mimeType: text('mime_type').notNull(),
    storagePath: text('storage_path').notNull(), // Full path in bucket

    // CHECK constraint in migration: category IN ('exam','image','drawing','audio','other')
    category: text('category').notNull(),

    consentVerified: boolean('consent_verified').notNull().default(false),

    uploadedAt: timestamp('uploaded_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }), // Soft delete
  },
  (table) => [
    index('idx_attachments_patient_uploaded').on(table.patientId, table.uploadedAt),
    index('idx_attachments_user_id').on(table.userId), // For RLS predicate performance
  ],
);

export type EvolutionAttachment = typeof evolutionAttachments.$inferSelect;
export type NewEvolutionAttachment = typeof evolutionAttachments.$inferInsert;

// `personal_notes` stores private reflections by the psychologist for a
// specific patient. These notes are legally separated from the official
// prontuario (CFP 001/2009, art. 5) and excluded from default exports
// (RN-05.03). Each patient has at most one personal notes row (UNIQUE on
// `patient_id`).
//
// Optional argon2id password protection with a lockout state machine:
// 5 failed attempts -> 15-minute cooldown per patient_id. The password is a
// UX-level privacy gate, not a cryptographic control — content is not
// encrypted at rest.
//
// RLS policies enforce owner-scoped access via `user_id = auth.uid()`.
// NO DELETE policy — retention mandate per Lei 13.787/2018.
export const personalNotes = pgTable(
  'personal_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // FK to `auth.users`. Cross-schema reference emitted manually in migration.
    userId: uuid('user_id').notNull(),

    // FK to `patients(id)`, UNIQUE (1:1). Emitted manually in migration.
    patientId: uuid('patient_id').notNull(),

    content: text('content'), // Rich text (HTML from Tiptap)
    passwordHash: text('password_hash'), // argon2id hash, nullable

    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),

    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    unique('personal_notes_patient_id_unique').on(table.patientId),
    index('idx_personal_notes_user_id').on(table.userId), // For RLS predicate performance
  ],
);

export type PersonalNote = typeof personalNotes.$inferSelect;
export type NewPersonalNote = typeof personalNotes.$inferInsert;

// `clinical_documents` stores formal clinical documents issued by the
// psychologist for a patient: declaracao, atestado, relatorio, laudo, parecer
// (per CFP Resolution 06/2019). Each document goes through a draft → finalized
// lifecycle. Once finalized, the UPDATE RLS policy blocks further edits
// (USING clause requires status = 'draft'), enforcing immutability at the
// Postgres level.
//
// The `content` column stores structured JSONB per document type. After PDF
// generation, `pdf_storage_path` and `pdf_size` are set. CID-10 references
// require explicit patient consent (`cid10_consent_confirmed`).
//
// RLS policies enforce owner-scoped access via `user_id = auth.uid()`.
// NO DELETE policy — Lei 13.787/2018 mandates 20-year clinical record retention.
export const clinicalDocuments = pgTable(
  'clinical_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // FK to `auth.users`. Cross-schema reference emitted manually in migration.
    userId: uuid('user_id').notNull(),

    // FK to `patients(id)`. Emitted manually in migration.
    patientId: uuid('patient_id').notNull(),

    // CHECK constraint in migration: document_type IN ('declaracao','atestado','relatorio','laudo','parecer')
    documentType: text('document_type').notNull(),

    title: text('title').notNull().default(''),
    content: jsonb('content')
      .notNull()
      .default(sql`'{}'::jsonb`),

    pdfStoragePath: text('pdf_storage_path'), // Set after PDF generation
    pdfSize: integer('pdf_size'), // Bytes

    digitallySigned: boolean('digitally_signed').notNull().default(false),
    // CHECK constraint in migration: signature_method IN ('icp-brasil','manual') or NULL
    signatureMethod: text('signature_method'),

    // CHECK constraint in migration: status IN ('draft','finalized')
    status: text('status').notNull().default('draft'),

    referencesCid10: boolean('references_cid10').notNull().default(false),
    cid10ConsentConfirmed: boolean('cid10_consent_confirmed').notNull().default(false),

    finalizedAt: timestamp('finalized_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('idx_clinical_docs_patient_type_created').on(
      table.patientId,
      table.documentType,
      table.createdAt,
    ),
    index('idx_clinical_docs_status_finalized').on(table.status, table.finalizedAt),
    index('idx_clinical_docs_user_id').on(table.userId),
  ],
);

export type ClinicalDocument = typeof clinicalDocuments.$inferSelect;
export type NewClinicalDocument = typeof clinicalDocuments.$inferInsert;

// `prontuario_exports` tracks asynchronous PDF export requests for a
// patient's full prontuario. Each row represents a single export job that
// progresses through a state machine: pending → processing → ready | failed
// → expired. The Inngest job updates status via service-role; authenticated
// users can only SELECT their own rows and INSERT new requests.
//
// RLS policies enforce owner-scoped access via `user_id = auth.uid()`.
// NO UPDATE/DELETE policy for authenticated users — status transitions are
// managed exclusively by service-role (Inngest job, expiry cron).
// CHECK constraint on `status` is added in the migration SQL.
export const prontuarioExports = pgTable(
  'prontuario_exports',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // FK to `auth.users`. Cross-schema reference emitted manually in migration.
    userId: uuid('user_id').notNull(),

    // FK to `patients(id)`. Emitted manually in migration.
    patientId: uuid('patient_id').notNull(),

    // CHECK constraint in migration: status IN ('pending','processing','ready','failed','expired')
    status: text('status').notNull().default('pending'),

    filters: jsonb('filters').notNull(), // ExportFiltersSchema

    storagePath: text('storage_path'), // Set on completion
    fileSize: bigint('file_size', { mode: 'number' }), // Bytes, set on completion
    errorMessage: text('error_message'), // Set on failure (sanitized, no PII)

    expiresAt: timestamp('expires_at', { withTimezone: true }), // Set on completion
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_prontuario_exports_user_created').on(table.userId, table.createdAt),
    index('idx_prontuario_exports_status_expires').on(table.status, table.expiresAt),
  ],
);

export type ProntuarioExport = typeof prontuarioExports.$inferSelect;
export type NewProntuarioExport = typeof prontuarioExports.$inferInsert;
