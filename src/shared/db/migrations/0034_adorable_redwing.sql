CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email_daily" boolean DEFAULT true NOT NULL,
	"email_weekly" boolean DEFAULT true NOT NULL,
	"email_critical" boolean DEFAULT true NOT NULL,
	"in_app_sound" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "onboarding_checklist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"profile_completed" boolean DEFAULT false NOT NULL,
	"first_patient_added" boolean DEFAULT false NOT NULL,
	"first_session_scheduled" boolean DEFAULT false NOT NULL,
	"whatsapp_connected" boolean DEFAULT false NOT NULL,
	"first_evolution_recorded" boolean DEFAULT false NOT NULL,
	"billing_configured" boolean DEFAULT false NOT NULL,
	"ai_transcription_tried" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_checklist_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "onboarding_step" text DEFAULT 'welcome' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "onboarding_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "tour_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "first_access_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "reactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "nps_score" integer;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "nps_feedback" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "nps_responded_at" timestamp with time zone;--> statement-breakpoint

-- ===========================================================================
-- MANUAL EDITS (appended by hand — not emitted by drizzle-kit).
-- drizzle-kit does not generate CHECK constraints, cross-schema FKs, RLS
-- ENABLE, or CREATE POLICY. They are added below so the migration is the
-- single source of truth for the database state.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- CHECK constraints on the new `profiles` columns.
--   * nps_score must be within the canonical NPS range 0..10 (matches the
--     `NpsScore` branded type and `npsAnswerSchema` Zod validator).
--   * onboarding_step must be one of the OnboardingStep union values (kept in
--     lockstep with `onboardingStepSchema`).
-- ---------------------------------------------------------------------------
ALTER TABLE "profiles"
	ADD CONSTRAINT "profiles_nps_score_range_check"
	CHECK ("nps_score" IS NULL OR ("nps_score" >= 0 AND "nps_score" <= 10));--> statement-breakpoint
ALTER TABLE "profiles"
	ADD CONSTRAINT "profiles_onboarding_step_check"
	CHECK ("onboarding_step" IN ('welcome', 'profile', 'location', 'patients', 'done'));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Cross-schema FOREIGN KEYS to `auth.users(id)`. Drizzle cannot express
-- cross-schema references (`auth` lives outside the modeled `public` schema),
-- so these are emitted by hand — same pattern as `profiles.user_id`,
-- `oauth_identities.user_id`, etc. ON DELETE CASCADE so deleting the Supabase
-- auth user removes the dependent onboarding/preferences singleton rows.
-- ---------------------------------------------------------------------------
ALTER TABLE "onboarding_checklist"
	ADD CONSTRAINT "onboarding_checklist_user_id_fk"
	FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_preferences"
	ADD CONSTRAINT "notification_preferences_user_id_fk"
	FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Indexes on the RLS predicate column (`user_id`). The UNIQUE constraint on
-- `user_id` already creates an implicit btree index, but we declare explicit
-- named indexes too so the RLS predicate has a guaranteed, discoverable index
-- and the index-existence integration test has a stable name to assert on.
-- IF NOT EXISTS guards against the implicit-unique-index name overlap on
-- engines that name them identically.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "idx_onboarding_checklist_user_id"
	ON "onboarding_checklist" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notification_preferences_user_id"
	ON "notification_preferences" USING btree ("user_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY — onboarding_checklist.
-- Owner-scoped: SELECT/INSERT/UPDATE only (no DELETE policy — least
-- privilege; these are per-user singletons that persist for the account
-- lifetime, cleaned up via the ON DELETE CASCADE FK above). Mirrors
-- src/shared/db/schema/onboarding/policies.ts.
-- ---------------------------------------------------------------------------
ALTER TABLE "onboarding_checklist" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "onboarding_checklist_select_own" ON "onboarding_checklist"
	FOR SELECT TO authenticated
	USING (auth.uid() = user_id);--> statement-breakpoint
CREATE POLICY "onboarding_checklist_insert_own" ON "onboarding_checklist"
	FOR INSERT TO authenticated
	WITH CHECK (auth.uid() = user_id);--> statement-breakpoint
CREATE POLICY "onboarding_checklist_update_own" ON "onboarding_checklist"
	FOR UPDATE TO authenticated
	USING (auth.uid() = user_id)
	WITH CHECK (auth.uid() = user_id);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY — notification_preferences.
-- Owner-scoped: SELECT/INSERT/UPDATE only (no DELETE policy). Mirrors
-- src/shared/db/schema/onboarding/policies.ts.
-- ---------------------------------------------------------------------------
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "notification_preferences_select_own" ON "notification_preferences"
	FOR SELECT TO authenticated
	USING (auth.uid() = user_id);--> statement-breakpoint
CREATE POLICY "notification_preferences_insert_own" ON "notification_preferences"
	FOR INSERT TO authenticated
	WITH CHECK (auth.uid() = user_id);--> statement-breakpoint
CREATE POLICY "notification_preferences_update_own" ON "notification_preferences"
	FOR UPDATE TO authenticated
	USING (auth.uid() = user_id)
	WITH CHECK (auth.uid() = user_id);
