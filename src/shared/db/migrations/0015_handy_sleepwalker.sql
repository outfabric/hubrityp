CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(50) NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text,
	"action_url" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications" USING btree ("user_id","read_at");
--> statement-breakpoint
-- FK to auth.users (cross-schema, added manually — Drizzle does not emit it)
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint
-- RLS: owner-scoped read + update; INSERT/DELETE reserved for service role
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "owner can select notifications" ON notifications
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint
CREATE POLICY "owner can update notifications" ON notifications
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);