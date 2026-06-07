-- Relax `video_rooms.stream_call_id` and `video_rooms.patient_jwt` from
-- NOT NULL to nullable.
--
-- The video room lifecycle is split into two phases:
--   1. Reservation (at schedule time): insert a row with `patient_token`,
--      `available_from`, `expires_at`, and `status='pending'`, but with
--      `stream_call_id=NULL` and `patient_jwt=NULL` ("reserved but not yet
--      activated").
--   2. Activation (at startAt − 1h, via Inngest): UPDATE the existing row
--      with the Stream call ID, the patient JWT, and any partner fields.
--
-- No data loss: existing rows already carry non-NULL values; this migration
-- only permits the columns to subsequently hold NULL during the reservation
-- phase. RLS scoping (`user_id = auth.uid()`) is unaffected by nullability.
--
-- Reversible: re-adding NOT NULL would fail only while reserved-but-inactive
-- rows exist; a down-migration would first need to activate or purge them.
ALTER TABLE "video_rooms" ALTER COLUMN "stream_call_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "video_rooms" ALTER COLUMN "patient_jwt" DROP NOT NULL;