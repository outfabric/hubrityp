-- WhatsApp foundation migration: creates `whatsapp_accounts` and
-- `message_templates` tables with FK constraints to auth.users, CHECK
-- constraints for enum columns, and owner-scoped RLS policies.

-- =====================================================================
-- 1. CREATE TABLE — whatsapp_accounts
-- =====================================================================

CREATE TABLE "whatsapp_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text DEFAULT 'twilio' NOT NULL,
	"account_id" varchar(255) NOT NULL,
	"phone_number" varchar(20) NOT NULL,
	"display_name" varchar(120),
	"status" text DEFAULT 'active' NOT NULL,
	"consent_given_at" timestamp with time zone NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now(),
	"last_health_check_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_accounts_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint

-- =====================================================================
-- 2. CREATE TABLE — message_templates
-- =====================================================================

CREATE TABLE "message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"template_key" varchar(50) NOT NULL,
	"body" text NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"meta_template_id" varchar(255),
	"meta_status" text DEFAULT 'pending',
	"is_default" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_templates_user_id_template_key_unique" UNIQUE("user_id","template_key")
);
--> statement-breakpoint

-- =====================================================================
-- 3. Foreign Keys — user_id -> auth.users(id) ON DELETE CASCADE
-- =====================================================================

ALTER TABLE "whatsapp_accounts"
  ADD CONSTRAINT "whatsapp_accounts_user_id_auth_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "message_templates"
  ADD CONSTRAINT "message_templates_user_id_auth_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint

-- =====================================================================
-- 4. CHECK Constraints
-- =====================================================================

-- whatsapp_accounts.provider — Twilio is the sole BSP
ALTER TABLE "whatsapp_accounts"
  ADD CONSTRAINT "whatsapp_accounts_provider_check"
  CHECK ("provider" IN ('twilio'));
--> statement-breakpoint

-- whatsapp_accounts.status — connection lifecycle
ALTER TABLE "whatsapp_accounts"
  ADD CONSTRAINT "whatsapp_accounts_status_check"
  CHECK ("status" IN ('active', 'disconnected', 'error'));
--> statement-breakpoint

-- message_templates.meta_status — Meta/WhatsApp approval lifecycle
ALTER TABLE "message_templates"
  ADD CONSTRAINT "message_templates_meta_status_check"
  CHECK ("meta_status" IN ('approved', 'pending', 'rejected'));
--> statement-breakpoint

-- message_templates.template_key — fixed set of template purposes
ALTER TABLE "message_templates"
  ADD CONSTRAINT "message_templates_template_key_check"
  CHECK ("template_key" IN ('lembrete_24h', 'lembrete_2h', 'confirmacao_recebida', 'cancelamento_aviso', 'link_video', 'termo_consentimento'));
--> statement-breakpoint

-- =====================================================================
-- 5. Row Level Security — whatsapp_accounts (owner-scoped via user_id)
-- =====================================================================

ALTER TABLE "whatsapp_accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select whatsapp_accounts" ON "whatsapp_accounts"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can insert whatsapp_accounts" ON "whatsapp_accounts"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can update whatsapp_accounts" ON "whatsapp_accounts"
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can delete whatsapp_accounts" ON "whatsapp_accounts"
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

-- =====================================================================
-- 6. Row Level Security — message_templates (owner-scoped via user_id)
-- =====================================================================

ALTER TABLE "message_templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select message_templates" ON "message_templates"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can insert message_templates" ON "message_templates"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can update message_templates" ON "message_templates"
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can delete message_templates" ON "message_templates"
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
