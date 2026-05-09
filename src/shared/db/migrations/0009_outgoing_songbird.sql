-- Session recurrences migration: creates the `session_recurrences` table,
-- adds `patient_ids` and `is_late_record` columns to `sessions`, creates
-- FK from `sessions.recurrence_id` to `session_recurrences(id)`, adds
-- CHECK constraints, indexes, and RLS policies.

-- =====================================================================
-- 1. CREATE TABLE — session_recurrences
-- =====================================================================

CREATE TABLE "session_recurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"patient_id" uuid,
	"frequency" varchar(20) NOT NULL,
	"days_of_week" integer[],
	"start_date" date NOT NULL,
	"end_date" date,
	"occurrence_count" integer,
	"is_indefinite" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- =====================================================================
-- 2. ALTER sessions — add new columns
-- =====================================================================

ALTER TABLE "sessions" ADD COLUMN "patient_ids" uuid[];
--> statement-breakpoint

ALTER TABLE "sessions" ADD COLUMN "is_late_record" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

-- =====================================================================
-- 3. Indexes
-- =====================================================================

CREATE INDEX "idx_sessions_recurrence" ON "sessions" USING btree ("recurrence_id");
--> statement-breakpoint

-- =====================================================================
-- 4. Foreign Keys
-- =====================================================================

-- session_recurrences.user_id -> auth.users(id) ON DELETE CASCADE
ALTER TABLE "session_recurrences"
  ADD CONSTRAINT "session_recurrences_user_id_auth_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint

-- session_recurrences.patient_id -> patients(id) ON DELETE SET NULL
ALTER TABLE "session_recurrences"
  ADD CONSTRAINT "session_recurrences_patient_id_patients_id_fk"
  FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL;
--> statement-breakpoint

-- sessions.recurrence_id -> session_recurrences(id) ON DELETE SET NULL
-- (session survives recurrence deletion — it becomes a standalone session)
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_recurrence_id_session_recurrences_id_fk"
  FOREIGN KEY ("recurrence_id") REFERENCES "session_recurrences"("id") ON DELETE SET NULL;
--> statement-breakpoint

-- =====================================================================
-- 5. CHECK Constraints
-- =====================================================================

-- session_recurrences.frequency enum
ALTER TABLE "session_recurrences"
  ADD CONSTRAINT "session_recurrences_frequency_check"
  CHECK ("frequency" IN ('weekly', 'biweekly', 'monthly', 'custom'));
--> statement-breakpoint

-- sessions.patient_ids max 2 entries (for couple sessions)
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_patient_ids_max_two_check"
  CHECK ("patient_ids" IS NULL OR array_length("patient_ids", 1) <= 2);
--> statement-breakpoint

-- =====================================================================
-- 6. Row Level Security — session_recurrences
-- =====================================================================

ALTER TABLE "session_recurrences" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select session_recurrences" ON "session_recurrences"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can insert session_recurrences" ON "session_recurrences"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can update session_recurrences" ON "session_recurrences"
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can delete session_recurrences" ON "session_recurrences"
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
