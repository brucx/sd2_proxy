ALTER TABLE "keys" ADD COLUMN "quota_limit" numeric(20, 4);--> statement-breakpoint
ALTER TABLE "keys" ADD COLUMN "quota_used" numeric(20, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "keys" ADD COLUMN "concurrency_limit" integer;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "provider" varchar(50) DEFAULT 'ark' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "video_duration" integer;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "video_quality" varchar(10);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "provider" varchar(50) DEFAULT 'ark' NOT NULL;