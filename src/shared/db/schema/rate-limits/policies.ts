// RLS policies for the `rate_limits` infrastructure table.
//
// This table is never queried by end-users via Supabase client — it is
// exclusively accessed by the app-level Drizzle client (postgres superuser)
// inside Server Actions. RLS is enabled to satisfy the project-wide mandate,
// but all four operations are restricted to `service_role` only.
//
// The `authenticated` role has no policies, so any direct access via Supabase
// PostgREST (which sets `role = authenticated`) is blocked by default.
export const rateLimitsPolicies = [
  `ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "service_role can select rate_limits" ON rate_limits
     FOR SELECT TO service_role
     USING (true);`,
  `CREATE POLICY "service_role can insert rate_limits" ON rate_limits
     FOR INSERT TO service_role
     WITH CHECK (true);`,
  `CREATE POLICY "service_role can update rate_limits" ON rate_limits
     FOR UPDATE TO service_role
     USING (true)
     WITH CHECK (true);`,
  `CREATE POLICY "service_role can delete rate_limits" ON rate_limits
     FOR DELETE TO service_role
     USING (true);`,
] as const;
