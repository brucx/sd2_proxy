import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { logger } from '../utils/logger.util.js';
import { eq, and, sql } from 'drizzle-orm';

// In-memory concurrency tracking per user
export const concurrencyCache: Map<number, { limit: number, active: number }> = new Map();

// Load concurrency cache from database on startup
export const loadConcurrencyCache = async () => {
  try {
    const allUsers = await db.select({ id: schema.users.id, concurrencyLimit: schema.users.concurrencyLimit }).from(schema.users);
    for (const u of allUsers) {
      const pending = await db.select({ count: sql<number>`count(*)` })
        .from(schema.usageLogs)
        .where(and(eq(schema.usageLogs.userId, u.id), eq(schema.usageLogs.status, 'pending')));
      concurrencyCache.set(u.id, { limit: u.concurrencyLimit, active: Number(pending[0]?.count || 0) });
    }
    logger.info(`Concurrency cache loaded for ${concurrencyCache.size} users`);
  } catch (e) {
    logger.error({ err: e }, 'Error loading concurrency cache');
  }
};
