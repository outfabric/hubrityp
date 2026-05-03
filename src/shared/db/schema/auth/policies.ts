// RLS policies for the `auth` domain.
//
// These SQL strings are the source of truth for what the **manually appended**
// section of the generated migration must contain. Drizzle does not generate
// `ENABLE ROW LEVEL SECURITY` or `CREATE POLICY` statements yet, so the
// `db:generate` output must be amended by hand before commit. The integration
// suite (`policy-coverage.int.test.ts`) verifies that every Drizzle table has
// at least one matching `CREATE POLICY ... ON <table>` line in
// `src/shared/db/migrations/**`, which guarantees this contract is met.
//
// See `src/shared/db/migrations/README.md` for the canonical owner-scoped
// template the `psychologist_profiles` policies are derived from.

// `psychologist_profiles` is keyed by `user_id` (Supabase Auth subject), so
// we substitute `user_id` for the template's `owner_id`. Each authenticated
// user can read/write **only their own** profile row.
export const psychologistProfilesPolicies = [
  `ALTER TABLE psychologist_profiles ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "owner can select" ON psychologist_profiles
     FOR SELECT TO authenticated
     USING (auth.uid() = user_id);`,
  `CREATE POLICY "owner can insert" ON psychologist_profiles
     FOR INSERT TO authenticated
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "owner can update" ON psychologist_profiles
     FOR UPDATE TO authenticated
     USING (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "owner can delete" ON psychologist_profiles
     FOR DELETE TO authenticated
     USING (auth.uid() = user_id);`,
] as const;

// `crp_validation_queue` is admin-only. We do NOT issue any policy for the
// `authenticated` role — RLS without a permissive policy denies by default.
// `service_role` already bypasses RLS at the role level (it is created with
// `BYPASSRLS` in production and in our test bootstrap), so it would work
// without an explicit policy; we still ship one so the policy-coverage test
// (which scans for `CREATE POLICY ... ON crp_validation_queue`) sees a hit
// and to make the access model legible to a reviewer reading the migration.
export const crpValidationQueuePolicies = [
  `ALTER TABLE crp_validation_queue ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "service role manages queue" ON crp_validation_queue
     FOR ALL TO service_role
     USING (true)
     WITH CHECK (true);`,
] as const;

// `auth_resend_log` is service-role only — the rate-limit query and the
// insert that records each resend run through the admin Supabase client.
// Same access model as `crp_validation_queue`: RLS enabled with no policy
// for `authenticated` (deny by default) plus an explicit policy targeting
// `service_role` for legibility and policy-coverage.
export const authResendLogPolicies = [
  `ALTER TABLE auth_resend_log ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "service role manages resend log" ON auth_resend_log
     FOR ALL TO service_role
     USING (true)
     WITH CHECK (true);`,
] as const;
