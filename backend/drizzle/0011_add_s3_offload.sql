ALTER TABLE "usage_logs" ADD COLUMN "s3_key" text;
ALTER TABLE "usage_logs" ADD COLUMN "s3_uploaded_at" timestamp;
ALTER TABLE "usage_logs" ADD COLUMN "s3_upload_status" varchar(20);
ALTER TABLE "usage_logs" ADD COLUMN "s3_upload_attempts" integer NOT NULL DEFAULT 0;
ALTER TABLE "usage_logs" ADD COLUMN "s3_upload_error" text;
CREATE INDEX "usage_logs_s3_upload_status_idx" ON "usage_logs" ("s3_upload_status");
