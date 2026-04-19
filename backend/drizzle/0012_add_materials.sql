CREATE TABLE IF NOT EXISTS "materials" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "key_id" integer NOT NULL REFERENCES "keys"("id"),
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "name" varchar(64) NOT NULL DEFAULT '',
  "asset_type" varchar(16) NOT NULL,
  "group_id" varchar(64) NOT NULL DEFAULT '',
  "project_name" varchar(64) NOT NULL DEFAULT 'default',
  "s3_key" text,
  "source_url" text,
  "mime" varchar(64),
  "size" integer,
  "sha256" varchar(64),
  "s3_status" varchar(16) NOT NULL DEFAULT 'pending',
  "s3_attempts" integer NOT NULL DEFAULT 0,
  "s3_error" text,
  "status" varchar(16) NOT NULL DEFAULT 'Processing',
  "reject_reason" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);

CREATE INDEX IF NOT EXISTS "materials_key_id_idx" ON "materials" ("key_id");
CREATE INDEX IF NOT EXISTS "materials_user_id_idx" ON "materials" ("user_id");
CREATE INDEX IF NOT EXISTS "materials_s3_status_idx" ON "materials" ("s3_status");
CREATE INDEX IF NOT EXISTS "materials_created_at_idx" ON "materials" ("created_at");

CREATE TABLE IF NOT EXISTS "material_provider_refs" (
  "material_id" varchar(64) NOT NULL REFERENCES "materials"("id") ON DELETE CASCADE,
  "provider" varchar(16) NOT NULL,
  "upstream_asset_id" text,
  "upstream_url" text,
  "upstream_status" varchar(16),
  "sync_status" varchar(16) NOT NULL DEFAULT 'pending',
  "sync_attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "synced_at" timestamp,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("material_id", "provider")
);

CREATE INDEX IF NOT EXISTS "material_provider_refs_sync_status_idx" ON "material_provider_refs" ("sync_status");
CREATE INDEX IF NOT EXISTS "material_provider_refs_upstream_status_idx" ON "material_provider_refs" ("upstream_status");
