-- Patient CRUD core migration: creates the `patients` table with all columns,
-- enables RLS with owner-scoped policies, and creates performance indexes.

-- =====================================================================
-- 0. Extension: unaccent (for accent-insensitive search)
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint

-- =====================================================================
-- 1. CREATE TABLE patients
-- =====================================================================

CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"full_name" varchar(200) NOT NULL,
	"patient_type" text DEFAULT 'individual' NOT NULL,
	"birth_date" timestamp with time zone,
	"approximate_age" text,
	"gender" text,
	"phone" varchar(20),
	"email" varchar(255),
	"cpf" varchar(14),
	"address" text,
	"profession" varchar(100),
	"marital_status" text,
	"source" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"photo_path" text,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"consent_signed_at" timestamp with time zone,
	"consent_revoked_at" timestamp with time zone,
	"couple_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint

-- Cross-schema FK to `auth.users` (same pattern as profiles, health_pings).
ALTER TABLE "patients"
  ADD CONSTRAINT "patients_user_id_auth_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint

-- =====================================================================
-- 2. Row Level Security (owner-scoped, canonical template)
-- =====================================================================

ALTER TABLE "patients" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select" ON "patients"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can insert" ON "patients"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can update" ON "patients"
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can delete" ON "patients"
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

-- =====================================================================
-- 3. Indexes
-- =====================================================================

-- Compound index for the default listPatients query (user_id + status).
CREATE INDEX "patients_user_id_status_idx" ON "patients" USING btree ("user_id","status");
--> statement-breakpoint

-- GIN index for full-text search on patient names (Portuguese dictionary).
CREATE INDEX "patients_full_name_search_idx" ON "patients" USING gin (to_tsvector('portuguese', "full_name"));
--> statement-breakpoint

-- Partial unique index on (user_id, email) — allows multiple patients without
-- email for the same psychologist, but prevents duplicates when email is set.
CREATE UNIQUE INDEX "patients_user_id_email_unique" ON "patients" ("user_id", "email") WHERE "email" IS NOT NULL;
