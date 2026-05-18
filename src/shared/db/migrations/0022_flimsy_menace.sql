-- Attachments & personal-notes domain migration: creates `evolution_attachments`
-- and `personal_notes` tables with indexes, FK constraints, CHECK constraint on
-- category, owner-scoped RLS, and Supabase Storage bucket + policies.
-- NO DELETE policy on any table — Lei 13.787/2018 mandates 20-year retention.

-- =====================================================================
-- 1. CREATE TABLES
-- =====================================================================

CREATE TABLE "evolution_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"evolution_id" uuid,
	"file_name" text NOT NULL,
	"display_name" text NOT NULL,
	"file_size" bigint NOT NULL,
	"mime_type" text NOT NULL,
	"storage_path" text NOT NULL,
	"category" text NOT NULL,
	"consent_verified" boolean DEFAULT false NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint

CREATE TABLE "personal_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"content" text,
	"password_hash" text,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_notes_patient_id_unique" UNIQUE("patient_id")
);
--> statement-breakpoint

-- =====================================================================
-- 2. INDEXES
-- =====================================================================

CREATE INDEX "idx_attachments_patient_uploaded" ON "evolution_attachments" USING btree ("patient_id","uploaded_at");
--> statement-breakpoint
CREATE INDEX "idx_attachments_user_id" ON "evolution_attachments" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "idx_personal_notes_user_id" ON "personal_notes" USING btree ("user_id");
--> statement-breakpoint

-- =====================================================================
-- 3. CHECK CONSTRAINT
-- =====================================================================

ALTER TABLE "evolution_attachments"
  ADD CONSTRAINT "evolution_attachments_category_check"
  CHECK (category IN ('exam','image','drawing','audio','other'));
--> statement-breakpoint

-- =====================================================================
-- 4. FOREIGN KEY CONSTRAINTS
-- =====================================================================

ALTER TABLE "evolution_attachments"
  ADD CONSTRAINT "evolution_attachments_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id);
--> statement-breakpoint

ALTER TABLE "evolution_attachments"
  ADD CONSTRAINT "evolution_attachments_patient_id_fk"
  FOREIGN KEY ("patient_id") REFERENCES "patients"(id);
--> statement-breakpoint

ALTER TABLE "evolution_attachments"
  ADD CONSTRAINT "evolution_attachments_evolution_id_fk"
  FOREIGN KEY ("evolution_id") REFERENCES "evolutions"(id);
--> statement-breakpoint

ALTER TABLE "personal_notes"
  ADD CONSTRAINT "personal_notes_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id);
--> statement-breakpoint

ALTER TABLE "personal_notes"
  ADD CONSTRAINT "personal_notes_patient_id_fk"
  FOREIGN KEY ("patient_id") REFERENCES "patients"(id);
--> statement-breakpoint

-- =====================================================================
-- 5. ROW LEVEL SECURITY — evolution_attachments (SELECT/INSERT/UPDATE only)
-- =====================================================================

ALTER TABLE "evolution_attachments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select attachments" ON "evolution_attachments"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can insert attachments" ON "evolution_attachments"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can update attachments" ON "evolution_attachments"
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

-- =====================================================================
-- 6. ROW LEVEL SECURITY — personal_notes (SELECT/INSERT/UPDATE only)
-- =====================================================================

ALTER TABLE "personal_notes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select personal_notes" ON "personal_notes"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can insert personal_notes" ON "personal_notes"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can update personal_notes" ON "personal_notes"
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

-- =====================================================================
-- 7. SUPABASE STORAGE — patient-attachments bucket + policies
--    Wrapped in a DO block so the migration also succeeds on plain
--    Postgres (e.g., Testcontainers) where the `storage` schema does
--    not exist. In production Supabase the schema is always present.
-- =====================================================================

DO $$
BEGIN
  -- Guard: skip if the storage schema does not exist (non-Supabase Postgres)
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    -- Create private bucket (private = not publicly accessible)
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('patient-attachments', 'patient-attachments', false)
    ON CONFLICT (id) DO NOTHING;

    -- Insert: user can upload to their own prefix
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'user can upload own attachments'
    ) THEN
      CREATE POLICY "user can upload own attachments"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'patient-attachments'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
    END IF;

    -- Select: user can read from their own prefix
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'user can read own attachments'
    ) THEN
      CREATE POLICY "user can read own attachments"
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = 'patient-attachments'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
    END IF;
  END IF;
END$$;
