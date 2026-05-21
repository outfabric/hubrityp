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
