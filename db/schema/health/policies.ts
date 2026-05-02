// Owner-scoped RLS policies for the `health_pings` table.
//
// These SQL strings are the canonical template every future owner-scoped
// table copies (replacing the table and the column names). Append them
// **manually** to the generated migration file after running
// `npm run db:generate` — Drizzle does not generate RLS yet.
//
// See `db/migrations/README.md` for the template walkthrough.
export const healthPingsPolicies = [
  `ALTER TABLE health_pings ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "owner can select" ON health_pings
     FOR SELECT TO authenticated
     USING (auth.uid() = owner_id);`,
  `CREATE POLICY "owner can insert" ON health_pings
     FOR INSERT TO authenticated
     WITH CHECK (auth.uid() = owner_id);`,
  `CREATE POLICY "owner can update" ON health_pings
     FOR UPDATE TO authenticated
     USING (auth.uid() = owner_id)
     WITH CHECK (auth.uid() = owner_id);`,
  `CREATE POLICY "owner can delete" ON health_pings
     FOR DELETE TO authenticated
     USING (auth.uid() = owner_id);`,
] as const;
