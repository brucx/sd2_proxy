-- Replace the boolean return_cdn_video_url with a 3-way enum-like varchar so
-- we can expose S3 presigned URLs as a third option (cdn | upstream | s3).
-- Written defensively: works whether 0013 has been applied or not.

ALTER TABLE "keys" ADD COLUMN IF NOT EXISTS "video_url_mode" varchar(16) NOT NULL DEFAULT 'cdn';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'keys' AND column_name = 'return_cdn_video_url'
  ) THEN
    UPDATE "keys"
       SET "video_url_mode" = CASE WHEN "return_cdn_video_url" = false THEN 'upstream' ELSE 'cdn' END;
    ALTER TABLE "keys" DROP COLUMN "return_cdn_video_url";
  END IF;
END $$;
