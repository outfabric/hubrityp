// Owner-scoped RLS policies for the telepsicologia domain tables.
//
// These SQL strings follow the canonical template documented in
// `src/shared/db/migrations/README.md`. They are appended **manually** to
// the Drizzle-generated migration file because Drizzle does not emit RLS.
//
// All three tables (video_rooms, video_session_logs, video_recordings) have
// their own `user_id` column referencing the psychologist's `auth.users.id`,
// so policies enforce ownership directly via `user_id = auth.uid()`.

// video_rooms: full CRUD — owner can manage their rooms.
export const videoRoomsPolicies = [
  `ALTER TABLE video_rooms ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "owner can select video_rooms" ON video_rooms
     FOR SELECT TO authenticated
     USING (auth.uid() = user_id);`,
  `CREATE POLICY "owner can insert video_rooms" ON video_rooms
     FOR INSERT TO authenticated
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "owner can update video_rooms" ON video_rooms
     FOR UPDATE TO authenticated
     USING (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "owner can delete video_rooms" ON video_rooms
     FOR DELETE TO authenticated
     USING (auth.uid() = user_id);`,
] as const;

// video_session_logs: append-only — SELECT + INSERT only.
// No UPDATE or DELETE policies. Logs are immutable once written.
export const videoSessionLogsPolicies = [
  `ALTER TABLE video_session_logs ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "owner can select video_session_logs" ON video_session_logs
     FOR SELECT TO authenticated
     USING (auth.uid() = user_id);`,
  `CREATE POLICY "owner can insert video_session_logs" ON video_session_logs
     FOR INSERT TO authenticated
     WITH CHECK (auth.uid() = user_id);`,
  // NO UPDATE policy — append-only table.
  // NO DELETE policy — logs are immutable.
] as const;

// video_recordings: SELECT + INSERT + UPDATE only.
// No DELETE policy — recordings are discarded via status change, not
// hard-deleted, to maintain audit trail integrity.
export const videoRecordingsPolicies = [
  `ALTER TABLE video_recordings ENABLE ROW LEVEL SECURITY;`,
  `CREATE POLICY "owner can select video_recordings" ON video_recordings
     FOR SELECT TO authenticated
     USING (auth.uid() = user_id);`,
  `CREATE POLICY "owner can insert video_recordings" ON video_recordings
     FOR INSERT TO authenticated
     WITH CHECK (auth.uid() = user_id);`,
  `CREATE POLICY "owner can update video_recordings" ON video_recordings
     FOR UPDATE TO authenticated
     USING (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id);`,
  // NO DELETE policy — recordings are discarded (status = 'discarded'),
  // not hard-deleted.
] as const;

// realtime.messages: the waiting-room presence broadcast channel.
//
// why: this is the FIRST private Realtime channel in the repo. The
// psychologist subscribes to the private topic `video-room:<roomId>` and a
// SECURITY DEFINER trigger on `video_rooms` emits a minimal
// `{ room_id, last_seen_at }` payload via `realtime.send` whenever the
// patient heartbeat (`patient_last_seen_at`) changes — including a clear back
// to NULL (departure). Authorization of *who may receive* that broadcast is
// enforced here, by an RLS SELECT policy on the Supabase-internal
// `realtime.messages` table: only the owner of the room may read messages on
// its topic. Even if this predicate were too broad, the payload is
// non-sensitive (a room UUID + a liveness timestamp — no JWT, token, patient
// name, CPF, or clinical content), so the blast radius of a policy mistake is
// minimal by design.
//
// This array is NOT enabled/ALTERed like the public-table arrays above:
// `realtime.messages` is owned and RLS-enabled by Supabase itself, so we only
// add the SELECT (receive) policy. The DDL lives in migration `0042`,
// wrapped in a `DO $$ … IF EXISTS (realtime
// schema / realtime.send) … $$` guard so a plain-Postgres stack
// (Testcontainers/CI) applies the migration as a no-op for these objects.
//
// Policy-coverage contract: the lint test
// (`__tests__/integration/policy-coverage.int.test.ts`) requires a matching
// `CREATE POLICY ... ON <table>` in the migrations for every `pgTable(...)`
// declared under `schema/**/tables.ts`. `realtime.messages` is a
// Supabase-internal table, NOT a `pgTable` in this repo, so it is outside the
// contract's scanned set — it neither needs nor receives an entry there. The
// policy is still declared here (source of truth) and present in the
// migration; the RLS integration test asserts its owner-vs-non-owner
// predicate directly.
export const realtimeMessagesPresencePolicies = [
  `CREATE POLICY "owner can receive video-room presence broadcasts"
     ON realtime.messages
     FOR SELECT TO authenticated
     USING (
       realtime.messages.extension = 'broadcast'
       AND EXISTS (
         SELECT 1 FROM public.video_rooms vr
         WHERE vr.user_id = auth.uid()
           AND realtime.topic() = 'video-room:' || vr.id::text
       )
     );`,
] as const;
