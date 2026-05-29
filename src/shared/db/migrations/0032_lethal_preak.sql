ALTER TABLE "evolutions" ADD COLUMN "ai_assisted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "evolutions" ADD COLUMN "ai_transcription_id" uuid;--> statement-breakpoint
CREATE INDEX "idx_evolutions_user_ai_assisted" ON "evolutions" USING btree ("user_id","ai_assisted");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- FOREIGN KEY CONSTRAINT (emitted manually — cross-table FKs in this repo are
-- appended by hand, not generated via Drizzle `.references()`).
--
-- Backlink from `evolutions` to the source `ai_transcriptions` row.
-- ON DELETE SET NULL: deleting a transcription must NOT drop the evolution
-- (Lei 13.787/2018 clinical-record retention) — it only clears the backlink.
-- ---------------------------------------------------------------------------
ALTER TABLE "evolutions"
  ADD CONSTRAINT "evolutions_ai_transcription_id_fk"
  FOREIGN KEY ("ai_transcription_id") REFERENCES "ai_transcriptions"(id) ON DELETE SET NULL;
