CREATE TABLE "crp_validation_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"crp_number" text NOT NULL,
	"crp_uf" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"rejection_reason" text,
	CONSTRAINT "crp_validation_queue_status_check" CHECK ("crp_validation_queue"."status" IN ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "psychologist_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"crp_number" text NOT NULL,
	"crp_uf" text NOT NULL,
	"status" text NOT NULL,
	"terms_accepted_at" timestamp with time zone NOT NULL,
	"privacy_accepted_at" timestamp with time zone NOT NULL,
	"sensitive_data_consent_at" timestamp with time zone NOT NULL,
	"terms_version" text NOT NULL,
	"privacy_version" text NOT NULL,
	"sensitive_data_consent_version" text NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "psychologist_profiles_crp_number_crp_uf_key" UNIQUE("crp_number","crp_uf"),
	CONSTRAINT "psychologist_profiles_status_check" CHECK ("psychologist_profiles"."status" IN ('pending_verification', 'pending_crp_validation', 'active', 'suspended', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX "crp_validation_queue_status_submitted_at_idx" ON "crp_validation_queue" USING btree ("status","submitted_at");
--> statement-breakpoint

-- The block below is appended manually after `npm run db:generate`. Drizzle
-- does not generate (yet):
--   * Foreign keys to schemas it cannot inspect (`auth.users` lives in the
--     Supabase-managed `auth` schema and is not part of our Drizzle schema).
--   * `ENABLE ROW LEVEL SECURITY` / `CREATE POLICY` statements.
--   * SECURITY DEFINER functions or triggers.
-- Source of truth for the RLS strings: `db/schema/auth/policies.ts`. See
-- `db/migrations/README.md` for the manual-append contract enforced by
-- `policy-coverage.int.test.ts`.

-- Foreign keys to auth.users (Supabase-managed schema).
ALTER TABLE "psychologist_profiles"
  ADD CONSTRAINT "psychologist_profiles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES auth.users("id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "crp_validation_queue"
  ADD CONSTRAINT "crp_validation_queue_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES auth.users("id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "crp_validation_queue"
  ADD CONSTRAINT "crp_validation_queue_decided_by_fkey"
  FOREIGN KEY ("decided_by") REFERENCES auth.users("id");
--> statement-breakpoint

-- Owner-scoped RLS for `psychologist_profiles` (template from
-- `db/migrations/README.md`, with `owner_id` substituted for `user_id`).
ALTER TABLE "psychologist_profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select" ON "psychologist_profiles"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can insert" ON "psychologist_profiles"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can update" ON "psychologist_profiles"
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can delete" ON "psychologist_profiles"
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

-- Admin-only access for `crp_validation_queue`. RLS is enabled with no policy
-- for `authenticated` (deny by default) and a single explicit policy for
-- `service_role`. `service_role` already bypasses RLS at the role level, but
-- the explicit policy makes the access model legible at review time and
-- satisfies the policy-coverage integration test.
ALTER TABLE "crp_validation_queue" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "service role manages queue" ON "crp_validation_queue"
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
--> statement-breakpoint

-- `set_app_metadata(user_id, status)` mirrors the account status into
-- `auth.users.raw_app_meta_data` so the middleware can read status from the
-- JWT (issued from app_metadata) without a DB hop. SECURITY DEFINER lets the
-- function update `auth.users` even when invoked by the table owner via the
-- AFTER UPDATE trigger. EXECUTE is granted only to `service_role` so
-- application code cannot call the function directly — only the trigger
-- (which runs as the function definer) can use it.
CREATE OR REPLACE FUNCTION public.set_app_metadata(p_user_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  UPDATE auth.users
     SET raw_app_meta_data =
           COALESCE(raw_app_meta_data, '{}'::jsonb)
           || jsonb_build_object('account_status', p_status)
   WHERE id = p_user_id;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.set_app_metadata(uuid, text) FROM PUBLIC;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.set_app_metadata(uuid, text) TO service_role;
--> statement-breakpoint

-- BEFORE UPDATE bookkeeping trigger: `updated_at` advances on every UPDATE,
-- and `status_changed_at` advances only when `status` actually changes. This
-- realises the spec scenario "updated_at and status_changed_at track distinct
-- events".
CREATE OR REPLACE FUNCTION public.psychologist_profiles_set_timestamps()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER psychologist_profiles_set_timestamps
BEFORE UPDATE ON "psychologist_profiles"
FOR EACH ROW
EXECUTE FUNCTION public.psychologist_profiles_set_timestamps();
--> statement-breakpoint

-- AFTER UPDATE OF status trigger: mirrors the new status into
-- `auth.users.raw_app_meta_data` via `set_app_metadata`.
CREATE OR REPLACE FUNCTION public.psychologist_profiles_mirror_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  PERFORM public.set_app_metadata(NEW.user_id, NEW.status);
  RETURN NEW;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.psychologist_profiles_mirror_status() FROM PUBLIC;
--> statement-breakpoint

CREATE TRIGGER psychologist_profiles_mirror_status
AFTER UPDATE OF status ON "psychologist_profiles"
FOR EACH ROW
EXECUTE FUNCTION public.psychologist_profiles_mirror_status();
