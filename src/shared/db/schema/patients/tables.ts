import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// `patients` is the core domain table for the patient module. It stores all
// demographic and administrative data for patients belonging to a given
// psychologist. The table is owner-scoped via RLS — every row is tied to a
// single `user_id` (the psychologist's `auth.users.id`), and the four
// canonical policies (SELECT, INSERT, UPDATE, DELETE) enforce that only the
// owner can access their patients.
//
// Nullable columns follow the PRD: only `full_name` and `patient_type` are
// required at creation time (2-step form: essentials first, details later).
//
// Future changes will add related tables (guardians, anamnesis, consent_terms)
// that reference `patients.id` — the schema is designed to be extensible
// without breaking changes.
export const patients = pgTable(
  'patients',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // FK to `auth.users`. The cross-schema reference is emitted manually in
    // the migration (same pattern as profiles.user_id, health_pings.owner_id).
    userId: uuid('user_id').notNull(),

    // --- Essential fields (required at creation) ---
    fullName: varchar('full_name', { length: 200 }).notNull(),
    patientType: text('patient_type').notNull().default('individual'),

    // --- Demographics (optional) ---
    birthDate: timestamp('birth_date', { withTimezone: true, mode: 'date' }),
    approximateAge: text('approximate_age'),
    gender: text('gender'),

    // --- Contact (optional) ---
    phone: varchar('phone', { length: 20 }),
    email: varchar('email', { length: 255 }),

    // --- Documents (optional) ---
    cpf: varchar('cpf', { length: 14 }),

    // --- Address (optional, stored as JSON-like text for flexibility) ---
    address: text('address'),

    // --- Professional/social (optional) ---
    profession: varchar('profession', { length: 100 }),
    maritalStatus: text('marital_status'),
    source: text('source'),

    // --- Tags (free-form array, normalized to lowercase before insert) ---
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    // --- Photo (path in Supabase Storage bucket `patient-photos`) ---
    photoPath: text('photo_path'),

    // --- Clinical notes (free-form) ---
    notes: text('notes'),

    // --- Status lifecycle ---
    status: text('status').notNull().default('active'),

    // --- Consent tracking ---
    consentSignedAt: timestamp('consent_signed_at', { withTimezone: true }),
    consentRevokedAt: timestamp('consent_revoked_at', { withTimezone: true }),

    // --- Couple linking (for future `patient-guardians-and-couples` change) ---
    coupleId: uuid('couple_id'),

    // --- Timestamps ---
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    // Compound index for the most common query: "all active patients for this
    // psychologist". Covers the listPatients Server Action's default filter.
    index('patients_user_id_status_idx').on(table.userId, table.status),
  ],
);

export type Patient = typeof patients.$inferSelect;
export type NewPatient = typeof patients.$inferInsert;

// `patient_guardians` stores legal guardians for minor patients. Each guardian
// is linked to a single patient via `patient_id` (FK with ON DELETE CASCADE).
// The table has no `user_id` column — RLS policies use a subquery to check
// that the guardian's patient belongs to the authenticated psychologist:
//   `patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid())`
export const patientGuardians = pgTable(
  'patient_guardians',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // FK to `patients.id`, set manually in migration with ON DELETE CASCADE.
    patientId: uuid('patient_id').notNull(),

    // --- Guardian details ---
    fullName: varchar('full_name', { length: 200 }).notNull(),
    relationship: text('relationship').notNull(),
    cpf: varchar('cpf', { length: 14 }),
    phone: varchar('phone', { length: 20 }),
    email: varchar('email', { length: 255 }),
    isPrimary: boolean('is_primary').notNull().default(false),

    // --- Timestamps ---
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // Index for the most common query: "all guardians for a given patient".
    index('patient_guardians_patient_id_idx').on(table.patientId),
  ],
);

export type PatientGuardian = typeof patientGuardians.$inferSelect;
export type NewPatientGuardian = typeof patientGuardians.$inferInsert;

// `anamnesis` stores the clinical intake record for a patient. It has a 1:1
// relationship with `patients` enforced by a UNIQUE constraint on `patient_id`.
// Standard clinical sections (chief complaint, history of present illness, etc.)
// are modeled as individual TEXT columns for query-ability and type safety.
// The `custom_sections` JSONB column allows psychologists to add free-form
// sections beyond the predefined ones.
//
// The table has no `user_id` column — RLS policies use a subquery to check
// that the anamnesis's patient belongs to the authenticated psychologist:
//   `patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid())`
//
// This table stores sensitive clinical data protected under LGPD art. 11.
export const anamnesis = pgTable(
  'anamnesis',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // FK to `patients.id`, set manually in migration with ON DELETE CASCADE.
    // UNIQUE constraint enforces the 1:1 relationship.
    patientId: uuid('patient_id').notNull(),

    // --- Standard clinical sections (all optional, filled progressively) ---
    chiefComplaint: text('chief_complaint'),
    historyPresentIllness: text('history_present_illness'),
    familyHistory: text('family_history'),
    educationalProfessional: text('educational_professional'),
    physicalHealth: text('physical_health'),
    priorTherapy: text('prior_therapy'),
    initialHypothesis: text('initial_hypothesis'),
    treatmentPlan: text('treatment_plan'),

    // --- Custom sections (free-form JSONB for psychologist-defined sections) ---
    customSections: jsonb('custom_sections'),

    // --- Timestamps ---
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // UNIQUE constraint on patient_id enforces 1:1 relationship.
    unique('anamnesis_patient_id_unique').on(table.patientId),
  ],
);

export type Anamnesis = typeof anamnesis.$inferSelect;
export type NewAnamnesis = typeof anamnesis.$inferInsert;
