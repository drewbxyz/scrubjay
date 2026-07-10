ALTER TABLE "deliveries" ADD COLUMN "detail" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "status" text DEFAULT 'sent' NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_status_check" CHECK ("deliveries"."status" in ('sent', 'failed', 'expired', 'suppressed'));