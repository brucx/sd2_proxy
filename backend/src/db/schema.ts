import { pgTable, serial, text, integer, timestamp, boolean, varchar, index, numeric } from 'drizzle-orm/pg-core';

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
