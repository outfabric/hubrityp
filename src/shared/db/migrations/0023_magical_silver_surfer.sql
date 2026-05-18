-- Clinical documents domain migration: creates `clinical_documents` table with
-- indexes, FK constraints, CHECK constraints on document_type/status/signature_method,
-- and owner-scoped RLS with finalized-update protection.
-- NO DELETE policy — Lei 13.787/2018 mandates 20-year retention.

-- =====================================================================
-- 1. CREATE TABLE
-- =====================================================================

CREATE TABLE "clinical_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pdf_storage_path" text,
	"pdf_size" integer,
	"digitally_signed" boolean DEFAULT false NOT NULL,
	"signature_method" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"references_cid10" boolean DEFAULT false NOT NULL,
	"cid10_consent_confirmed" boolean DEFAULT false NOT NULL,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- =====================================================================
-- 2. INDEXES
-- =====================================================================

CREATE INDEX "idx_clinical_docs_patient_type_created" ON "clinical_documents" USING btree ("patient_id","document_type","created_at");
--> statement-breakpoint
CREATE INDEX "idx_clinical_docs_status_finalized" ON "clinical_documents" USING btree ("status","finalized_at");
--> statement-breakpoint
CREATE INDEX "idx_clinical_docs_user_id" ON "clinical_documents" USING btree ("user_id");
--> statement-breakpoint

-- =====================================================================
-- 3. CHECK CONSTRAINTS
-- =====================================================================

ALTER TABLE "clinical_documents"
  ADD CONSTRAINT "clinical_documents_document_type_check"
  CHECK (document_type IN ('declaracao','atestado','relatorio','laudo','parecer'));
--> statement-breakpoint

ALTER TABLE "clinical_documents"
  ADD CONSTRAINT "clinical_documents_status_check"
  CHECK (status IN ('draft','finalized'));
--> statement-breakpoint

ALTER TABLE "clinical_documents"
  ADD CONSTRAINT "clinical_documents_signature_method_check"
  CHECK (signature_method IS NULL OR signature_method IN ('icp-brasil','manual'));
--> statement-breakpoint

-- =====================================================================
-- 4. FOREIGN KEY CONSTRAINTS
-- =====================================================================

ALTER TABLE "clinical_documents"
  ADD CONSTRAINT "clinical_documents_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id);
--> statement-breakpoint

ALTER TABLE "clinical_documents"
  ADD CONSTRAINT "clinical_documents_patient_id_fk"
  FOREIGN KEY ("patient_id") REFERENCES "patients"(id);
--> statement-breakpoint

-- =====================================================================
-- 5. ROW LEVEL SECURITY — clinical_documents (SELECT/INSERT/UPDATE only)
--    UPDATE policy has an additional `status = 'draft'` guard in the
--    USING clause: once a document is finalized the row is immutable.
-- =====================================================================

ALTER TABLE "clinical_documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select clinical_documents" ON "clinical_documents"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can insert clinical_documents" ON "clinical_documents"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can update draft clinical_documents" ON "clinical_documents"
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND status = 'draft')
  WITH CHECK (auth.uid() = user_id);