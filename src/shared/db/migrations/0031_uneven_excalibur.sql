ALTER TABLE "ai_transcriptions" DROP CONSTRAINT "ai_transcriptions_status_check";--> statement-breakpoint
ALTER TABLE "ai_transcriptions" ADD COLUMN "transcription_cost_usd" numeric(10, 4);--> statement-breakpoint
ALTER TABLE "ai_transcriptions" ADD COLUMN "llm_cost_usd" numeric(10, 4);--> statement-breakpoint
ALTER TABLE "ai_transcriptions" ADD CONSTRAINT "ai_transcriptions_status_check" CHECK ("ai_transcriptions"."status" IN ('pending', 'transcribing', 'generating', 'ready', 'reviewed', 'failed', 'cancelled'));