-- Patient guardians migration: creates the `patient_guardians` table for legal
-- guardians of minor patients, with FK to `patients(id)` ON DELETE CASCADE,
-- RLS via subquery on parent `patients.user_id`, and a btree index on patient_id.

-- =====================================================================
-- 1. CREATE TABLE patient_guardians
-- =====================================================================

CREATE TABLE "patient_guardians" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"full_name" varchar(200) NOT NULL,
	"relationship" text NOT NULL,
	"cpf" varchar(14),
	"phone" varchar(20),
	"email" varchar(255),
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- FK to `patients(id)` with CASCADE delete — when a patient is removed,
-- all their guardians are removed automatically.
ALTER TABLE "patient_guardians"
  ADD CONSTRAINT "patient_guardians_patient_id_patients_id_fk"
  FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- =====================================================================
-- 2. Row Level Security (owner-scoped via subquery on patients.user_id)
-- =====================================================================

ALTER TABLE "patient_guardians" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select guardians" ON "patient_guardians"
  FOR SELECT TO authenticated
  USING (patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid()));
--> statement-breakpoint

CREATE POLICY "owner can insert guardians" ON "patient_guardians"
  FOR INSERT TO authenticated
  WITH CHECK (patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid()));
--> statement-breakpoint

CREATE POLICY "owner can update guardians" ON "patient_guardians"
  FOR UPDATE TO authenticated
  USING (patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid()))
  WITH CHECK (patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid()));
--> statement-breakpoint

CREATE POLICY "owner can delete guardians" ON "patient_guardians"
  FOR DELETE TO authenticated
  USING (patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid()));
--> statement-breakpoint

-- =====================================================================
-- 3. Indexes
-- =====================================================================

CREATE INDEX "patient_guardians_patient_id_idx" ON "patient_guardians" USING btree ("patient_id");
