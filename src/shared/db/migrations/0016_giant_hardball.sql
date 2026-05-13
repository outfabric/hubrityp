-- Inbox additions migration: creates `whatsapp_conversations` table,
-- adds inbox columns to `whatsapp_messages`, with FK constraints,
-- GIN index for full-text search, and owner-scoped RLS policies.

-- =====================================================================
-- 1. CREATE TABLE — whatsapp_conversations
-- =====================================================================

CREATE TABLE "whatsapp_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"last_message_id" uuid NOT NULL,
	"last_message_at" timestamp with time zone NOT NULL,
	"last_message_preview" varchar(80) NOT NULL,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"has_risk" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "whatsapp_conversations_user_id_patient_id_unique" UNIQUE("user_id","patient_id")
);
--> statement-breakpoint

-- =====================================================================
-- 2. ALTER TABLE whatsapp_messages — add inbox columns
-- =====================================================================

ALTER TABLE "whatsapp_messages" ADD COLUMN "read_at_by_psychologist" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD COLUMN "resolved_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD COLUMN "risk_flag" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD COLUMN "risk_keywords" jsonb;
--> statement-breakpoint

-- =====================================================================
-- 3. Indexes — whatsapp_conversations
-- =====================================================================

CREATE INDEX "whatsapp_conversations_user_id_last_message_at_idx" ON "whatsapp_conversations" USING btree ("user_id","last_message_at");
--> statement-breakpoint
CREATE INDEX "whatsapp_conversations_user_id_has_risk_idx" ON "whatsapp_conversations" USING btree ("user_id","has_risk");
--> statement-breakpoint

-- =====================================================================
-- 4. Indexes — whatsapp_messages (new)
-- =====================================================================

-- Thread queries: "all messages for this user+patient, newest first"
CREATE INDEX "whatsapp_messages_user_patient_created_at_idx" ON "whatsapp_messages" USING btree ("user_id","patient_id","created_at");
--> statement-breakpoint

-- Full-text search on message body using Portuguese config
CREATE INDEX "whatsapp_messages_body_fts_idx" ON "whatsapp_messages"
  USING GIN (to_tsvector('portuguese', COALESCE("body", '')));
--> statement-breakpoint

-- =====================================================================
-- 5. Foreign Keys — whatsapp_conversations
-- =====================================================================

ALTER TABLE "whatsapp_conversations"
  ADD CONSTRAINT "whatsapp_conversations_user_id_auth_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "whatsapp_conversations"
  ADD CONSTRAINT "whatsapp_conversations_patient_id_patients_id_fk"
  FOREIGN KEY ("patient_id") REFERENCES "patients"(id) ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "whatsapp_conversations"
  ADD CONSTRAINT "whatsapp_conversations_last_message_id_whatsapp_messages_id_fk"
  FOREIGN KEY ("last_message_id") REFERENCES "whatsapp_messages"(id) ON DELETE CASCADE;
--> statement-breakpoint

-- =====================================================================
-- 6. Row Level Security — whatsapp_conversations (owner-scoped)
-- =====================================================================

ALTER TABLE "whatsapp_conversations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select whatsapp_conversations" ON "whatsapp_conversations"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can insert whatsapp_conversations" ON "whatsapp_conversations"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can update whatsapp_conversations" ON "whatsapp_conversations"
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can delete whatsapp_conversations" ON "whatsapp_conversations"
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
