// Owner-scoped RLS policies for the `notifications` table.
//
// Psychologists can SELECT and UPDATE (mark as read) their own notifications.
// INSERT and DELETE are reserved for the service role — notifications are
// created by background jobs (Inngest functions) that bypass RLS via the
// service-role connection. Psychologists should not be able to fabricate or
// delete notifications.
export const notificationsPolicies = [
  `ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "owner can select notifications" ON notifications
     FOR SELECT TO authenticated
     USING (auth.uid() = user_id);`,
  `CREATE POLICY "owner can update notifications" ON notifications
     FOR UPDATE TO authenticated
     USING (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id);`,
] as const;
