// Auth-domain RLS policies. These SQL strings are the source of truth for
// the user-visible read/write surface of `profiles`, `auth_logs`, and
// `auth_sessions`. They are appended **manually** to the Drizzle-generated
// migration file because Drizzle does not yet emit `ENABLE ROW LEVEL
// SECURITY` or `CREATE POLICY` SQL.
//
// Auth-domain policies intentionally diverge from the canonical
// owner-scoped template documented in
// `src/shared/db/migrations/README.md`:
//
//   - `profiles` has only SELECT and UPDATE policies for end-users. INSERT
//     is reserved for the SECURITY DEFINER trigger `handle_new_user()`;
//     DELETE is service-role only (account deletion is out of scope here).
//   - `auth_logs` and `auth_sessions` only expose SELECT to end-users.
//     INSERT/UPDATE/DELETE are reserved for the service role.
//
// The policy-coverage integration test
// (`src/__tests__/integration/policy-coverage.int.test.ts`) only checks
// that each table has *at least one* `CREATE POLICY` line in the migration,
// which the policies below satisfy.
export const profilesPolicies = [
  `ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "user can select own profile" ON profiles
     FOR SELECT TO authenticated
     USING (auth.uid() = user_id);`,
  `CREATE POLICY "user can update own profile" ON profiles
     FOR UPDATE TO authenticated
     USING (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id);`,
] as const;

export const authLogsPolicies = [
  `ALTER TABLE auth_logs ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "user can select own auth log" ON auth_logs
     FOR SELECT TO authenticated
     USING (auth.uid() = user_id);`,
] as const;

export const authSessionsPolicies = [
  `ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "user can select own auth session" ON auth_sessions
     FOR SELECT TO authenticated
     USING (auth.uid() = user_id);`,
] as const;
