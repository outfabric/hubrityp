// Owner-scoped RLS policies for the `whatsapp_accounts` table.
//
// These SQL strings are appended manually to the Drizzle-generated migration
// file because Drizzle does not emit RLS. The `user_id` column references
// the psychologist's `auth.users.id`, and the policies enforce that each
// psychologist can only access their own WhatsApp account.
export const whatsappAccountsPolicies = [
  `ALTER TABLE whatsapp_accounts ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "owner can select whatsapp_accounts" ON whatsapp_accounts
     FOR SELECT TO authenticated
     USING (auth.uid() = user_id);`,
  `CREATE POLICY "owner can insert whatsapp_accounts" ON whatsapp_accounts
     FOR INSERT TO authenticated
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "owner can update whatsapp_accounts" ON whatsapp_accounts
     FOR UPDATE TO authenticated
     USING (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "owner can delete whatsapp_accounts" ON whatsapp_accounts
     FOR DELETE TO authenticated
     USING (auth.uid() = user_id);`,
] as const;

// Owner-scoped RLS policies for the `message_templates` table.
//
// Same pattern as `whatsapp_accounts` — direct ownership via `user_id`.
// Each psychologist can only manage their own templates.
export const messageTemplatesPolicies = [
  `ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "owner can select message_templates" ON message_templates
     FOR SELECT TO authenticated
     USING (auth.uid() = user_id);`,
  `CREATE POLICY "owner can insert message_templates" ON message_templates
     FOR INSERT TO authenticated
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "owner can update message_templates" ON message_templates
     FOR UPDATE TO authenticated
     USING (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "owner can delete message_templates" ON message_templates
     FOR DELETE TO authenticated
     USING (auth.uid() = user_id);`,
] as const;
