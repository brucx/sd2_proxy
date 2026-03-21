import { pgTable, serial, text, integer, timestamp, boolean, varchar, index, numeric } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: varchar('username', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: varchar('role', { length: 50 }).notNull().default('tenant'), // 'admin' or 'tenant'
  status: varchar('status', { length: 20 }).notNull().default('active'), // 'active' or 'suspended'
  concurrencyLimit: integer('concurrency_limit').notNull().default(3),
  balance: numeric('balance', { precision: 20, scale: 4 }).notNull().default('0'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const keys = pgTable('keys', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  apiKey: varchar('api_key', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  enabled: boolean('enabled').notNull().default(true),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('keys_user_id_idx').on(table.userId),
]);

export const usageLogs = pgTable('usage_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  keyId: integer('key_id').references(() => keys.id).notNull(),
  endpoint: varchar('endpoint', { length: 255 }).notNull(),
  taskId: varchar('task_id', { length: 255 }),
  completionTokens: integer('completion_tokens').default(0),
  hasVideoInput: boolean('has_video_input').notNull().default(false),
  costYuan: text('cost_yuan').notNull().default('0'),
  status: varchar('status', { length: 50 }).default('pending'), // 'pending', 'succeeded', 'failed'
  resultData: text('result_data'), // 任务完成时的上游完整响应 JSON
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('usage_logs_user_id_idx').on(table.userId),
  index('usage_logs_status_idx').on(table.status),
  index('usage_logs_task_id_idx').on(table.taskId),
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
