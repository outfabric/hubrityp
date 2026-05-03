import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

// `psychologist_profiles` is the canonical owner-scoped profile table. Each
// row is uniquely keyed by the Supabase Auth `user_id` (PK + FK to
// `auth.users`), so `user_id` plays the role of `owner_id` in the project-wide
// RLS template (see `src/shared/db/migrations/README.md`).
//
// The CHECK constraint on `status` enforces the five-state account lifecycle
// at the database level — invalid states are rejected even if a buggy code
// path tries to write them. The UNIQUE constraint on (crp_number, crp_uf)
// implements business rule RN-01.02 ("uma inscrição CRP só pode pertencer a
// um único psicólogo na plataforma"). Keeping the rule in the database
// guarantees it survives any code path that tries to skip the application
// check.
//
// RLS policies live in `./policies.ts` and are appended manually to the
// generated migration (Drizzle has no first-class RLS DSL).
export const psychologistProfiles = pgTable(
  'psychologist_profiles',
  {
    userId: uuid('user_id').primaryKey(),
    fullName: text('full_name').notNull(),
    crpNumber: text('crp_number').notNull(),
    crpUf: text('crp_uf').notNull(),
    status: text('status').notNull(),
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }).notNull(),
    privacyAcceptedAt: timestamp('privacy_accepted_at', { withTimezone: true }).notNull(),
    sensitiveDataConsentAt: timestamp('sensitive_data_consent_at', {
      withTimezone: true,
    }).notNull(),
    termsVersion: text('terms_version').notNull(),
    privacyVersion: text('privacy_version').notNull(),
    sensitiveDataConsentVersion: text('sensitive_data_consent_version').notNull(),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    // RN-01.02: a single CRP registration can only belong to one psychologist
    // on the platform. Enforced at the DB level so the invariant survives
    // even if the Server Action that normally checks it is bypassed.
    uniqueCrp: unique('psychologist_profiles_crp_number_crp_uf_key').on(
      table.crpNumber,
      table.crpUf,
    ),
    // The five-state account lifecycle. Any other value MUST be rejected.
    statusCheck: check(
      'psychologist_profiles_status_check',
      sql`${table.status} IN ('pending_verification', 'pending_crp_validation', 'active', 'suspended', 'cancelled')`,
    ),
  }),
);

export type PsychologistProfile = typeof psychologistProfiles.$inferSelect;
export type NewPsychologistProfile = typeof psychologistProfiles.$inferInsert;
