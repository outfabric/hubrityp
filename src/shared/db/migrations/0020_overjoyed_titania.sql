-- Treatment-plans domain migration: creates `treatment_plans` and
-- `treatment_plan_versions` tables with indexes, FK constraints, and
-- owner-scoped RLS. NO DELETE policy on any table — Lei 13.787/2018
-- mandates 20-year retention.

-- =====================================================================
-- 1. CREATE TABLES
-- =====================================================================

CREATE TABLE "treatment_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"goals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"phases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resources" text,
	"success_criteria" text,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treatment_plans_patient_id_unique" UNIQUE("patient_id")
);
--> statement-breakpoint

CREATE TABLE "treatment_plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"content" jsonb NOT NULL,
	"modified_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treatment_plan_versions_plan_version_unique" UNIQUE("plan_id","version_number")
);
--> statement-breakpoint

-- =====================================================================
-- 2. INDEXES
-- =====================================================================

CREATE INDEX "idx_treatment_plans_user_id" ON "treatment_plans" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "idx_treatment_plan_versions_plan_desc" ON "treatment_plan_versions" USING btree ("plan_id","version_number");
--> statement-breakpoint

-- =====================================================================
-- 3. FOREIGN KEY CONSTRAINTS
-- =====================================================================

ALTER TABLE "treatment_plans"
  ADD CONSTRAINT "treatment_plans_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id);
--> statement-breakpoint

ALTER TABLE "treatment_plans"
  ADD CONSTRAINT "treatment_plans_patient_id_fk"
  FOREIGN KEY ("patient_id") REFERENCES "patients"(id);
--> statement-breakpoint

ALTER TABLE "treatment_plan_versions"
  ADD CONSTRAINT "treatment_plan_versions_plan_id_fk"
  FOREIGN KEY ("plan_id") REFERENCES "treatment_plans"(id) ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "treatment_plan_versions"
  ADD CONSTRAINT "treatment_plan_versions_modified_by_fk"
  FOREIGN KEY ("modified_by") REFERENCES auth.users(id);
--> statement-breakpoint

-- =====================================================================
-- 4. ROW LEVEL SECURITY — treatment_plans (SELECT/INSERT/UPDATE only)
-- =====================================================================

ALTER TABLE "treatment_plans" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select treatment_plans" ON "treatment_plans"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can insert treatment_plans" ON "treatment_plans"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can update treatment_plans" ON "treatment_plans"
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

-- =====================================================================
-- 5. ROW LEVEL SECURITY — treatment_plan_versions (SELECT/INSERT only)
--    Version snapshots are immutable per Lei 13.787/2018: no UPDATE or DELETE.
-- =====================================================================

ALTER TABLE "treatment_plan_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select treatment_plan_versions" ON "treatment_plan_versions"
  FOR SELECT TO authenticated
  USING (plan_id IN (SELECT id FROM treatment_plans WHERE user_id = auth.uid()));
--> statement-breakpoint

CREATE POLICY "owner can insert treatment_plan_versions" ON "treatment_plan_versions"
  FOR INSERT TO authenticated
  WITH CHECK (plan_id IN (SELECT id FROM treatment_plans WHERE user_id = auth.uid()));
