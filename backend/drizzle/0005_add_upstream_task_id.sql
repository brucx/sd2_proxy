ALTER TABLE "usage_logs" ADD COLUMN "upstream_task_id" varchar(255);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_logs_upstream_task_id_idx" ON "usage_logs" ("upstream_task_id");
