-- Anamnesis migration: creates the `anamnesis` table for clinical intake
-- records. 1:1 relationship with `patients` enforced by UNIQUE on patient_id.
-- FK to `patients(id)` ON DELETE CASCADE. RLS via subquery on parent
-- `patients.user_id`. Stores sensitive clinical data (LGPD art. 11).

-- =====================================================================
-- 1. CREATE TABLE anamnesis
-- =====================================================================

CREATE TABLE "anamnesis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"chief_complaint" text,
	"history_present_illness" text,
	"family_history" text,
	"educational_professional" text,
	"physical_health" text,
	"prior_therapy" text,
	"initial_hypothesis" text,
	"treatment_plan" text,
	"custom_sections" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anamnesis_patient_id_unique" UNIQUE("patient_id")
);
--> statement-breakpoint

-- FK to `patients(id)` with CASCADE delete — when a patient is removed,
-- their anamnesis record is removed automatically.
ALTER TABLE "anamnesis"
  ADD CONSTRAINT "anamnesis_patient_id_patients_id_fk"
  FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- =====================================================================
-- 2. Row Level Security (owner-scoped via subquery on patients.user_id)
-- =====================================================================

ALTER TABLE "anamnesis" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select anamnesis" ON "anamnesis"
  FOR SELECT TO authenticated
  USING (patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid()));
--> statement-breakpoint

CREATE POLICY "owner can insert anamnesis" ON "anamnesis"
  FOR INSERT TO authenticated
  WITH CHECK (patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid()));
--> statement-breakpoint

CREATE POLICY "owner can update anamnesis" ON "anamnesis"
  FOR UPDATE TO authenticated
  USING (patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid()))
  WITH CHECK (patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid()));
--> statement-breakpoint

CREATE POLICY "owner can delete anamnesis" ON "anamnesis"
  FOR DELETE TO authenticated
  USING (patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid()));
