// Owner-scoped RLS policies for the agenda domain tables.
//
// These SQL strings follow the canonical template documented in
// `src/shared/db/migrations/README.md`. They are appended **manually** to
// the Drizzle-generated migration file because Drizzle does not emit RLS.
//
// All four tables (locations, agenda_settings, sessions, session_history)
// have their own `user_id` column referencing the psychologist's
// `auth.users.id`, so policies enforce ownership directly via
// `user_id = auth.uid()` — the same pattern as `patients`.

export const locationsPolicies = [
  `ALTER TABLE locations ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "owner can select locations" ON locations
     FOR SELECT TO authenticated
     USING (auth.uid() = user_id);`,
  `CREATE POLICY "owner can insert locations" ON locations
     FOR INSERT TO authenticated
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "owner can update locations" ON locations
     FOR UPDATE TO authenticated
     USING (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "owner can delete locations" ON locations
     FOR DELETE TO authenticated
     USING (auth.uid() = user_id);`,
] as const;

export const agendaSettingsPolicies = [
  `ALTER TABLE agenda_settings ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "owner can select agenda_settings" ON agenda_settings
     FOR SELECT TO authenticated
     USING (auth.uid() = user_id);`,
  `CREATE POLICY "owner can insert agenda_settings" ON agenda_settings
     FOR INSERT TO authenticated
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "owner can update agenda_settings" ON agenda_settings
     FOR UPDATE TO authenticated
     USING (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "owner can delete agenda_settings" ON agenda_settings
     FOR DELETE TO authenticated
     USING (auth.uid() = user_id);`,
] as const;

export const sessionsPolicies = [
  `ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "owner can select sessions" ON sessions
     FOR SELECT TO authenticated
     USING (auth.uid() = user_id);`,
  `CREATE POLICY "owner can insert sessions" ON sessions
     FOR INSERT TO authenticated
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "owner can update sessions" ON sessions
     FOR UPDATE TO authenticated
     USING (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "owner can delete sessions" ON sessions
     FOR DELETE TO authenticated
     USING (auth.uid() = user_id);`,
] as const;

export const sessionHistoryPolicies = [
  `ALTER TABLE session_history ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "owner can select session_history" ON session_history
     FOR SELECT TO authenticated
     USING (auth.uid() = user_id);`,
  `CREATE POLICY "owner can insert session_history" ON session_history
     FOR INSERT TO authenticated
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "owner can update session_history" ON session_history
     FOR UPDATE TO authenticated
     USING (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "owner can delete session_history" ON session_history
     FOR DELETE TO authenticated
     USING (auth.uid() = user_id);`,
] as const;
