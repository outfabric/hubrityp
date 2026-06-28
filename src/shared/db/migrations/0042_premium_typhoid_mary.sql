ALTER TABLE "video_session_logs" DROP CONSTRAINT "video_session_logs_event_type_check";--> statement-breakpoint
ALTER TABLE "video_rooms" ADD COLUMN "patient_waiting_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "video_rooms" ADD COLUMN "patient_last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "video_session_logs" ADD CONSTRAINT "video_session_logs_event_type_check" CHECK ("video_session_logs"."event_type" IN (
        'therapist_joined', 'patient_joined', 'partner_joined',
        'patient_arrived',
        'therapist_left', 'patient_left', 'partner_left',
        'screen_share_started', 'screen_share_ended',
        'connection_drop', 'reconnected',
        'recording_started', 'recording_ended',
        'room_ended', 'room_expired',
        'session_summary', 'session_extended'
      ));--> statement-breakpoint
-- Waiting-room presence broadcast (Realtime).
--
-- The psychologist subscribes to the PRIVATE topic `video-room:<roomId>`. A
-- SECURITY DEFINER trigger on `video_rooms` emits a MINIMAL payload
-- `{ room_id, last_seen_at }` via `realtime.send` whenever the patient
-- heartbeat (`patient_last_seen_at`) changes. `IS DISTINCT FROM` treats NULL
-- as a value, so a departure (timestamp -> NULL) ALSO fires and broadcasts
-- `{ room_id, last_seen_at: null }` — no second event type needed.
--
-- We deliberately do NOT use `realtime.broadcast_changes`: it dumps the full
-- NEW/OLD row, which on `video_rooms` includes `patient_jwt`, `patient_token`,
-- `partner_jwt`, `partner_token`. Streaming those would be an unacceptable
-- credential exposure. The hand-built JSONB carries only the room UUID and the
-- liveness timestamp — no JWT, token, patient name, or other PII.
--
-- Receipt authorization is enforced by the RLS SELECT policy on
-- `realtime.messages` (declared in
-- `src/shared/db/schema/telepsicologia/policies.ts`): only the owner of the
-- room may read messages on its topic.
--
-- Guard: the entire block is wrapped so a plain-Postgres instance without the
-- `realtime` schema (Testcontainers / CI / local non-Supabase) applies this
-- migration as a no-op for these objects, mirroring migration `0039`.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'realtime')
     AND EXISTS (
       SELECT 1
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'realtime' AND p.proname = 'send'
     )
  THEN
    -- Trigger function: broadcast a minimal, non-sensitive presence payload.
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.broadcast_video_room_presence()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = ''
      AS $body$
      BEGIN
        PERFORM realtime.send(
          jsonb_build_object(
            'room_id', NEW.id,
            'last_seen_at', NEW.patient_last_seen_at
          ),
          'presence',
          'video-room:' || NEW.id::text,
          true
        );
        RETURN NEW;
      END;
      $body$;
    $fn$;

    -- Trigger: fire only when the heartbeat actually changes. `IS DISTINCT
    -- FROM` makes NULL a comparable value, so departures (timestamp -> NULL)
    -- broadcast too, while a status-only update stays silent.
    EXECUTE $trg_drop$
      DROP TRIGGER IF EXISTS video_rooms_presence_broadcast ON public.video_rooms;
    $trg_drop$;
    EXECUTE $trg$
      CREATE TRIGGER video_rooms_presence_broadcast
        AFTER UPDATE ON public.video_rooms
        FOR EACH ROW
        WHEN (NEW.patient_last_seen_at IS DISTINCT FROM OLD.patient_last_seen_at)
        EXECUTE FUNCTION public.broadcast_video_room_presence();
    $trg$;

    -- RLS SELECT (receive) policy on the Supabase-internal realtime.messages:
    -- only the owner of the room may receive broadcasts on its topic.
    EXECUTE $pol_drop$
      DROP POLICY IF EXISTS "owner can receive video-room presence broadcasts" ON realtime.messages;
    $pol_drop$;
    EXECUTE $pol$
      CREATE POLICY "owner can receive video-room presence broadcasts"
        ON realtime.messages
        FOR SELECT TO authenticated
        USING (
          realtime.messages.extension = 'broadcast'
          AND EXISTS (
            SELECT 1 FROM public.video_rooms vr
            WHERE vr.user_id = auth.uid()
              AND realtime.topic() = 'video-room:' || vr.id::text
          )
        );
    $pol$;
  END IF;
END
$do$;