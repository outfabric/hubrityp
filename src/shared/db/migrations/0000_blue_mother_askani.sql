CREATE TABLE "health_pings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint

-- Owner-scoped RLS template. Mirror these four policies for every future
-- owner-scoped table. See `db/migrations/README.md` for the canonical
-- walkthrough and `db/schema/health/policies.ts` for the source of truth.

ALTER TABLE "health_pings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select" ON "health_pings"
  FOR SELECT TO authenticated
  USING (auth.uid() = owner_id);
--> statement-breakpoint

CREATE POLICY "owner can insert" ON "health_pings"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id);
--> statement-breakpoint

CREATE POLICY "owner can update" ON "health_pings"
  FOR UPDATE TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);
--> statement-breakpoint

CREATE POLICY "owner can delete" ON "health_pings"
  FOR DELETE TO authenticated
  USING (auth.uid() = owner_id);
