import type { InferSelectModel } from 'drizzle-orm';
import type { users, keys, usageLogs, requestLogs, balanceAudit, ipWhitelist } from './db/schema.js';

// Drizzle-inferred model types
export type User = InferSelectModel<typeof users>;
export type Key = InferSelectModel<typeof keys>;
export type UsageLog = InferSelectModel<typeof usageLogs>;
export type RequestLog = InferSelectModel<typeof requestLogs>;
export type BalanceAuditRecord = InferSelectModel<typeof balanceAudit>;
export type IpWhitelistRecord = InferSelectModel<typeof ipWhitelist>;

// JWT payload type
export interface JwtPayload {
  id: number;
  username: string;
  role: string;
}

// Hono context variables
export interface AppVariables {
  user: JwtPayload;
  keyRecord: Key;
}
