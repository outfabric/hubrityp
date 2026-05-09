-- Agenda foundation migration: creates the four core scheduling tables
-- (locations, agenda_settings, sessions, session_history) with FK constraints,
-- CHECK constraints for enum-like columns, composite indexes for query
-- performance, and RLS policies for owner-scoped access.

-- =====================================================================
-- 1. CREATE TABLES
-- =====================================================================

CREATE TABLE "agenda_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"default_duration_minutes" integer DEFAULT 50 NOT NULL,
	"interval_minutes" integer DEFAULT 10 NOT NULL,
	"business_hours" jsonb DEFAULT '[{"day":1,"start":"08:00","end":"20:00"},{"day":2,"start":"08:00","end":"20:00"},{"day":3,"start":"08:00","end":"20:00"},{"day":4,"start":"08:00","end":"20:00"},{"day":5,"start":"08:00","end":"20:00"},{"day":6,"start":"08:00","end":"12:00"}]'::jsonb NOT NULL,
	"cancellation_policy" text,
	"default_color" varchar(7),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"address" text,
	"type" text NOT NULL,
	"color" varchar(7),
	"arrival_instructions" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"patient_id" uuid,
	"recurrence_id" uuid,
	"is_blocking" boolean DEFAULT false NOT NULL,
	"blocking_title" varchar(120),
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"location_id" uuid,
	"modality" text,
	"amount" text,
	"notes" text,
	"color" varchar(7),
	"status" text DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- =====================================================================
-- 2. Indexes
-- =====================================================================

CREATE INDEX "session_history_session_id_created_at_idx" ON "session_history" USING btree ("session_id","created_at");
--> statement-breakpoint
CREATE INDEX "sessions_user_id_start_at_idx" ON "sessions" USING btree ("user_id","start_at");
--> statement-breakpoint
CREATE INDEX "sessions_patient_id_start_at_idx" ON "sessions" USING btree ("patient_id","start_at");
--> statement-breakpoint
CREATE INDEX "sessions_status_start_at_idx" ON "sessions" USING btree ("status","start_at");
--> statement-breakpoint

-- =====================================================================
-- 3. Foreign Keys
-- =====================================================================

-- locations.user_id -> auth.users(id)
ALTER TABLE "locations"
  ADD CONSTRAINT "locations_user_id_auth_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint

-- agenda_settings.user_id -> auth.users(id)
ALTER TABLE "agenda_settings"
  ADD CONSTRAINT "agenda_settings_user_id_auth_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint

-- sessions.user_id -> auth.users(id)
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_user_id_auth_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint

-- sessions.patient_id -> patients(id) ON DELETE SET NULL (session survives patient deletion)
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_patient_id_patients_id_fk"
  FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL;
--> statement-breakpoint

-- sessions.location_id -> locations(id) ON DELETE SET NULL (session survives location deletion)
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_location_id_locations_id_fk"
  FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL;
--> statement-breakpoint

-- session_history.session_id -> sessions(id) ON DELETE CASCADE
ALTER TABLE "session_history"
  ADD CONSTRAINT "session_history_session_id_sessions_id_fk"
  FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- session_history.user_id -> auth.users(id)
ALTER TABLE "session_history"
  ADD CONSTRAINT "session_history_user_id_auth_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint

-- =====================================================================
-- 4. CHECK Constraints
-- =====================================================================

-- locations.type enum
ALTER TABLE "locations"
  ADD CONSTRAINT "locations_type_check"
  CHECK ("type" IN ('in_person', 'online', 'other'));
--> statement-breakpoint

-- sessions.modality enum (nullable — NULL is valid for blocking slots)
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_modality_check"
  CHECK ("modality" IS NULL OR "modality" IN ('in_person', 'online'));
--> statement-breakpoint

-- sessions.status enum
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_status_check"
  CHECK ("status" IN ('scheduled', 'done'));
--> statement-breakpoint

-- session_history.action enum
ALTER TABLE "session_history"
  ADD CONSTRAINT "session_history_action_check"
  CHECK ("action" IN ('created', 'updated', 'rescheduled', 'status_changed', 'deleted'));
--> statement-breakpoint

-- =====================================================================
-- 5. Row Level Security (owner-scoped via user_id = auth.uid())
-- =====================================================================

-- --- locations ---
ALTER TABLE "locations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select locations" ON "locations"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can insert locations" ON "locations"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can update locations" ON "locations"
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can delete locations" ON "locations"
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

-- --- agenda_settings ---
ALTER TABLE "agenda_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select agenda_settings" ON "agenda_settings"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can insert agenda_settings" ON "agenda_settings"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can update agenda_settings" ON "agenda_settings"
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can delete agenda_settings" ON "agenda_settings"
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

-- --- sessions ---
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select sessions" ON "sessions"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can insert sessions" ON "sessions"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can update sessions" ON "sessions"
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can delete sessions" ON "sessions"
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

-- --- session_history ---
ALTER TABLE "session_history" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select session_history" ON "session_history"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can insert session_history" ON "session_history"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can update session_history" ON "session_history"
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can delete session_history" ON "session_history"
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
