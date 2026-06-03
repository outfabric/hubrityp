import { sql } from 'drizzle-orm';
import { boolean, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

// `onboarding_checklist` and `notification_preferences` are the
// onboarding-domain tables introduced by the `onboarding-data-model` change.
// Each is a child of `auth.users` (the Supabase-managed identity table, which
// lives in the `auth` schema and is therefore NOT modeled as a Drizzle table
// here). The FK from `user_id` to `auth.users(id)` is emitted as raw SQL by
// the migration (Drizzle cannot express cross-schema references) — same
// pattern as `profiles.user_id` and `ai_transcription_settings.user_id`.
//
// Both tables are owner-scoped via RLS: exactly one row per psychologist,
// enforced by a UNIQUE constraint on `user_id`. Policies live in
// `src/shared/db/schema/onboarding/policies.ts` (SELECT/INSERT/UPDATE only —
// no DELETE policy, a least-privilege choice).

// `onboarding_checklist` tracks the MVP onboarding checklist for each
// psychologist (one row per user). Each boolean records whether the user has
// completed a given setup step. All six MVP items default to FALSE; the
// optional `ai_transcription_tried` bonus item also defaults to FALSE.
export const onboardingChecklist = pgTable(
  'onboarding_checklist',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // FK to `auth.users`. Cross-schema reference emitted manually in the
    // migration. UNIQUE so there is exactly one checklist row per user.
    userId: uuid('user_id').notNull(),

    // --- Six MVP checklist items (all default FALSE) ---
    // Whether the user completed their profile details.
    profileCompleted: boolean('profile_completed').notNull().default(false),
    // Whether the user configured at least one consultation location (wizard
    // step 2 "Local e agenda"). Flipped TRUE when the first `locations` row is
    // created through the onboarding wizard — the agenda module owns the
    // `locations`/`agenda_settings` tables; this flag only records that the
    // setup step is done. There is intentionally no separate location table.
    locationConfigured: boolean('location_configured').notNull().default(false),
    // Whether the user added at least one patient.
    firstPatientAdded: boolean('first_patient_added').notNull().default(false),
    // Whether the user scheduled their first session.
    firstSessionScheduled: boolean('first_session_scheduled').notNull().default(false),
    // Whether the user connected WhatsApp for reminders.
    whatsappConnected: boolean('whatsapp_connected').notNull().default(false),
    // Whether the user recorded their first clinical evolution.
    firstEvolutionRecorded: boolean('first_evolution_recorded').notNull().default(false),
    // Whether the user sent at least one consent term — derived from the owner
    // having >=1 patient with `consent_signed_at` set. Added by the
    // `onboarding-checklist-and-tour` change: the original `onboarding-data-model`
    // table omitted this column even though the archived data-model spec lists
    // `first_consent_sent`, so the checklist's "primeiro termo" item had no home.
    firstConsentSent: boolean('first_consent_sent').notNull().default(false),
    // Whether the user configured their billing / PIX details.
    billingConfigured: boolean('billing_configured').notNull().default(false),

    // --- Optional bonus item (defaults FALSE) ---
    // Whether the user tried the AI transcription feature at least once.
    aiTranscriptionTried: boolean('ai_transcription_tried').notNull().default(false),

    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // Exactly one checklist row per psychologist. The UNIQUE constraint also
    // provides the implicit index used by the RLS predicate on `user_id`.
    unique('onboarding_checklist_user_id_unique').on(table.userId),
  ],
);

export type OnboardingChecklist = typeof onboardingChecklist.$inferSelect;
export type NewOnboardingChecklist = typeof onboardingChecklist.$inferInsert;

// `notification_preferences` stores per-psychologist toggles for in-app and
// email notifications (one row per user). All toggles default to TRUE so the
// user is opted in by default.
//
// IMPORTANT: `email_critical` is a NON-DISABLEABLE flag. Critical operational
// emails (e.g., account security, billing failures, LGPD-relevant notices)
// must always reach the user, so although the column exists for schema
// symmetry and future-proofing, the application layer MUST NOT expose a way to
// set it to FALSE. The column defaults to TRUE and is expected to remain TRUE.
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // FK to `auth.users`. Cross-schema reference emitted manually in the
    // migration. UNIQUE so there is exactly one preferences row per user.
    userId: uuid('user_id').notNull(),

    // Whether the user receives the daily email digest.
    emailDaily: boolean('email_daily').notNull().default(true),
    // Whether the user receives the weekly email digest.
    emailWeekly: boolean('email_weekly').notNull().default(true),
    // Whether the user receives critical operational emails. NON-DISABLEABLE —
    // see the table comment above. Always TRUE.
    emailCritical: boolean('email_critical').notNull().default(true),
    // Whether in-app notifications play a sound.
    inAppSound: boolean('in_app_sound').notNull().default(true),

    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // Exactly one preferences row per psychologist. The UNIQUE constraint also
    // provides the implicit index used by the RLS predicate on `user_id`.
    unique('notification_preferences_user_id_unique').on(table.userId),
  ],
);

export type NotificationPreferences = typeof notificationPreferences.$inferSelect;
export type NewNotificationPreferences = typeof notificationPreferences.$inferInsert;
