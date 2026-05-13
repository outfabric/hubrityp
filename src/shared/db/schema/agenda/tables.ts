import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// `locations` stores physical or virtual consultation locations belonging to a
// psychologist. Each location has a type (in_person, online, or other) and an
// optional color for calendar rendering. The `is_default` flag marks the
// psychologist's preferred location — uniqueness of the default is enforced at
// the Server Action level (not via DB constraint) so that switching the default
// is a simple two-step update rather than a deferred-constraint dance.
//
// RLS policies enforce owner-scoped access via `user_id = auth.uid()`.
export const locations = pgTable('locations', {
  id: uuid('id').primaryKey().defaultRandom(),

  // FK to `auth.users`. Cross-schema reference emitted manually in migration.
  userId: uuid('user_id').notNull(),

  name: varchar('name', { length: 120 }).notNull(),
  address: text('address'),

  // CHECK constraint in migration: type IN ('in_person', 'online', 'other')
  type: text('type').notNull(),

  color: varchar('color', { length: 7 }),
  arrivalInstructions: text('arrival_instructions'),
  isDefault: boolean('is_default').notNull().default(false),

  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type Location = typeof locations.$inferSelect;
export type NewLocation = typeof locations.$inferInsert;

// `agenda_settings` stores per-psychologist scheduling preferences. It has a
// 1:1 relationship with `auth.users` enforced via `user_id` as the PK.
// Business hours are stored as a JSONB array of day/start/end objects —
// flexible enough to support custom working days while keeping the schema flat.
//
// The default business hours cover Mon-Fri 08:00-20:00 and Sat 08:00-12:00,
// matching the typical Brazilian psychologist schedule.
//
// RLS policies enforce owner-scoped access via `user_id = auth.uid()`.
export const agendaSettings = pgTable('agenda_settings', {
  // PK + FK to `auth.users`. Cross-schema reference emitted manually.
  userId: uuid('user_id').primaryKey(),

  defaultDurationMinutes: integer('default_duration_minutes').notNull().default(50),
  intervalMinutes: integer('interval_minutes').notNull().default(10),

  businessHours: jsonb('business_hours')
    .notNull()
    .default(
      sql`'[{"day":1,"start":"08:00","end":"20:00"},{"day":2,"start":"08:00","end":"20:00"},{"day":3,"start":"08:00","end":"20:00"},{"day":4,"start":"08:00","end":"20:00"},{"day":5,"start":"08:00","end":"20:00"},{"day":6,"start":"08:00","end":"12:00"}]'::jsonb`,
    ),

  cancellationPolicy: text('cancellation_policy'),
  defaultColor: varchar('default_color', { length: 7 }),

  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type AgendaSettings = typeof agendaSettings.$inferSelect;
export type NewAgendaSettings = typeof agendaSettings.$inferInsert;

// `session_recurrences` defines a repeating schedule template for sessions.
// A psychologist creates a recurrence to auto-generate sessions on a regular
// cadence (weekly, biweekly, monthly, or custom). The `patient_id` links to
// the patient involved in the recurrence — for couple sessions, the
// individual sessions carry a `patient_ids` array instead.
//
// The recurrence can be bounded by `end_date`, `occurrence_count`, or left
// open-ended (`is_indefinite = TRUE`). `days_of_week` is an INT[] where
// 0 = Sunday through 6 = Saturday (JS Date convention).
//
// RLS policies enforce owner-scoped access via `user_id = auth.uid()`.
export const sessionRecurrences = pgTable('session_recurrences', {
  id: uuid('id').primaryKey().defaultRandom(),

  // FK to `auth.users`. Cross-schema reference emitted manually in migration.
  userId: uuid('user_id').notNull(),

  // FK to `patients`. Nullable — may not be assigned at creation.
  patientId: uuid('patient_id'),

  // CHECK constraint in migration: frequency IN ('weekly', 'biweekly', 'monthly', 'custom')
  frequency: varchar('frequency', { length: 20 }).notNull(),

  // Days of the week the recurrence applies to (0=Sun … 6=Sat).
  daysOfWeek: integer('days_of_week').array(),

  startDate: date('start_date', { mode: 'string' }).notNull(),
  endDate: date('end_date', { mode: 'string' }),

  occurrenceCount: integer('occurrence_count'),
  isIndefinite: boolean('is_indefinite').notNull().default(false),

  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type SessionRecurrence = typeof sessionRecurrences.$inferSelect;
export type NewSessionRecurrence = typeof sessionRecurrences.$inferInsert;

// `sessions` is the core scheduling table. Each row represents either a
// patient appointment or a blocking slot (e.g., lunch break, personal time).
// Blocking slots have `is_blocking = true` and use `blocking_title` instead
// of a patient reference.
//
// All timestamps are stored in UTC; display conversion to America/Sao_Paulo
// happens in the presentation layer.
//
// `amount` is stored as text for decimal safety — avoiding floating-point
// representation issues with Brazilian currency values.
//
// `recurrence_id` references `session_recurrences(id)` when the session was
// generated from a recurrence template. `patient_ids` is a UUID[] column for
// couple sessions (max 2 entries enforced by CHECK constraint). `is_late_record`
// flags sessions recorded after the fact for billing/audit.
//
// Composite indexes support the two most common query patterns:
// - (user_id, start_at) for time-window calendar queries (<800ms target)
// - (patient_id, start_at DESC) for patient session history
// - (status, start_at) for filtered views (e.g., "all scheduled sessions")
//
// RLS policies enforce owner-scoped access via `user_id = auth.uid()`.
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // FK to `auth.users`. Cross-schema reference emitted manually in migration.
    userId: uuid('user_id').notNull(),

    // FK to `patients`. Nullable because blocking slots have no patient.
    patientId: uuid('patient_id'),

    // FK to `session_recurrences(id)`. Nullable — only set for sessions
    // generated from a recurrence template.
    recurrenceId: uuid('recurrence_id'),

    // UUID[] for couple sessions (max 2 entries, CHECK constraint in migration).
    // For standard sessions, use `patient_id` instead. Both coexist:
    // `patient_id` is the primary FK for single-patient sessions;
    // `patient_ids` is populated only for couple sessions.
    patientIds: uuid('patient_ids').array(),

    // Late-recorded sessions are flagged for billing/audit purposes.
    isLateRecord: boolean('is_late_record').notNull().default(false),

    isBlocking: boolean('is_blocking').notNull().default(false),
    blockingTitle: varchar('blocking_title', { length: 120 }),

    startAt: timestamp('start_at', { withTimezone: true, mode: 'date' }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true, mode: 'date' }).notNull(),
    durationMinutes: integer('duration_minutes').notNull(),

    // FK to `locations`. Nullable — a session may not have a fixed location.
    locationId: uuid('location_id'),

    // CHECK constraint in migration: modality IN ('in_person', 'online')
    modality: text('modality'),

    // Stored as text for decimal safety (BRL currency values).
    amount: text('amount'),

    notes: text('notes'),
    color: varchar('color', { length: 7 }),

    // CHECK constraint enforced in Drizzle schema (see `check()` below):
    // status IN ('scheduled', 'confirmed', 'done', 'cancelled', 'no_show')
    status: text('status').notNull().default('scheduled'),

    // -- Cancellation fields --------------------------------------------------
    cancellationReason: varchar('cancellation_reason', { length: 50 }),
    cancelledBy: varchar('cancelled_by', { length: 20 }),
    cancellationNotice: varchar('cancellation_notice', { length: 20 }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    chargeCancellation: boolean('charge_cancellation').default(false),

    // -- Confirmation fields --------------------------------------------------
    confirmationToken: varchar('confirmation_token', { length: 64 }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),

    // -- Reschedule fields ----------------------------------------------------
    // Self-referencing FKs: emitted manually in migration.
    rescheduledToSessionId: uuid('rescheduled_to_session_id'),
    rescheduledFromSessionId: uuid('rescheduled_from_session_id'),

    // -- Reminders opt-out per session ----------------------------------------
    // When TRUE, no WhatsApp reminders are sent for this specific session.
    remindersDisabled: boolean('reminders_disabled').default(false),

    // -- Soft-delete (RN-03.05: never hard-delete sessions) -------------------
    deletedAt: timestamp('deleted_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // Time-window calendar queries: "all sessions for this user in date range"
    index('sessions_user_id_start_at_idx').on(table.userId, table.startAt),
    // Patient session history: "all sessions for this patient, newest first"
    index('sessions_patient_id_start_at_idx').on(table.patientId, table.startAt),
    // Filtered views: "all scheduled/done sessions in a time range"
    index('sessions_status_start_at_idx').on(table.status, table.startAt),
    // Recurrence lookup: "all sessions belonging to a recurrence template"
    index('idx_sessions_recurrence').on(table.recurrenceId),

    // Status CHECK — enforces the valid session lifecycle states at DB level.
    check(
      'sessions_status_check',
      sql`${table.status} IN ('scheduled', 'confirmed', 'done', 'cancelled', 'no_show')`,
    ),

    // Partial UNIQUE on confirmation_token — only non-NULL tokens must be unique.
    uniqueIndex('sessions_confirmation_token_unique_idx')
      .on(table.confirmationToken)
      .where(sql`${table.confirmationToken} IS NOT NULL`),
  ],
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

// `session_history` is an append-only audit log that records every mutation
// to a session row. Each entry captures the action type and a JSONB snapshot
// of what changed (old → new values). This supports the "session timeline"
// feature and provides a defensible audit trail.
//
// ON DELETE CASCADE ensures history is cleaned up when a session is removed.
//
// RLS policies enforce owner-scoped access via `user_id = auth.uid()`.
export const sessionHistory = pgTable(
  'session_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // FK to `sessions`. ON DELETE CASCADE emitted manually in migration.
    sessionId: uuid('session_id').notNull(),

    // FK to `auth.users`. Cross-schema reference emitted manually in migration.
    userId: uuid('user_id').notNull(),

    // CHECK constraint in migration:
    // action IN ('created', 'updated', 'rescheduled', 'status_changed', 'deleted')
    action: text('action').notNull(),

    changes: jsonb('changes')
      .notNull()
      .default(sql`'{}'::jsonb`),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // Session timeline: "all history entries for this session, newest first"
    index('session_history_session_id_created_at_idx').on(table.sessionId, table.createdAt),
  ],
);

export type SessionHistory = typeof sessionHistory.$inferSelect;
export type NewSessionHistory = typeof sessionHistory.$inferInsert;
