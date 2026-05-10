-- Add 'cancelled' to the sessions status CHECK constraint.
-- The cancellation feature (cancel-recurring-session) needs to set
-- session status to 'cancelled'. The original CHECK only allowed
-- ('scheduled', 'done').

-- Drop the existing CHECK constraint on sessions.status
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_status_check";
--> statement-breakpoint

-- Re-create with 'cancelled' included
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_status_check"
  CHECK ("status" IN ('scheduled', 'done', 'cancelled'));
