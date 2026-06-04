-- Enable Supabase Realtime `postgres_changes` on `notifications`.
--
-- The in-app notification bell subscribes to INSERT events on this table,
-- owner-filtered (`user_id=eq.<userId>`), to bump the unread count live
-- (RNF-11.04). For those events to be emitted at all, the table MUST belong to
-- the `supabase_realtime` publication that the Realtime server reads from
-- logical replication.
--
-- Row authorization for what each subscriber receives is enforced by the
-- existing RLS SELECT policy (`auth.uid() = user_id`) PLUS the per-channel
-- `user_id` filter — both scope to the owner, so a client never receives another
-- user's rows. This migration only opts the table into change emission; it does
-- NOT widen visibility.
--
-- `REPLICA IDENTITY FULL` makes the previous row available on UPDATE/DELETE so
-- that filtering on the non-PK `user_id` column keeps working if those events
-- are added later; for the INSERT events used today the full new row is always
-- present regardless.

ALTER TABLE notifications REPLICA IDENTITY FULL;

-- Guard the publication add so this migration is safe on a plain Postgres
-- instance (Testcontainers / CI / local non-Supabase), where the
-- `supabase_realtime` publication does not exist. On a real Supabase project the
-- publication is present and the table is added once (idempotent re-check).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'notifications'
     )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  END IF;
END
$$;
