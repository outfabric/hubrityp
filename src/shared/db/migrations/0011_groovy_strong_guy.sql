-- Session lifecycle extension: adds cancellation, confirmation, reschedule,
-- and soft-delete columns; updates CHECK constraint to include all five
-- valid session statuses; creates partial UNIQUE index on confirmation_token;
-- adds self-referencing FKs for reschedule links; drops the DELETE RLS
-- policy on sessions (RN-03.05: sessions must never be hard-deleted).

-- =====================================================================
-- 1. ADD COLUMNS
-- =====================================================================

ALTER TABLE "sessions" ADD COLUMN "cancellation_reason" varchar(50);
--> statement-breakpoint

ALTER TABLE "sessions" ADD COLUMN "cancelled_by" varchar(20);
--> statement-breakpoint

ALTER TABLE "sessions" ADD COLUMN "cancellation_notice" varchar(20);
--> statement-breakpoint

ALTER TABLE "sessions" ADD COLUMN "cancelled_at" timestamp with time zone;
--> statement-breakpoint

ALTER TABLE "sessions" ADD COLUMN "charge_cancellation" boolean DEFAULT false;
--> statement-breakpoint

ALTER TABLE "sessions" ADD COLUMN "confirmation_token" varchar(64);
--> statement-breakpoint

ALTER TABLE "sessions" ADD COLUMN "confirmed_at" timestamp with time zone;
--> statement-breakpoint

ALTER TABLE "sessions" ADD COLUMN "rescheduled_to_session_id" uuid;
--> statement-breakpoint

ALTER TABLE "sessions" ADD COLUMN "rescheduled_from_session_id" uuid;
--> statement-breakpoint

ALTER TABLE "sessions" ADD COLUMN "deleted_at" timestamp with time zone;
--> statement-breakpoint

-- =====================================================================
-- 2. UNIQUE INDEX — confirmation_token (partial, WHERE NOT NULL)
-- =====================================================================

CREATE UNIQUE INDEX "sessions_confirmation_token_unique_idx"
  ON "sessions" USING btree ("confirmation_token")
  WHERE "sessions"."confirmation_token" IS NOT NULL;
--> statement-breakpoint

-- =====================================================================
-- 3. CHECK CONSTRAINT — status lifecycle values
-- =====================================================================

-- Drop the previous CHECK that only allowed ('scheduled', 'done', 'cancelled')
ALTER TABLE "sessions" DROP CONSTRAINT IF EXISTS "sessions_status_check";
--> statement-breakpoint

-- Re-create with all five valid states
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_status_check"
  CHECK ("status" IN ('scheduled', 'confirmed', 'done', 'cancelled', 'no_show'));
--> statement-breakpoint

-- =====================================================================
-- 4. FOREIGN KEYS — self-referencing reschedule links
-- =====================================================================

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_rescheduled_to_session_id_fk"
  FOREIGN KEY ("rescheduled_to_session_id") REFERENCES "sessions"("id")
  ON DELETE SET NULL;
--> statement-breakpoint

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_rescheduled_from_session_id_fk"
  FOREIGN KEY ("rescheduled_from_session_id") REFERENCES "sessions"("id")
  ON DELETE SET NULL;
--> statement-breakpoint

-- =====================================================================
-- 5. RLS — drop DELETE policy on sessions (RN-03.05)
-- =====================================================================
-- RN-03.05 dictates that sessions must NEVER be hard-deleted from the
-- database. Cancelled sessions remain for audit integrity. The "Excluir
-- definitivamente" action uses a soft-delete (UPDATE deleted_at) instead.
-- Removing the DELETE policy ensures any DELETE attempt is blocked at the
-- database level, regardless of application code.

DROP POLICY IF EXISTS "owner can delete sessions" ON "sessions";
