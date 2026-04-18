ALTER TABLE "usage_logs" ADD COLUMN "auto_mode" boolean NOT NULL DEFAULT false;
ALTER TABLE "usage_logs" ADD COLUMN "fallback_from_provider" varchar(32);
ALTER TABLE "usage_logs" ADD COLUMN "fallback_reason" text;
ALTER TABLE "request_logs" ADD COLUMN "fallback_triggered" boolean NOT NULL DEFAULT false;
