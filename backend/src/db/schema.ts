import { pgTable, serial, text, integer, timestamp, boolean, varchar, index, numeric, primaryKey } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: varchar('username', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: varchar('role', { length: 50 }).notNull().default('tenant'), // 'admin' or 'tenant'
  status: varchar('status', { length: 20 }).notNull().default('active'), // 'active' or 'suspended'
  concurrencyLimit: integer('concurrency_limit').notNull().default(3),
  balance: numeric('balance', { precision: 20, scale: 4 }).notNull().default('0'),
  provider: varchar('provider', { length: 50 }).notNull().default('meitu'), // 'meitu' | 'evolink'
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const keys = pgTable('keys', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  apiKey: varchar('api_key', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  enabled: boolean('enabled').notNull().default(true),
  deletedAt: timestamp('deleted_at'),
  expiresAt: timestamp('expires_at'),
  quotaLimit: numeric('quota_limit', { precision: 20, scale: 4 }),  // null = 不限制
  quotaUsed: numeric('quota_used', { precision: 20, scale: 4 }).notNull().default('0'),
  concurrencyLimit: integer('concurrency_limit'),  // null = 不限制（跟随用户级）
  provider: varchar('provider', { length: 50 }),  // null = 跟随用户级 users.provider
  // 控制响应中 content.video_url 返回形式：
  //   'cdn'      → 我们的 /v/{task_id}.mp4 中转链接（默认；内部 302 到 S3 或上游）
  //   'upstream' → 上游签名 URL 原样透出（客户端自行消费/托管）
  //   's3'       → 我方 S3 预签名 URL 直接透出；未完成 S3 offload 时回落到 'cdn'
  videoUrlMode: varchar('video_url_mode', { length: 16 }).notNull().default('cdn'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('keys_user_id_idx').on(table.userId),
]);

export const usageLogs = pgTable('usage_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  keyId: integer('key_id').references(() => keys.id).notNull(),
  endpoint: varchar('endpoint', { length: 255 }).notNull(),
  taskId: varchar('task_id', { length: 255 }),                         // our own task id (cgt-YYYYMMDDHHMMSS-xxxxx)
  upstreamTaskId: varchar('upstream_task_id', { length: 255 }),        // provider-issued id, used for upstream queries
  completionTokens: integer('completion_tokens').default(0),
  hasVideoInput: boolean('has_video_input').notNull().default(false),
  costYuan: text('cost_yuan').notNull().default('0'),
  status: varchar('status', { length: 50 }).default('pending'), // 'pending', 'succeeded', 'failed'
  provider: varchar('provider', { length: 50 }).notNull().default('meitu'), // 'meitu' | 'evolink' (actual provider currently servicing the task)
  autoMode: boolean('auto_mode').notNull().default(false),                  // task was created under user/key provider='auto' — eligible for moderation fallback
  fallbackFromProvider: varchar('fallback_from_provider', { length: 32 }),  // non-null once we've fallen back; gates the fallback to a single hop
  fallbackReason: text('fallback_reason'),                                  // upstream error code that triggered fallback (audit/debug)
  videoDuration: integer('video_duration'),  // Evolink: output video duration in seconds
  videoQuality: varchar('video_quality', { length: 10 }), // Evolink: '480p' | '720p' | '1080p'
  creditsReserved: numeric('credits_reserved', { precision: 20, scale: 4 }), // Evolink: credits_reserved from create response — authoritative for billing
  resultData: text('result_data'), // 任务终态时对外返回的 Ark-shape 响应 JSON（id 已替换为我方 task_id）
  upstreamVideoUrl: text('upstream_video_url'),                   // 上游原始视频 URL，供 /v 端点 302 跳转
  upstreamVideoExpiresAt: timestamp('upstream_video_expires_at'), // NULL = 永久（evolink）；否则为签名过期时刻（ark/meitu ≈ upstream_finished_at + 23h55m）
  s3Key: text('s3_key'),                                          // S3 object key once uploaded; NULL = not yet on S3
  s3UploadedAt: timestamp('s3_uploaded_at'),                      // 上传成功时刻
  s3UploadStatus: varchar('s3_upload_status', { length: 20 }),    // NULL | 'uploading' | 'done' | 'failed'
  s3UploadAttempts: integer('s3_upload_attempts').notNull().default(0), // failure counter, used by cron retry backoff
  s3UploadError: text('s3_upload_error'),                         // last failure message (audit/debug)
  upstreamCreateRaw: text('upstream_create_raw'), // 上游 provider /create 的原始响应（审计用）
  upstreamQueryRaw: text('upstream_query_raw'),   // 上游 provider 终态查询的原始响应（审计用）
  requestBody: text('request_body'), // 原始请求体（截断至 8K）
  upstreamStartedAt: timestamp('upstream_started_at'),   // 上游 created_at（任务提交时刻）
  upstreamFinishedAt: timestamp('upstream_finished_at'), // 上游 updated_at（终态时刻）
  taskDurationMs: integer('task_duration_ms'),           // upstream_finished_at - upstream_started_at
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('usage_logs_user_id_idx').on(table.userId),
  index('usage_logs_status_idx').on(table.status),
  index('usage_logs_task_id_idx').on(table.taskId),
  index('usage_logs_upstream_task_id_idx').on(table.upstreamTaskId),
  index('usage_logs_created_at_idx').on(table.createdAt),
  index('usage_logs_s3_upload_status_idx').on(table.s3UploadStatus),
]);

export const requestLogs = pgTable('request_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  keyId: integer('key_id').references(() => keys.id).notNull(),
  endpoint: varchar('endpoint', { length: 255 }).notNull(),
  method: varchar('method', { length: 10 }).notNull().default('POST'),
  requestBody: text('request_body'),
  responseBody: text('response_body'),
  responseStatus: integer('response_status'),
  durationMs: integer('duration_ms'),
  ipAddress: varchar('ip_address', { length: 100 }),
  // Marker for the GET /get_result poll that triggered an auto-mode meitu→evolink
  // fallback. Lets ops filter the log down to the exact transitions instead of
  // grep-scanning response bodies.
  fallbackTriggered: boolean('fallback_triggered').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('request_logs_user_id_idx').on(table.userId),
  index('request_logs_created_at_idx').on(table.createdAt),
]);

