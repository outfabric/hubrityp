-- Consent terms migration: creates the `consent_terms` table for patient
-- informed consent records. Each term is linked to a patient (via patient_id)
-- and a psychologist (via user_id). The signature_token is a 64-char hex
-- string used as a unique, unguessable identifier for the public signing page.
-- RLS policies enforce owner-scoped access via user_id = auth.uid().
-- The public signing endpoint bypasses RLS using a service-role connection.

-- =====================================================================
-- 1. CREATE TABLE consent_terms
-- =====================================================================

CREATE TABLE "consent_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"term_text" text NOT NULL,
	"signature_token" varchar(64) NOT NULL,
	"signed_at" timestamp with time zone,
	"signed_ip" text,
	"signed_user_agent" text,
	"signed_pdf_path" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_terms_signature_token_unique" UNIQUE("signature_token")
);
--> statement-breakpoint

-- Index for the most common query: "all consent terms for a given patient".
CREATE INDEX "consent_terms_patient_id_idx" ON "consent_terms" USING btree ("patient_id");
--> statement-breakpoint

-- =====================================================================
-- 2. Foreign Keys
-- =====================================================================

-- FK to `patients(id)` with CASCADE delete — when a patient is removed,
-- their consent terms are removed automatically.
ALTER TABLE "consent_terms"
  ADD CONSTRAINT "consent_terms_patient_id_patients_id_fk"
  FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- Cross-schema FK to `auth.users` (same pattern as patients.user_id).
ALTER TABLE "consent_terms"
  ADD CONSTRAINT "consent_terms_user_id_auth_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint

-- =====================================================================
-- 3. Row Level Security (owner-scoped via user_id = auth.uid())
-- =====================================================================

ALTER TABLE "consent_terms" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select consent_terms" ON "consent_terms"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can insert consent_terms" ON "consent_terms"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can update consent_terms" ON "consent_terms"
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can delete consent_terms" ON "consent_terms"
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
