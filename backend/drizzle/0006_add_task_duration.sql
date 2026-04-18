ALTER TABLE "usage_logs" ADD COLUMN "upstream_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "upstream_finished_at" timestamp;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "task_duration_ms" integer;
