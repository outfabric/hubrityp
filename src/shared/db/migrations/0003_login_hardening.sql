-- Login hardening migration: adds lockout columns to `profiles`, creates the
-- `oauth_identities` table, rewrites `handle_new_user()` to branch by
-- provider, and adds the `purge_old_auth_logs()` retention function.

-- =====================================================================
-- 1. ALTER profiles: add lockout/reset columns
-- =====================================================================

ALTER TABLE "profiles" ADD COLUMN "failed_login_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "last_failed_login_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "lockout_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "consecutive_lockouts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "requires_password_reset" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

-- Partial index for efficient lockout checks: only indexes rows that are
-- currently locked out. Queries filtering `WHERE lockout_until IS NOT NULL`
-- hit this index instead of scanning the entire table.
CREATE INDEX "profiles_lockout_until_idx" ON "profiles" ("lockout_until") WHERE "lockout_until" IS NOT NULL;
--> statement-breakpoint

-- =====================================================================
-- 2. CREATE TABLE oauth_identities
-- =====================================================================

CREATE TABLE "oauth_identities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "provider" text NOT NULL,
  "provider_user_id" text NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "linked_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "oauth_identities_provider_provider_user_id_unique" UNIQUE("provider","provider_user_id")
);
--> statement-breakpoint
CREATE INDEX "oauth_identities_user_id_idx" ON "oauth_identities" ("user_id");
--> statement-breakpoint

-- Cross-schema FK to `auth.users` (same pattern as profiles/auth_logs/auth_sessions).
ALTER TABLE "oauth_identities"
  ADD CONSTRAINT "oauth_identities_user_id_auth_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint

-- =====================================================================
-- 3. Row Level Security for oauth_identities
-- =====================================================================

ALTER TABLE "oauth_identities" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "oauth_identities_select_own" ON "oauth_identities"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

-- =====================================================================
-- 4. Rewrite handle_new_user() to branch by provider
-- =====================================================================

-- The trigger now inspects `raw_app_meta_data ->> 'provider'` to decide
-- whether to materialize a profile row. Email signups (provider = 'email'
-- or NULL/absent) proceed as before; OAuth signups (any other provider)
-- skip the INSERT and RETURN NEW immediately — the /onboarding/complete-profile
-- Server Action is responsible for creating the profile after the user
-- fills in CRP data.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  app_meta jsonb := COALESCE(NEW.raw_app_meta_data, '{}'::jsonb);
  v_provider text;
  v_full_name text;
  v_crp_number text;
  v_crp_uf text;
  v_terms_accepted_at timestamptz;
  v_privacy_accepted_at timestamptz;
  v_sensitive_data_consent_at timestamptz;
BEGIN
  v_provider := app_meta ->> 'provider';

  -- OAuth signups: do NOT insert a profile. The onboarding flow handles it.
  IF v_provider IS NOT NULL AND v_provider <> 'email' THEN
    RETURN NEW;
  END IF;

  -- Email signup path (provider = 'email' or NULL): full profile insert.
  v_full_name := meta ->> 'fullName';
  v_crp_number := meta ->> 'crpNumber';
  v_crp_uf := meta ->> 'crpUf';
  v_terms_accepted_at := NULLIF(meta ->> 'termsAcceptedAt', '')::timestamptz;
  v_privacy_accepted_at := NULLIF(meta ->> 'privacyAcceptedAt', '')::timestamptz;
  v_sensitive_data_consent_at := NULLIF(meta ->> 'sensitiveDataConsentAt', '')::timestamptz;

  IF v_full_name IS NULL OR length(btrim(v_full_name)) = 0 THEN
    RAISE EXCEPTION 'handle_new_user: missing required metadata field "fullName"';
  END IF;
  IF v_crp_number IS NULL OR length(btrim(v_crp_number)) = 0 THEN
    RAISE EXCEPTION 'handle_new_user: missing required metadata field "crpNumber"';
  END IF;
  IF v_crp_uf IS NULL OR length(btrim(v_crp_uf)) = 0 THEN
    RAISE EXCEPTION 'handle_new_user: missing required metadata field "crpUf"';
  END IF;
  IF v_terms_accepted_at IS NULL THEN
    RAISE EXCEPTION 'handle_new_user: missing required metadata field "termsAcceptedAt"';
  END IF;
  IF v_privacy_accepted_at IS NULL THEN
    RAISE EXCEPTION 'handle_new_user: missing required metadata field "privacyAcceptedAt"';
  END IF;
  IF v_sensitive_data_consent_at IS NULL THEN
    RAISE EXCEPTION 'handle_new_user: missing required metadata field "sensitiveDataConsentAt"';
  END IF;

  INSERT INTO public.profiles (
    user_id,
    email,
    full_name,
    crp_number,
    crp_uf,
    status,
    terms_accepted_at,
    privacy_accepted_at,
    sensitive_data_consent_at
  ) VALUES (
    NEW.id,
    NEW.email,
    v_full_name,
    v_crp_number,
    v_crp_uf,
    'pending_verification',
    v_terms_accepted_at,
    v_privacy_accepted_at,
    v_sensitive_data_consent_at
  );

  RETURN NEW;
END;
$$;
--> statement-breakpoint

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
--> statement-breakpoint

-- =====================================================================
-- 5. purge_old_auth_logs() — SECURITY DEFINER retention function
-- =====================================================================

-- Deletes auth_logs entries older than 6 months and returns the count of
-- deleted rows. SECURITY DEFINER so it can operate on all rows regardless
-- of the caller's RLS scope. No EXECUTE granted to `anon` or
-- `authenticated` — only the postgres/service_role can invoke.
CREATE OR REPLACE FUNCTION public.purge_old_auth_logs()
RETURNS INT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH deleted AS (
    DELETE FROM auth_logs WHERE created_at < NOW() - INTERVAL '6 months'
    RETURNING id
  )
  SELECT COUNT(*)::INT FROM deleted;
$$;
--> statement-breakpoint

ALTER FUNCTION public.purge_old_auth_logs() OWNER TO postgres;
--> statement-breakpoint

-- Revoke execute from public and named roles so only the owner (postgres)
-- and superuser/service_role (which has BYPASSRLS) can invoke.
REVOKE ALL ON FUNCTION public.purge_old_auth_logs() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_old_auth_logs() FROM authenticated;
REVOKE ALL ON FUNCTION public.purge_old_auth_logs() FROM anon;
