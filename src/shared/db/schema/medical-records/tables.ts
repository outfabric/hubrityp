import { sql } from 'drizzle-orm';
import {
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
  ],
);

export type DiagnosticHypothesis = typeof diagnosticHypotheses.$inferSelect;
export type NewDiagnosticHypothesis = typeof diagnosticHypotheses.$inferInsert;
