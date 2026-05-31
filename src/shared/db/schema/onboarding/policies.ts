// Owner-scoped RLS policies for the onboarding-domain tables.
//
// Both `onboarding_checklist` and `notification_preferences` are scoped to a
// single `user_id` (the psychologist's `auth.users.id`). Psychologists can
// SELECT, INSERT, and UPDATE their own row — INSERT/UPDATE carry a WITH CHECK
// so a row cannot be created/moved to another user's `user_id`.
//
// There is intentionally NO DELETE policy (least-privilege choice): rows are
// per-user singletons that should persist for the lifetime of the account, and
// account deletion cascades via the cross-schema FK to `auth.users` rather than
// through a user-visible DELETE. `email_critical` is non-disableable at the
// application layer (see the table comment in `tables.ts`).
//
// These SQL strings are appended manually to the Drizzle-generated migration
// because Drizzle does not emit `ENABLE ROW LEVEL SECURITY` or `CREATE POLICY`.
export const onboardingChecklistPolicies = [
  `ALTER TABLE onboarding_checklist ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "onboarding_checklist_select_own" ON onboarding_checklist
     FOR SELECT TO authenticated
     USING (auth.uid() = user_id);`,
  `CREATE POLICY "onboarding_checklist_insert_own" ON onboarding_checklist
     FOR INSERT TO authenticated
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "onboarding_checklist_update_own" ON onboarding_checklist
     FOR UPDATE TO authenticated
     USING (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id);`,
] as const;

export const notificationPreferencesPolicies = [
  `ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "notification_preferences_select_own" ON notification_preferences
     FOR SELECT TO authenticated
     USING (auth.uid() = user_id);`,
  `CREATE POLICY "notification_preferences_insert_own" ON notification_preferences
     FOR INSERT TO authenticated
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "notification_preferences_update_own" ON notification_preferences
     FOR UPDATE TO authenticated
     USING (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id);`,
] as const;
