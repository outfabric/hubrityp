-- Prontuario exports domain migration: creates `prontuario_exports` table with
-- indexes, FK constraints, CHECK constraint on status, owner-scoped RLS
-- (SELECT/INSERT only), and Supabase Storage bucket + policies for
-- `prontuario-exports`.
-- NO UPDATE/DELETE policy for authenticated — service-role only (Inngest job,
-- expiry cron). Exports expire naturally; cleanup is via service-role cron.

-- =====================================================================
-- 1. CREATE TABLE
-- =====================================================================

CREATE TABLE "prontuario_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"filters" jsonb NOT NULL,
	"storage_path" text,
	"file_size" bigint,
	"error_message" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint

-- =====================================================================
-- 2. INDEXES
-- =====================================================================

CREATE INDEX "idx_prontuario_exports_user_created" ON "prontuario_exports" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX "idx_prontuario_exports_status_expires" ON "prontuario_exports" USING btree ("status","expires_at");
--> statement-breakpoint

-- =====================================================================
-- 3. CHECK CONSTRAINT
-- =====================================================================

ALTER TABLE "prontuario_exports"
  ADD CONSTRAINT "prontuario_exports_status_check"
  CHECK (status IN ('pending','processing','ready','failed','expired'));
--> statement-breakpoint

-- =====================================================================
-- 4. FOREIGN KEY CONSTRAINTS
-- =====================================================================

ALTER TABLE "prontuario_exports"
  ADD CONSTRAINT "prontuario_exports_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id);
--> statement-breakpoint

ALTER TABLE "prontuario_exports"
  ADD CONSTRAINT "prontuario_exports_patient_id_fk"
  FOREIGN KEY ("patient_id") REFERENCES "patients"(id);
--> statement-breakpoint

-- =====================================================================
-- 5. ROW LEVEL SECURITY — prontuario_exports (SELECT/INSERT only)
--    No UPDATE policy — status transitions managed by service-role
--    (Inngest export job, expiry cron).
--    No DELETE policy — exports expire naturally; cleanup via cron.
-- =====================================================================

ALTER TABLE "prontuario_exports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select prontuario_exports" ON "prontuario_exports"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can insert prontuario_exports" ON "prontuario_exports"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

-- =====================================================================
-- 6. SUPABASE STORAGE — prontuario-exports bucket + policies
--    Wrapped in a DO block so the migration also succeeds on plain
--    Postgres (e.g., Testcontainers) where the `storage` schema does
--    not exist. In production Supabase the schema is always present.
--    Key pattern: ${user_id}/${patient_id}/${exportId}.pdf
-- =====================================================================

DO $$
BEGIN
  -- Guard: skip if the storage schema does not exist (non-Supabase Postgres)
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    -- Create private bucket (private = not publicly accessible)
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('prontuario-exports', 'prontuario-exports', false)
    ON CONFLICT (id) DO NOTHING;

    -- INSERT: user can upload to their own prefix
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'owner_insert prontuario-exports'
    ) THEN
      CREATE POLICY "owner_insert prontuario-exports"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'prontuario-exports'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
    END IF;

    -- SELECT: user can read from their own prefix
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'owner_select prontuario-exports'
    ) THEN
      CREATE POLICY "owner_select prontuario-exports"
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = 'prontuario-exports'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
    END IF;

    -- No UPDATE/DELETE for authenticated users — managed by service-role cron.
    -- The Inngest job uses service-role to upload (bypasses INSERT policy)
    -- since it runs outside user context. Signed URL generation uses the
    -- authenticated client (respects SELECT policy).
  END IF;
END$$;
