-- Remove `confirmacao_recebida` from the `message_templates.template_key` model.
--
-- In the shared-number MVP the confirmation acknowledgment becomes a free-form
-- WhatsApp message (Option B), not a template type. The `template_key` enum is
-- reduced from six to five values and every platform-seeded `confirmacao_recebida`
-- row is deleted.
--
-- DESTRUCTIVE BY DESIGN (forward-only):
--   1. DELETE FROM message_templates WHERE template_key = 'confirmacao_recebida'.
--      These rows are platform-seeded copies (`is_default = true`, identical
--      body across every psychologist). No legitimate user customization of this
--      key exists in the MVP — the editing surface is not shipped — so the delete
--      loses no user-authored content.
--   2. Drop + recreate the `message_templates_template_key_check` CHECK with the
--      five remaining keys, so future inserts of `confirmacao_recebida` are
--      rejected at the database layer.
--
-- NOT TOUCHED:
--   `whatsapp_messages.template_key` has NO CHECK constraint (verified in schema)
--   — historical acknowledgment rows that recorded `template_key =
--   'confirmacao_recebida'` keep their value and remain readable. This migration
--   deliberately does not read from or write to `whatsapp_messages`.
--
-- ROLLBACK PATH (manual, cheap): re-run this migration's inverse —
--   ALTER TABLE "message_templates" DROP CONSTRAINT "message_templates_template_key_check";
--   ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_template_key_check"
--     CHECK ("template_key" IN ('lembrete_24h', 'lembrete_2h', 'confirmacao_recebida',
--                               'cancelamento_aviso', 'link_video', 'termo_consentimento'));
--   then re-seed the deleted rows with a targeted per-user INSERT (the seeder is
--   idempotent only when a user has zero templates, so a global re-seed will not
--   backfill users who already own the other five — a targeted INSERT is required).

DELETE FROM "message_templates" WHERE "template_key" = 'confirmacao_recebida';
--> statement-breakpoint

ALTER TABLE "message_templates"
  DROP CONSTRAINT "message_templates_template_key_check";
--> statement-breakpoint

ALTER TABLE "message_templates"
  ADD CONSTRAINT "message_templates_template_key_check"
  CHECK ("template_key" IN ('lembrete_24h', 'lembrete_2h', 'cancelamento_aviso', 'link_video', 'termo_consentimento'));