export const ipWhitelist = pgTable('ip_whitelist', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  ipAddress: varchar('ip_address', { length: 45 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('ip_whitelist_user_id_idx').on(table.userId),
]);

// Per-token material library. Each row is owned by a single API key (token) —
// key_id is the authorization boundary enforced on every read.
//
// `id` is surfaced to clients as Meitu-shape `asset-YYYYMMDDHHMMSS-xxxxx` so
// that callers migrating from Meitu don't need to change their ID parsers.
// It is distinct from any upstream asset id (which lives in
// material_provider_refs).
export const materials = pgTable('materials', {
  id: varchar('id', { length: 64 }).primaryKey(),
  keyId: integer('key_id').references(() => keys.id).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(),
  name: varchar('name', { length: 64 }).notNull().default(''),
  assetType: varchar('asset_type', { length: 16 }).notNull(), // 'Image' | 'Video' | 'Audio'
  groupId: varchar('group_id', { length: 64 }).notNull().default(''),
  projectName: varchar('project_name', { length: 64 }).notNull().default('default'),

  // Canonical source in our S3. Every provider resolution ultimately flows
  // from this object (either referenced by URL directly or re-uploaded to a
  // provider with asset APIs).
  s3Key: text('s3_key'),
  sourceUrl: text('source_url'),              // original URL the caller supplied
  mime: varchar('mime', { length: 64 }),
  size: integer('size'),
  sha256: varchar('sha256', { length: 64 }),

  // Ingest pipeline state — S3 leg. 'ready' means object is persisted and safe
  // to serve via presigned URL.
  s3Status: varchar('s3_status', { length: 16 }).notNull().default('pending'), // 'pending' | 'ready' | 'failed'
  s3Attempts: integer('s3_attempts').notNull().default(0),
  s3Error: text('s3_error'),

  // Aggregated, client-facing status — this is what GetAsset/ListAssets map
  // to Meitu's Status enum (Processing / Active / Failed). Driven by the
  // worst-of (s3_status, meitu_status) for Meitu-bound tokens; equals
  // s3_status for Evolink/Ark-bound tokens.
  status: varchar('status', { length: 16 }).notNull().default('Processing'),
  rejectReason: text('reject_reason'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  index('materials_key_id_idx').on(table.keyId),
  index('materials_user_id_idx').on(table.userId),
  index('materials_s3_status_idx').on(table.s3Status),
  index('materials_created_at_idx').on(table.createdAt),
]);

// Per-provider sync state for a material. When a provider has an asset API
// (currently only Meitu; Ark is gated on permissions), we re-upload the
// material to the provider and cache its upstream id + signed URL here.
// Providers without asset APIs (Evolink) don't get a row — they always
// consume the S3 presigned URL at task-creation time.
export const materialProviderRefs = pgTable('material_provider_refs', {
  materialId: varchar('material_id', { length: 64 }).references(() => materials.id, { onDelete: 'cascade' }).notNull(),
  provider: varchar('provider', { length: 16 }).notNull(),       // 'meitu' | 'ark'
  upstreamAssetId: text('upstream_asset_id'),
  upstreamUrl: text('upstream_url'),                             // provider's presigned URL (e.g. Meitu's 12h TOS link)
  upstreamStatus: varchar('upstream_status', { length: 16 }),    // 'Processing' | 'Active' | 'Failed' (raw from upstream)
  syncStatus: varchar('sync_status', { length: 16 }).notNull().default('pending'), // 'pending' | 'claiming' | 'done' | 'failed' (retriable) | 'rejected' (terminal, e.g. copyright)
  syncAttempts: integer('sync_attempts').notNull().default(0),
  lastError: text('last_error'),
  syncedAt: timestamp('synced_at'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.materialId, table.provider] }),
  index('material_provider_refs_sync_status_idx').on(table.syncStatus),
  index('material_provider_refs_upstream_status_idx').on(table.upstreamStatus),
]);

export const balanceAudit = pgTable('balance_audit', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  amount: numeric('amount', { precision: 20, scale: 4 }).notNull(),
  description: varchar('description', { length: 500 }).notNull().default(''),
  operatorId: integer('operator_id').references(() => users.id).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('balance_audit_user_id_idx').on(table.userId),
]);
