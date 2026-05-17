-- Scale-applications domain migration: creates `scale_applications` table with
-- indexes, FK constraints, CHECK constraint on scale_key, and owner-scoped RLS.
-- NO DELETE policy — Lei 13.787/2018 mandates 20-year clinical record retention.

-- =====================================================================
-- 1. CREATE TABLE
-- =====================================================================

CREATE TABLE "scale_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"scale_key" text NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_score" integer,
	"classification" text,
	"notes" text,
	"applied_remotely" boolean DEFAULT false NOT NULL,
	"remote_token" varchar(64),
	"token_expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scale_applications_remote_token_unique" UNIQUE("remote_token")
);
--> statement-breakpoint

-- =====================================================================
-- 2. INDEXES
-- =====================================================================

CREATE INDEX "idx_scale_apps_patient_scale_applied" ON "scale_applications" USING btree ("patient_id","scale_key","applied_at");
--> statement-breakpoint

-- =====================================================================
-- 3. CHECK CONSTRAINT
-- =====================================================================

ALTER TABLE "scale_applications"
  ADD CONSTRAINT "scale_applications_scale_key_check"
  CHECK (scale_key IN ('phq9','gad7','sdq','audit','whoqol-bref'));
--> statement-breakpoint

-- =====================================================================
-- 4. FOREIGN KEY CONSTRAINTS
-- =====================================================================

ALTER TABLE "scale_applications"
  ADD CONSTRAINT "scale_applications_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id);
--> statement-breakpoint

ALTER TABLE "scale_applications"
  ADD CONSTRAINT "scale_applications_patient_id_fk"
  FOREIGN KEY ("patient_id") REFERENCES "patients"(id);
--> statement-breakpoint

-- =====================================================================
-- 5. ROW LEVEL SECURITY — scale_applications (SELECT/INSERT/UPDATE only)
-- =====================================================================

ALTER TABLE "scale_applications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select scale_applications" ON "scale_applications"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can insert scale_applications" ON "scale_applications"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can update scale_applications" ON "scale_applications"
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
