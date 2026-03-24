ALTER TABLE "keys" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "request_body" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" varchar(20) DEFAULT 'active' NOT NULL;