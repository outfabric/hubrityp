// Owner-scoped RLS policies for the ai-transcription domain tables.
//
// These SQL strings follow the canonical template documented in
// `src/shared/db/migrations/README.md`. They are appended **manually** to
// the Drizzle-generated migration file because Drizzle does not emit RLS.
//
// Both tables use `user_id = auth.uid()` for all four operations
// (SELECT, INSERT, UPDATE, DELETE). No `USING (true)` — every policy is
// scoped to the authenticated psychologist's own rows.

// 4 policies: SELECT, INSERT, UPDATE, DELETE.
export const aiTranscriptionSettingsPolicies = [
  `ALTER TABLE ai_transcription_settings ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "owner can select ai_transcription_settings" ON ai_transcription_settings
     FOR SELECT TO authenticated
     USING (auth.uid() = user_id);`,
  `CREATE POLICY "owner can insert ai_transcription_settings" ON ai_transcription_settings
     FOR INSERT TO authenticated
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "owner can update ai_transcription_settings" ON ai_transcription_settings
     FOR UPDATE TO authenticated
     USING (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "owner can delete ai_transcription_settings" ON ai_transcription_settings
     FOR DELETE TO authenticated
     USING (auth.uid() = user_id);`,
] as const;

// 4 policies: SELECT, INSERT, UPDATE, DELETE.
export const aiTranscriptionsPolicies = [
  `ALTER TABLE ai_transcriptions ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "owner can select ai_transcriptions" ON ai_transcriptions
     FOR SELECT TO authenticated
     USING (auth.uid() = user_id);`,
  `CREATE POLICY "owner can insert ai_transcriptions" ON ai_transcriptions
     FOR INSERT TO authenticated
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "owner can update ai_transcriptions" ON ai_transcriptions
     FOR UPDATE TO authenticated
     USING (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "owner can delete ai_transcriptions" ON ai_transcriptions
     FOR DELETE TO authenticated
     USING (auth.uid() = user_id);`,
] as const;

// Storage bucket creation + policies for `ai-transcription-audio`.
// The bucket is private (public = false). Object policies use the folder
// convention `<userId>/<transcriptionId>` so that `(storage.foldername(name))[1]`
// extracts the user's UUID for ownership checks.
//
// Wrapped in a DO block so the migration also succeeds on plain Postgres
// (Testcontainers) where the `storage` schema does not exist.
export const aiTranscriptionStoragePolicies = [
  `DO $$
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
END$$;`,
] as const;
