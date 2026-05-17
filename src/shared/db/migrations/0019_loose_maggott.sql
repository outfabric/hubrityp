-- Medical-records domain migration: creates `diagnostic_hypotheses` table
-- with composite index, FK constraints, owner-scoped RLS, and CHECK constraints.
-- NO DELETE policy — Lei 13.787/2018 mandates 20-year retention of clinical records.

-- =====================================================================
-- 1. CREATE TABLE
-- =====================================================================

CREATE TABLE "diagnostic_hypotheses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"description" text,
	"cid10_code" varchar(10),
	"cid10_description" text,
	"status" text DEFAULT 'investigating' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- =====================================================================
-- 2. INDEXES
-- =====================================================================

CREATE INDEX "idx_diagnostic_hypotheses_patient_status_created" ON "diagnostic_hypotheses" USING btree ("patient_id","status","created_at");
--> statement-breakpoint

-- =====================================================================
-- 3. FOREIGN KEY CONSTRAINTS
-- =====================================================================

ALTER TABLE "diagnostic_hypotheses"
  ADD CONSTRAINT "diagnostic_hypotheses_user_id_auth_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id);
--> statement-breakpoint

ALTER TABLE "diagnostic_hypotheses"
  ADD CONSTRAINT "diagnostic_hypotheses_patient_id_patients_id_fk"
  FOREIGN KEY ("patient_id") REFERENCES "patients"(id);
--> statement-breakpoint

-- =====================================================================
-- 4. CHECK CONSTRAINTS
-- =====================================================================

-- At least one descriptor (description or CID-10 code) must be present
ALTER TABLE "diagnostic_hypotheses"
  ADD CONSTRAINT "chk_hypothesis_has_descriptor"
  CHECK (description IS NOT NULL OR cid10_code IS NOT NULL);
--> statement-breakpoint

-- Status must be one of the allowed values
ALTER TABLE "diagnostic_hypotheses"
  ADD CONSTRAINT "chk_hypothesis_status"
  CHECK (status IN ('investigating', 'confirmed', 'discarded'));
--> statement-breakpoint

-- =====================================================================
-- 5. ROW LEVEL SECURITY — diagnostic_hypotheses (SELECT/INSERT/UPDATE only)
-- =====================================================================

ALTER TABLE "diagnostic_hypotheses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select diagnostic_hypotheses" ON "diagnostic_hypotheses"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can insert diagnostic_hypotheses" ON "diagnostic_hypotheses"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can update diagnostic_hypotheses" ON "diagnostic_hypotheses"
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
