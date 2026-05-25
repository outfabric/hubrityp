CREATE TABLE "ai_transcription_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"default_template" text DEFAULT 'livre' NOT NULL,
	"keep_audio_hours" integer DEFAULT 24 NOT NULL,
	"keep_transcription" boolean DEFAULT false NOT NULL,
	"risk_detection_sensitivity" text DEFAULT 'medium' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_transcription_settings_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "ai_transcription_settings_template_check" CHECK ("ai_transcription_settings"."default_template" IN ('tcc', 'psicanalise', 'sistemica', 'aba', 'livre')),
	CONSTRAINT "ai_transcription_settings_keep_audio_hours_check" CHECK ("ai_transcription_settings"."keep_audio_hours" >= 24 AND "ai_transcription_settings"."keep_audio_hours" <= 168),
	CONSTRAINT "ai_transcription_settings_sensitivity_check" CHECK ("ai_transcription_settings"."risk_detection_sensitivity" IN ('low', 'medium', 'high'))
);
--> statement-breakpoint
CREATE TABLE "ai_transcriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"session_id" uuid,
	"evolution_id" uuid,
	"source" text NOT NULL,
	"audio_object_key" text,
	"audio_size_bytes" bigint,
	"audio_duration_seconds" integer,
	"audio_discarded_at" timestamp with time zone,
	"template_used" text,
	"generated_note" jsonb,
	"risk_alerts" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_code" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"reviewed_at" timestamp with time zone,
	"saved_to_prontuario" boolean DEFAULT false NOT NULL,
	"user_edits_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "ai_transcriptions_source_check" CHECK ("ai_transcriptions"."source" IN ('video_session', 'manual_upload')),
	CONSTRAINT "ai_transcriptions_status_check" CHECK ("ai_transcriptions"."status" IN ('pending', 'transcribing', 'generating', 'ready', 'reviewed', 'failed'))
);
--> statement-breakpoint
CREATE INDEX "idx_ai_transcriptions_user_status" ON "ai_transcriptions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_ai_transcriptions_user_created" ON "ai_transcriptions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_transcriptions_audio_to_discard" ON "ai_transcriptions" USING btree ("created_at") WHERE audio_object_key IS NOT NULL AND audio_discarded_at IS NULL;--> statement-breakpoint

-- =====================================================================
-- FOREIGN KEY CONSTRAINTS
-- =====================================================================

ALTER TABLE "ai_transcription_settings"
  ADD CONSTRAINT "ai_transcription_settings_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "ai_transcriptions"
  ADD CONSTRAINT "ai_transcriptions_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id);
--> statement-breakpoint

ALTER TABLE "ai_transcriptions"
  ADD CONSTRAINT "ai_transcriptions_patient_id_fk"
  FOREIGN KEY ("patient_id") REFERENCES "patients"(id);
--> statement-breakpoint

ALTER TABLE "ai_transcriptions"
  ADD CONSTRAINT "ai_transcriptions_session_id_fk"
  FOREIGN KEY ("session_id") REFERENCES "sessions"(id) ON DELETE SET NULL;
--> statement-breakpoint

ALTER TABLE "ai_transcriptions"
  ADD CONSTRAINT "ai_transcriptions_evolution_id_fk"
  FOREIGN KEY ("evolution_id") REFERENCES "evolutions"(id) ON DELETE SET NULL;
--> statement-breakpoint

-- =====================================================================
-- ROW LEVEL SECURITY — ai_transcription_settings (4 policies)
-- =====================================================================

ALTER TABLE "ai_transcription_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select ai_transcription_settings" ON "ai_transcription_settings"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can insert ai_transcription_settings" ON "ai_transcription_settings"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can update ai_transcription_settings" ON "ai_transcription_settings"
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can delete ai_transcription_settings" ON "ai_transcription_settings"
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

-- =====================================================================
-- ROW LEVEL SECURITY — ai_transcriptions (4 policies)
-- =====================================================================

ALTER TABLE "ai_transcriptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select ai_transcriptions" ON "ai_transcriptions"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can insert ai_transcriptions" ON "ai_transcriptions"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can update ai_transcriptions" ON "ai_transcriptions"
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can delete ai_transcriptions" ON "ai_transcriptions"
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

-- =====================================================================
-- SUPABASE STORAGE — ai-transcription-audio bucket + policies
-- Wrapped in a DO block so the migration succeeds on plain Postgres
-- (Testcontainers) where the `storage` schema does not exist.
-- Key pattern: ${userId}/${transcriptionId}
-- =====================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('ai-transcription-audio', 'ai-transcription-audio', false)
    ON CONFLICT (id) DO NOTHING;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'owner_select ai-transcription-audio'
    ) THEN
      CREATE POLICY "owner_select ai-transcription-audio"
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = 'ai-transcription-audio'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'owner_insert ai-transcription-audio'
    ) THEN
      CREATE POLICY "owner_insert ai-transcription-audio"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'ai-transcription-audio'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'owner_delete ai-transcription-audio'
    ) THEN
      CREATE POLICY "owner_delete ai-transcription-audio"
      ON storage.objects FOR DELETE TO authenticated
      USING (
        bucket_id = 'ai-transcription-audio'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
    END IF;
  END IF;
END$$;