-- Storage-only migration: private bucket + owner-scoped RLS for onboarding
-- profile photos (wizard step 1, "Sobre você").
--
-- No Drizzle table is introduced — the photo is stored in Supabase Storage,
-- referenced by an owner-scoped, UUID-named object key. Objects live under the
-- `<auth.uid()>/...` prefix so the storage RLS policies below restrict every
-- operation to the owning psychologist. The bucket is PRIVATE (public = false):
-- the app serves photos via short-lived signed URLs, never a public URL.
--
-- Guarded with the `storage` schema existence check so the migration is a no-op
-- on a non-Supabase Postgres (e.g. the Testcontainers integration DB), exactly
-- like the `ai-transcription-audio` and `prontuario-exports` bucket migrations.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('onboarding-profile-photos', 'onboarding-profile-photos', false)
    ON CONFLICT (id) DO NOTHING;

    -- SELECT: owner can read only objects under their own prefix.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'owner_select onboarding-profile-photos'
    ) THEN
      CREATE POLICY "owner_select onboarding-profile-photos"
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = 'onboarding-profile-photos'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
    END IF;

    -- INSERT: owner can upload only under their own prefix.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'owner_insert onboarding-profile-photos'
    ) THEN
      CREATE POLICY "owner_insert onboarding-profile-photos"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'onboarding-profile-photos'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
    END IF;

    -- UPDATE: owner can overwrite (upsert) only their own objects.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'owner_update onboarding-profile-photos'
    ) THEN
      CREATE POLICY "owner_update onboarding-profile-photos"
      ON storage.objects FOR UPDATE TO authenticated
      USING (
        bucket_id = 'onboarding-profile-photos'
        AND (storage.foldername(name))[1] = auth.uid()::text
      )
      WITH CHECK (
        bucket_id = 'onboarding-profile-photos'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
    END IF;

    -- DELETE: owner can remove only their own objects.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'owner_delete onboarding-profile-photos'
    ) THEN
      CREATE POLICY "owner_delete onboarding-profile-photos"
      ON storage.objects FOR DELETE TO authenticated
      USING (
        bucket_id = 'onboarding-profile-photos'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
    END IF;
  END IF;
END$$;
