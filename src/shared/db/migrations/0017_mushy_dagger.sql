-- Medical-records domain migration: creates `evolutions`, `evolution_versions`,
-- and `audit_log` tables with indexes, FK constraints, and owner-scoped RLS.
-- NO DELETE policy on any table — Lei 13.787/2018 mandates 20-year retention.

-- =====================================================================
-- 1. CREATE TABLES
-- =====================================================================

CREATE TABLE "evolutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"session_id" uuid,
	"template_type" text NOT NULL,
	"content" jsonb NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "evolutions_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint

CREATE TABLE "evolution_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evolution_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"content" jsonb NOT NULL,
	"is_addendum" boolean DEFAULT false NOT NULL,
	"modified_by" uuid NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evolution_versions_evo_version_unique" UNIQUE("evolution_id","version_number")
);
--> statement-breakpoint

CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- =====================================================================
-- 2. INDEXES
-- =====================================================================

CREATE INDEX "idx_evolutions_patient_created" ON "evolutions" USING btree ("patient_id","created_at");
--> statement-breakpoint
CREATE INDEX "idx_evolution_versions_evolution" ON "evolution_versions" USING btree ("evolution_id","version_number");
--> statement-breakpoint
CREATE INDEX "idx_audit_log_user_created" ON "audit_log" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX "idx_audit_log_resource" ON "audit_log" USING btree ("resource_type","resource_id");
--> statement-breakpoint

-- =====================================================================
-- 3. FOREIGN KEY CONSTRAINTS
-- =====================================================================

ALTER TABLE "evolutions"
  ADD CONSTRAINT "evolutions_user_id_auth_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id);
--> statement-breakpoint

ALTER TABLE "evolutions"
  ADD CONSTRAINT "evolutions_patient_id_patients_id_fk"
  FOREIGN KEY ("patient_id") REFERENCES "patients"(id);
--> statement-breakpoint

ALTER TABLE "evolutions"
  ADD CONSTRAINT "evolutions_session_id_sessions_id_fk"
  FOREIGN KEY ("session_id") REFERENCES "sessions"(id);
--> statement-breakpoint

ALTER TABLE "evolution_versions"
  ADD CONSTRAINT "evolution_versions_evolution_id_evolutions_id_fk"
  FOREIGN KEY ("evolution_id") REFERENCES "evolutions"(id) ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "evolution_versions"
  ADD CONSTRAINT "evolution_versions_modified_by_auth_users_id_fk"
  FOREIGN KEY ("modified_by") REFERENCES auth.users(id);
--> statement-breakpoint

ALTER TABLE "audit_log"
  ADD CONSTRAINT "audit_log_user_id_auth_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id);
--> statement-breakpoint

-- =====================================================================
-- 4. ROW LEVEL SECURITY — evolutions (SELECT/INSERT/UPDATE only)
-- =====================================================================

ALTER TABLE "evolutions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select evolutions" ON "evolutions"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can insert evolutions" ON "evolutions"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can update evolutions" ON "evolutions"
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

-- =====================================================================
-- 5. ROW LEVEL SECURITY — evolution_versions (SELECT/INSERT/UPDATE only)
-- =====================================================================

ALTER TABLE "evolution_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select evolution_versions" ON "evolution_versions"
  FOR SELECT TO authenticated
  USING (evolution_id IN (SELECT id FROM evolutions WHERE user_id = auth.uid()));
--> statement-breakpoint

CREATE POLICY "owner can insert evolution_versions" ON "evolution_versions"
  FOR INSERT TO authenticated
  WITH CHECK (evolution_id IN (SELECT id FROM evolutions WHERE user_id = auth.uid()));
--> statement-breakpoint

CREATE POLICY "owner can update evolution_versions" ON "evolution_versions"
  FOR UPDATE TO authenticated
  USING (evolution_id IN (SELECT id FROM evolutions WHERE user_id = auth.uid()))
  WITH CHECK (evolution_id IN (SELECT id FROM evolutions WHERE user_id = auth.uid()));
--> statement-breakpoint

-- =====================================================================
-- 6. ROW LEVEL SECURITY — audit_log (SELECT only, service-role writes)
-- =====================================================================

ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "user can select own audit entries" ON "audit_log"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
