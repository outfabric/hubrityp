# onboarding-data-model Specification

## Purpose
Data model for the onboarding experience: onboarding/NPS state on the `profiles` table, an `onboarding_checklist` table tracking MVP first-steps, a `notification_preferences` table holding per-user toggles, owner-scoped RLS with per-operation policies on the new tables, branded types and Zod validators for onboarding values, and server-only read helpers exposed through the `@/modules/onboarding` barrel.

## Requirements
### Requirement: Profiles table carries onboarding and NPS state
The system SHALL extend the existing `profiles` table with additive columns to track onboarding progress and NPS: `onboarding_step` (text NOT NULL DEFAULT 'welcome'), `onboarding_completed_at` (timestamptz nullable), `tour_completed_at` (timestamptz nullable), `first_access_at` (timestamptz nullable — set on first authenticated dashboard render, used to compute the day-7 NPS trigger), `reactivated_at` (timestamptz nullable — set when a cancelled account is reactivated, drives the welcome-back path), `nps_score` (integer nullable, CHECK between 0 and 10), `nps_feedback` (text nullable), `nps_responded_at` (timestamptz nullable). All columns are additive and do not alter existing `profiles` behavior or its RLS policies.

#### Scenario: Existing profile rows get defaults after migration
- **WHEN** the migration is applied to a database with existing `profiles` rows
- **THEN** every existing row has `onboarding_step = 'welcome'` and `NULL` for `onboarding_completed_at`, `tour_completed_at`, `first_access_at`, `reactivated_at`, `nps_score`, `nps_feedback`, `nps_responded_at`

#### Scenario: NPS score outside 0–10 is rejected
- **WHEN** an UPDATE sets `nps_score = 11`
- **THEN** the database rejects the write with a CHECK constraint violation

#### Scenario: Existing profiles RLS still scopes to the owner
- **WHEN** user B reads a `profiles` row owned by user A through the RLS-scoped client
- **THEN** the query returns zero rows, exactly as before this change

### Requirement: Onboarding checklist table tracks MVP first-steps
The system SHALL maintain an `onboarding_checklist` table with RLS enabled, one row per psychologist. Each row SHALL contain `id` (uuid PK), `user_id` (uuid NOT NULL UNIQUE — FK to auth.users), boolean MVP items defaulting to FALSE (`profile_configured`, `location_configured`, `first_patient_added`, `first_session_scheduled`, `first_evolution_recorded`, `first_consent_sent`), the optional bonus item `ai_transcription_tried` (boolean DEFAULT FALSE), and `updated_at` (timestamptz NOT NULL DEFAULT now()). The `user_id` column SHALL be UNIQUE so each psychologist has at most one checklist row.

#### Scenario: Checklist row is unique per user
- **WHEN** a second INSERT is attempted with a `user_id` that already has a checklist row
- **THEN** the database rejects the insert with a unique constraint violation

#### Scenario: All checklist items default to FALSE
- **WHEN** a checklist row is inserted with only `user_id` supplied
- **THEN** all six MVP item booleans and `ai_transcription_tried` are FALSE

### Requirement: Notification preferences table holds per-user toggles
The system SHALL maintain a `notification_preferences` table with RLS enabled, one row per psychologist. Each row SHALL contain `id` (uuid PK), `user_id` (uuid NOT NULL UNIQUE — FK to auth.users), `email_daily` (boolean DEFAULT TRUE), `email_weekly` (boolean DEFAULT TRUE), `email_critical` (boolean DEFAULT TRUE), `in_app_sound` (boolean DEFAULT TRUE), and `updated_at` (timestamptz NOT NULL DEFAULT now()). The `email_critical` toggle SHALL never be disabled by the application layer — critical notifications are mandatory — and this invariant is documented in the schema comment.

#### Scenario: Preferences row is unique per user
- **WHEN** a second INSERT is attempted with a `user_id` that already has a preferences row
- **THEN** the database rejects the insert with a unique constraint violation

#### Scenario: Defaults are opt-in for non-critical email
- **WHEN** a preferences row is inserted with only `user_id` supplied
- **THEN** `email_daily`, `email_weekly`, `email_critical`, and `in_app_sound` are all TRUE

### Requirement: Both new tables enforce owner-scoped RLS with per-operation policies
Every table in `src/shared/db/schema/onboarding/` SHALL have `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and explicit per-operation policies using `user_id = auth.uid()`. No `USING (true)` policy SHALL exist. `onboarding_checklist` and `notification_preferences` SHALL allow SELECT, INSERT, and UPDATE for the owner (`auth.uid() = user_id`), with WITH CHECK on INSERT/UPDATE; DELETE is not granted to the authenticated role (rows are owner-permanent — there is one per user for the account lifetime).

#### Scenario: RLS prevents cross-user reads of checklist
- **WHEN** user B attempts to SELECT user A's `onboarding_checklist` row through the RLS-scoped client
- **THEN** the query returns zero rows

#### Scenario: RLS prevents cross-user writes of preferences
- **WHEN** user B attempts to UPDATE user A's `notification_preferences` row through the RLS-scoped client
- **THEN** zero rows are affected

#### Scenario: RLS is enabled on both tables
- **WHEN** the migration is applied
- **THEN** `onboarding_checklist` and `notification_preferences` both have RLS enabled with at least one policy per allowed operation (SELECT, INSERT, UPDATE) and no DELETE policy for `authenticated`

#### Scenario: user_id column is indexed for the RLS predicate
- **WHEN** the migration is applied
- **THEN** both tables have an index (or the UNIQUE constraint's implicit index) on `user_id` so the RLS predicate does not force a sequential scan

### Requirement: Branded types and Zod validators model onboarding values
The system SHALL expose, from `src/modules/onboarding/lib/`, a `OnboardingStep` union type (`'welcome' | 'profile' | 'location' | 'patients' | 'done'`), a branded `NpsScore` type constrained to integers 0–10, and Zod schemas: `onboardingStepSchema`, `npsAnswerSchema` (`{ score: 0–10 int, feedback?: string max 2000 }`), `notificationPreferencesSchema`. Domain types SHALL be derived via `z.infer`. These are pure modules with no Node-only or DB imports.

#### Scenario: NPS answer schema rejects out-of-range score
- **WHEN** `npsAnswerSchema.safeParse({ score: 12 })` runs
- **THEN** it fails validation

#### Scenario: NPS answer schema accepts a valid answer with optional feedback
- **WHEN** `npsAnswerSchema.safeParse({ score: 9, feedback: 'Adorei a agenda' })` runs
- **THEN** it succeeds and the inferred type narrows `score` to a number and `feedback` to an optional string

#### Scenario: Onboarding step schema rejects an unknown step
- **WHEN** `onboardingStepSchema.safeParse('billing')` runs
- **THEN** it fails validation (billing is a post-MVP step, not part of the MVP wizard)

### Requirement: Read helpers expose onboarding state through the module barrel
The system SHALL expose, from the `@/modules/onboarding` barrel, server-only read helpers: `getOnboardingChecklist(supabase, userId)` and `getNotificationPreferences(supabase, userId)`, each returning the owner's single row (or `null`) using the RLS-scoped Supabase/Drizzle client. Consumers MUST import only from `@/modules/onboarding`, never from internal paths. These helpers authorize through RLS (no service-role) and never trust a caller-supplied id beyond the authenticated session's `userId`.

#### Scenario: Read helper returns the caller's own checklist
- **GIVEN** an authenticated psychologist with a checklist row
- **WHEN** `getOnboardingChecklist` runs with the RLS-scoped client
- **THEN** it returns that psychologist's row and never another user's row
