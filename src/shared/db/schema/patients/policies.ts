// Owner-scoped RLS policies for the `patients` table.
//
// These SQL strings follow the canonical template documented in
// `src/shared/db/migrations/README.md`. They are appended **manually** to
// the Drizzle-generated migration file because Drizzle does not emit RLS.
//
// The `user_id` column references the psychologist's `auth.users.id`, and
// the policies enforce that each psychologist can only access their own
// patients — no cross-tenant visibility.
export const patientsPolicies = [
  `ALTER TABLE patients ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "owner can select" ON patients
     FOR SELECT TO authenticated
     USING (auth.uid() = user_id);`,
  `CREATE POLICY "owner can insert" ON patients
     FOR INSERT TO authenticated
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "owner can update" ON patients
     FOR UPDATE TO authenticated
     USING (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "owner can delete" ON patients
     FOR DELETE TO authenticated
     USING (auth.uid() = user_id);`,
] as const;

// Owner-scoped RLS policies for `patient_guardians`. The table has no
// `user_id` column — ownership is derived via the parent `patients` row:
//   patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid())
//
// INSERT uses WITH CHECK (same subquery) to prevent a psychologist from
// attaching a guardian to another psychologist's patient.
export const patientGuardiansPolicies = [
  `ALTER TABLE patient_guardians ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "owner can select guardians" ON patient_guardians
     FOR SELECT TO authenticated
     USING (patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid()));`,
  `CREATE POLICY "owner can insert guardians" ON patient_guardians
     FOR INSERT TO authenticated
     WITH CHECK (patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid()));`,
  `CREATE POLICY "owner can update guardians" ON patient_guardians
     FOR UPDATE TO authenticated
     USING (patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid()))
     WITH CHECK (patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid()));`,
  `CREATE POLICY "owner can delete guardians" ON patient_guardians
     FOR DELETE TO authenticated
     USING (patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid()));`,
] as const;
