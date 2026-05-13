ALTER TABLE "patients" ADD COLUMN "whatsapp_opt_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "whatsapp_opt_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "reminder_phone" varchar(20);