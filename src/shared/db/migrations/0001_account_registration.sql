CREATE TABLE "auth_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"event" text NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"full_name" varchar(120) NOT NULL,
	"crp_number" varchar(20) NOT NULL,
	"crp_uf" char(2) NOT NULL,
	"crp_validated_at" timestamp with time zone,
	"crp_validated_by" uuid,
	"email_verified_at" timestamp with time zone,
	"status" text DEFAULT 'pending_verification' NOT NULL,
	"terms_accepted_at" timestamp with time zone NOT NULL,
	"privacy_accepted_at" timestamp with time zone NOT NULL,
	"sensitive_data_consent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_crp_number_crp_uf_unique" UNIQUE("crp_number","crp_uf")
);
--> statement-breakpoint
CREATE INDEX "auth_logs_user_event_created_at_idx" ON "auth_logs" USING btree ("user_id","event","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "auth_sessions_user_created_at_idx" ON "auth_sessions" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint

-- Cross-schema foreign keys to `auth.users`. Drizzle does not model the
-- Supabase-managed `auth` schema, so these are emitted manually.
ALTER TABLE "profiles"
  ADD CONSTRAINT "profiles_user_id_auth_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "auth_logs"
  ADD CONSTRAINT "auth_logs_user_id_auth_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_user_id_auth_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint

-- CHECK constraint enforcing the lifecycle status enum on `profiles`.
-- Drizzle's `text` column does not emit this; the enum stays in lockstep
-- with the trigger functions and the `signUp`/`signIn` Server Actions.
ALTER TABLE "profiles"
  ADD CONSTRAINT "profiles_status_check"
  CHECK ("status" IN ('pending_verification','pending_crp_validation','active','suspended','cancelled'));
--> statement-breakpoint

-- =====================================================================
-- Row Level Security policies (mirrors src/shared/db/schema/auth/policies.ts)
-- =====================================================================

ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "user can select own profile" ON "profiles"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "user can update own profile" ON "profiles"
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

ALTER TABLE "auth_logs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "user can select own auth log" ON "auth_logs"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

-- Contract: `auth_logs` exposes only SELECT to end-users. Writes are
-- performed by `src/modules/registration/server/log-auth-event.ts` through
-- the app-level Drizzle pool, which MUST connect as a role with
-- `BYPASSRLS` (Supabase's default `postgres` role does). If a future ops
-- change pins the app pool to a stricter role without `BYPASSRLS`, every
-- audit INSERT will fail an RLS check — there is intentionally no INSERT
-- policy for `authenticated`. Documented at the schema level so a reviewer
-- can audit the contract without leaving the migration file.
COMMENT ON TABLE "auth_logs" IS
  'Audit log for authentication events. SELECT is RLS-restricted to row owner; '
  'INSERT is performed by the app pool (requires BYPASSRLS on the connecting '
  'role) — see log-auth-event.ts.';
--> statement-breakpoint

ALTER TABLE "auth_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "user can select own auth session" ON "auth_sessions"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

-- =====================================================================
-- Trigger functions
-- =====================================================================

-- `handle_new_user()` materializes a `profiles` row from `raw_user_meta_data`
-- on every `auth.users` insert. SECURITY DEFINER lets the function bypass
-- RLS (no INSERT policy on `profiles` exists for end-users — only this
-- trigger writes). The function intentionally raises an exception when any
-- required metadata key is missing so the entire signup transaction rolls
-- back and `auth.users` does not retain a partial signup.
--
-- The function writes only to `public.profiles`. `search_path` is pinned
-- to `public, pg_temp` so a hostile schema cannot intercept the INSERT.
-- The owner is locked to `postgres` (the role that runs migrations) so
-- SECURITY DEFINER cannot be exploited by ownership flips.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_full_name text;
  v_crp_number text;
  v_crp_uf text;
  v_terms_accepted_at timestamptz;
  v_privacy_accepted_at timestamptz;
  v_sensitive_data_consent_at timestamptz;
BEGIN
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

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();
--> statement-breakpoint

-- `handle_email_confirmed()` observes the `email_confirmed_at NULL → NOT
-- NULL` transition on `auth.users` and flips the matching `profiles` row
-- from `pending_verification` to `pending_crp_validation`, mirroring the
-- timestamp into `profiles.email_verified_at`. The function is idempotent:
-- when the profile is no longer in `pending_verification` (i.e., the user
-- has progressed to `active`/`suspended`/...), the UPDATE is a no-op so
-- Supabase's repeat UPDATEs cannot regress an already-active user.
CREATE OR REPLACE FUNCTION public.handle_email_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL THEN
    UPDATE public.profiles
    SET
      status = 'pending_crp_validation',
      email_verified_at = NEW.email_confirmed_at,
      updated_at = now()
    WHERE user_id = NEW.id
      AND status = 'pending_verification';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

ALTER FUNCTION public.handle_email_confirmed() OWNER TO postgres;
--> statement-breakpoint

CREATE TRIGGER on_auth_user_email_confirmed
AFTER UPDATE OF email_confirmed_at ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_email_confirmed();
