-- Telepsicologia domain migration: creates `video_rooms`, `video_session_logs`,
-- and `video_recordings` tables with indexes, FK constraints, CHECK constraints,
-- owner-scoped RLS policies, and adds recording consent columns to `patients`.

-- =====================================================================
-- 1. CREATE TABLES
-- =====================================================================

CREATE TABLE "video_recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"stream_recording_id" varchar(255),
	"duration_seconds" integer,
	"status" text DEFAULT 'idle' NOT NULL,
	"audio_temp_url" text,
	"transcription_id" uuid,
	"recorded_at" timestamp with time zone,
	"discarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_recordings_status_check" CHECK ("video_recordings"."status" IN ('idle', 'recording', 'processing', 'transcribed', 'discarded'))
);
--> statement-breakpoint
CREATE TABLE "video_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"stream_call_id" varchar(255) NOT NULL,
	"patient_token" varchar(64) NOT NULL,
	"patient_jwt" text NOT NULL,
	"partner_token" varchar(64),
	"partner_jwt" text,
	"available_from" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"recording_enabled" boolean DEFAULT false,
	"recording_consent_signed" boolean DEFAULT false,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_rooms_status_check" CHECK ("video_rooms"."status" IN ('pending', 'active', 'ended', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "video_session_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event_type" varchar(30) NOT NULL,
	"participant_role" varchar(20),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_session_logs_event_type_check" CHECK ("video_session_logs"."event_type" IN (
        'therapist_joined', 'patient_joined', 'partner_joined',
        'therapist_left', 'patient_left', 'partner_left',
        'screen_share_started', 'screen_share_ended',
        'connection_drop', 'reconnected',
        'recording_started', 'recording_ended',
        'room_ended', 'room_expired',
        'session_summary', 'session_extended'
      ))
);
--> statement-breakpoint

-- =====================================================================
-- 2. ALTER patients — add recording consent columns
-- =====================================================================

ALTER TABLE "patients" ADD COLUMN "recording_consent_signed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "recording_consent_revoked_at" timestamp with time zone;
--> statement-breakpoint

-- =====================================================================
-- 3. INDEXES
-- =====================================================================

CREATE INDEX "video_recordings_session_id_idx" ON "video_recordings" USING btree ("session_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "video_rooms_session_id_unique_idx" ON "video_rooms" USING btree ("session_id");
--> statement-breakpoint
CREATE INDEX "video_rooms_user_id_status_idx" ON "video_rooms" USING btree ("user_id","status");
--> statement-breakpoint
CREATE INDEX "video_rooms_expires_at_idx" ON "video_rooms" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "video_session_logs_session_id_created_at_idx" ON "video_session_logs" USING btree ("session_id","created_at");
--> statement-breakpoint

-- =====================================================================
-- 4. FOREIGN KEY CONSTRAINTS
-- =====================================================================

-- video_rooms FKs
ALTER TABLE "video_rooms"
  ADD CONSTRAINT "video_rooms_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id);
--> statement-breakpoint

ALTER TABLE "video_rooms"
  ADD CONSTRAINT "video_rooms_session_id_fk"
  FOREIGN KEY ("session_id") REFERENCES "sessions"(id);
--> statement-breakpoint

-- video_session_logs FKs
ALTER TABLE "video_session_logs"
  ADD CONSTRAINT "video_session_logs_session_id_fk"
  FOREIGN KEY ("session_id") REFERENCES "sessions"(id);
--> statement-breakpoint

ALTER TABLE "video_session_logs"
  ADD CONSTRAINT "video_session_logs_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id);
--> statement-breakpoint

-- video_recordings FKs
ALTER TABLE "video_recordings"
  ADD CONSTRAINT "video_recordings_session_id_fk"
  FOREIGN KEY ("session_id") REFERENCES "sessions"(id);
--> statement-breakpoint

ALTER TABLE "video_recordings"
  ADD CONSTRAINT "video_recordings_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id);
--> statement-breakpoint

-- =====================================================================
-- 5. ROW LEVEL SECURITY
-- =====================================================================

-- video_rooms: full CRUD (SELECT/INSERT/UPDATE/DELETE)
ALTER TABLE "video_rooms" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select video_rooms" ON "video_rooms"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can insert video_rooms" ON "video_rooms"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can update video_rooms" ON "video_rooms"
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can delete video_rooms" ON "video_rooms"
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

-- video_session_logs: append-only (SELECT/INSERT only)
ALTER TABLE "video_session_logs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select video_session_logs" ON "video_session_logs"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can insert video_session_logs" ON "video_session_logs"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

-- video_recordings: SELECT/INSERT/UPDATE only (no delete)
ALTER TABLE "video_recordings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owner can select video_recordings" ON "video_recordings"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can insert video_recordings" ON "video_recordings"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint

CREATE POLICY "owner can update video_recordings" ON "video_recordings"
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
