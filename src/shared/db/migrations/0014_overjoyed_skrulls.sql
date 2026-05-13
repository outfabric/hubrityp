-- Reminders engine migration: creates `reminder_settings` and
-- `whatsapp_messages` tables, adds `reminders_disabled` column to
-- `sessions`, with FK constraints to auth.users/patients/sessions,
-- CHECK constraints for enum columns, partial UNIQUE indexes, and
-- owner-scoped RLS policies.

-- =====================================================================
-- 1. CREATE TABLE — reminder_settings
-- =====================================================================

CREATE TABLE "reminder_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"early_reminder_hours" integer,
	"final_reminder_hours" integer,
	"video_link_minutes" integer DEFAULT 30 NOT NULL,
	"send_during_night" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint

-- =====================================================================
-- 2. CREATE TABLE — whatsapp_messages
-- =====================================================================

CREATE TABLE "whatsapp_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"patient_id" uuid,
	"session_id" uuid,
	"direction" text NOT NULL,
	"to_phone" varchar(20),
	"from_phone" varchar(20),
	"body" text,
	"template_key" varchar(50),
	"bsp_message_id" varchar(255),
	"idempotency_key" varchar(64),
	"status" text,
	"error_reason" text,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- =====================================================================
-- 3. ALTER TABLE sessions — add reminders_disabled column
-- =====================================================================

ALTER TABLE "sessions" ADD COLUMN "reminders_disabled" boolean DEFAULT false;
--> statement-breakpoint

-- =====================================================================
-- 4. Indexes — whatsapp_messages
-- =====================================================================

CREATE INDEX "whatsapp_messages_user_id_created_at_idx" ON "whatsapp_messages" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX "whatsapp_messages_session_id_idx" ON "whatsapp_messages" USING btree ("session_id");
--> statement-breakpoint
CREATE INDEX "whatsapp_messages_patient_id_created_at_idx" ON "whatsapp_messages" USING btree ("patient_id","created_at");
--> statement-breakpoint

-- =====================================================================
-- 5. Partial UNIQUE indexes — whatsapp_messages
-- =====================================================================

-- BSP message ID must be unique when present (allows NULL for messages
-- not yet acknowledged by the BSP).
CREATE UNIQUE INDEX "whatsapp_messages_bsp_message_id_unique_idx"
  ON "whatsapp_messages" ("bsp_message_id")
  WHERE "bsp_message_id" IS NOT NULL;
--> statement-breakpoint

-- Idempotency key must be unique for non-failed messages (allows
-- retrying a failed send with the same idempotency key).
CREATE UNIQUE INDEX "whatsapp_messages_idempotency_key_unique_idx"
  ON "whatsapp_messages" ("idempotency_key")
  WHERE "status" != 'failed' AND "idempotency_key" IS NOT NULL;
--> statement-breakpoint

-- =====================================================================
-- 6. Foreign Keys — reminder_settings
-- =====================================================================

ALTER TABLE "reminder_settings"
  ADD CONSTRAINT "reminder_settings_user_id_auth_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint

-- =====================================================================
-- 7. Foreign Keys — whatsapp_messages
-- =====================================================================

ALTER TABLE "whatsapp_messages"
  ADD CONSTRAINT "whatsapp_messages_user_id_auth_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "whatsapp_messages"
  ADD CONSTRAINT "whatsapp_messages_patient_id_patients_id_fk"
  FOREIGN KEY ("patient_id") REFERENCES "patients"(id) ON DELETE SET NULL;
--> statement-breakpoint

ALTER TABLE "whatsapp_messages"
  ADD CONSTRAINT "whatsapp_messages_session_id_sessions_id_fk"
  FOREIGN KEY ("session_id") REFERENCES "sessions"(id) ON DELETE SET NULL;
--> statement-breakpoint

-- =====================================================================
-- 8. CHECK Constraints
-- =====================================================================

-- whatsapp_messages.direction — only outbound or inbound
ALTER TABLE "whatsapp_messages"
  ADD CONSTRAINT "whatsapp_messages_direction_check"
  CHECK ("direction" IN ('outbound', 'inbound'));
--> statement-breakpoint

-- whatsapp_messages.status — BSP delivery lifecycle
ALTER TABLE "whatsapp_messages"
  ADD CONSTRAINT "whatsapp_messages_status_check"
  CHECK ("status" IN ('queued', 'sent', 'delivered', 'read', 'failed', 'unable_to_send'));
--> statement-breakpoint

-- =====================================================================
-- 9. Row Level Security — reminder_settings (owner-scoped via user_id)
-- =====================================================================

ALTER TABLE "reminder_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select reminder_settings" ON "reminder_settings"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can insert reminder_settings" ON "reminder_settings"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can update reminder_settings" ON "reminder_settings"
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can delete reminder_settings" ON "reminder_settings"
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

-- =====================================================================
-- 10. Row Level Security — whatsapp_messages (owner-scoped, no DELETE)
-- =====================================================================

ALTER TABLE "whatsapp_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select whatsapp_messages" ON "whatsapp_messages"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can insert whatsapp_messages" ON "whatsapp_messages"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can update whatsapp_messages" ON "whatsapp_messages"
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
