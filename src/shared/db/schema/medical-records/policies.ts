// Owner-scoped RLS policies for the medical-records domain tables.
//
// These SQL strings follow the canonical template documented in
// `src/shared/db/migrations/README.md`. They are appended **manually** to
// the Drizzle-generated migration file because Drizzle does not emit RLS.
//
// KEY DIFFERENCE from other domains: NO DELETE policy on any table.
// Lei 13.787/2018 mandates 20-year retention of clinical records — deletion
// is not permitted at any level.

// Owner-scoped RLS for `evolutions`. SELECT/INSERT/UPDATE only.
// The `user_id` column references the psychologist's `auth.users.id`.
export const evolutionsPolicies = [
  `ALTER TABLE evolutions ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "owner can select evolutions" ON evolutions
     FOR SELECT TO authenticated
     USING (auth.uid() = user_id);`,
  `CREATE POLICY "owner can insert evolutions" ON evolutions
     FOR INSERT TO authenticated
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "owner can update evolutions" ON evolutions
     FOR UPDATE TO authenticated
     USING (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id);`,
] as const;

// JOIN-scoped RLS for `evolution_versions`. SELECT/INSERT/UPDATE only.
// Ownership is derived via the parent `evolutions` row:
//   evolution_id IN (SELECT id FROM evolutions WHERE user_id = auth.uid())
export const evolutionVersionsPolicies = [
  `ALTER TABLE evolution_versions ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "owner can select evolution_versions" ON evolution_versions
     FOR SELECT TO authenticated
     USING (evolution_id IN (SELECT id FROM evolutions WHERE user_id = auth.uid()));`,
  `CREATE POLICY "owner can insert evolution_versions" ON evolution_versions
     FOR INSERT TO authenticated
     WITH CHECK (evolution_id IN (SELECT id FROM evolutions WHERE user_id = auth.uid()));`,
  `CREATE POLICY "owner can update evolution_versions" ON evolution_versions
     FOR UPDATE TO authenticated
     USING (evolution_id IN (SELECT id FROM evolutions WHERE user_id = auth.uid()))
     WITH CHECK (evolution_id IN (SELECT id FROM evolutions WHERE user_id = auth.uid()));`,
] as const;

// Restricted RLS for `audit_log`. SELECT only for authenticated users (own
// entries). No INSERT/UPDATE/DELETE — service-role writes the immutable trail.
export const auditLogPolicies = [
  `ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "user can select own audit entries" ON audit_log
     FOR SELECT TO authenticated
     USING (auth.uid() = user_id);`,
] as const;
