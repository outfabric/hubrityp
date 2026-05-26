-- (a) ADD COLUMN nullable — safe for existing rows
ALTER TABLE "consent_terms" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "consent_terms" ADD COLUMN "template_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "consent_terms" ADD COLUMN "template_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "consent_terms" ADD COLUMN "revocation_takes_effect_immediately" boolean;--> statement-breakpoint
ALTER TABLE "consent_terms" ADD COLUMN "revocation_reason" text;--> statement-breakpoint

-- (b) Backfill existing rows: general consent, revocation does NOT take effect immediately
UPDATE consent_terms SET kind = 'general', revocation_takes_effect_immediately = false WHERE kind IS NULL;--> statement-breakpoint

-- (c) Tighten NOT NULL now that every row has a value
ALTER TABLE "consent_terms" ALTER COLUMN "kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "consent_terms" ALTER COLUMN "revocation_takes_effect_immediately" SET NOT NULL;--> statement-breakpoint

-- (d) CHECK constraint: only allow known kind values
ALTER TABLE "consent_terms" ADD CONSTRAINT "consent_terms_kind_check" CHECK (kind IN ('general','ai_recording'));--> statement-breakpoint

-- (e) Operational index for the consent lookup helper (find active consent by user+patient+kind)
CREATE INDEX "idx_consent_terms_user_patient_kind_revoked" ON "consent_terms" ("user_id","patient_id","kind","revoked_at");
