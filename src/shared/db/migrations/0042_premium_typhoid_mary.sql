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
      ));