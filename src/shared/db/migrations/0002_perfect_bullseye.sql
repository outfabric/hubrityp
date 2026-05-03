CREATE TABLE "auth_resend_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "auth_resend_log_user_id_sent_at_idx" ON "auth_resend_log" USING btree ("user_id","sent_at" DESC NULLS LAST);
--> statement-breakpoint

-- The block below is appended manually after `npm run db:generate`. Drizzle
-- does not generate (yet):
--   * Foreign keys to schemas it cannot inspect (`auth.users` lives in the
--     Supabase-managed `auth` schema and is not part of our Drizzle schema).
--   * `ENABLE ROW LEVEL SECURITY` / `CREATE POLICY` statements.
-- Source of truth for the RLS strings: `db/schema/auth/policies.ts`. See
-- `db/migrations/README.md` for the manual-append contract enforced by
-- `policy-coverage.int.test.ts`.

-- Foreign key to auth.users (Supabase-managed schema). ON DELETE CASCADE so
-- that a hard-deleted user's resend history is removed too.
ALTER TABLE "auth_resend_log"
  ADD CONSTRAINT "auth_resend_log_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES auth.users("id") ON DELETE CASCADE;
--> statement-breakpoint

-- Admin-only access for `auth_resend_log`. RLS is enabled with no policy for
-- `authenticated` (deny by default) and a single explicit policy for
-- `service_role`. `service_role` already bypasses RLS at the role level; the
-- explicit policy makes the access model legible at review time and
-- satisfies the policy-coverage integration test.
ALTER TABLE "auth_resend_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "service role manages resend log" ON "auth_resend_log"
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
