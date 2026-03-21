import { pgTable, serial, text, integer, timestamp, boolean, varchar } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: varchar('username', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: varchar('role', { length: 50 }).notNull().default('tenant'), // 'admin' or 'tenant'
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const keys = pgTable('keys', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  apiKey: varchar('api_key', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

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
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

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
});

export const ipWhitelist = pgTable('ip_whitelist', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  ipAddress: varchar('ip_address', { length: 45 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
