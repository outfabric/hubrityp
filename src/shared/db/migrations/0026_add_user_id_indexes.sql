-- Add user_id indexes on video_session_logs and video_recordings for RLS
-- SELECT policy performance. These columns are used in the RLS predicate
-- (auth.uid() = user_id); without an index, Postgres does a sequential scan.
--
-- Uses IF NOT EXISTS so the migration is safe to run on databases where
-- migration 0025 already includes these indexes (fresh installs).

CREATE INDEX IF NOT EXISTS "video_session_logs_user_id_idx" ON "video_session_logs" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "video_recordings_user_id_idx" ON "video_recordings" USING btree ("user_id");
