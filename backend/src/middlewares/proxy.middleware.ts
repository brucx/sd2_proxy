import type { Context, Next } from 'hono';
import type { AppVariables } from '../types.js';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { eq } from 'drizzle-orm';

// Simple In-memory Rate Limiting (Requests per minute per key)
export const rateLimits: Record<string, { count: number, resetTime: number }> = {};
const RATE_LIMIT_MAX = 60; // 60 requests per minute

// Login Brute-force Protection
export const loginAttempts: Record<string, { count: number; resetTime: number }> = {};
export const LOGIN_MAX_ATTEMPTS = 5; // 5 attempts per minute per IP

// API Key cache with TTL to avoid per-request DB queries
const keyCache: Map<string, { record: any; whitelist: any[]; expiry: number }> = new Map();
const KEY_CACHE_TTL = 60_000; // 60 seconds

export function clearKeyCache() {
  keyCache.clear();
}

// Periodically clean up expired rate limit and login attempt entries
export function startCleanupInterval() {
  setInterval(() => {
    const now = Date.now();
    for (const key of Object.keys(rateLimits)) {
      if (rateLimits[key] && rateLimits[key].resetTime < now) delete rateLimits[key];
    }
    for (const key of Object.keys(loginAttempts)) {
      if (loginAttempts[key] && loginAttempts[key].resetTime < now) delete loginAttempts[key];
    }
  }, 5 * 60 * 1000);
}

export const proxyAuthMiddleware = async (c: Context<{ Variables: AppVariables }>, next: Next) => {
  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'unknown';
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log(`[AUTH] IP: ${clientIp} | Key: (none) | ${c.req.method} ${c.req.path} -> 401 Missing Authorization`);
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const apiKey = authHeader.split(' ')[1];
  const maskedKey = apiKey ? `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}` : '(empty)';
  if (!apiKey) {
    console.log(`[AUTH] IP: ${clientIp} | Key: (empty) | ${c.req.method} ${c.req.path} -> 401 Missing API Key`);
    return c.json({ error: 'Missing API Key' }, 401);
  }

  const now = Date.now();

  // Check cache first
  let cached = keyCache.get(apiKey);
  if (!cached || cached.expiry < now) {
    const keyData = await db
      .select({
        key: schema.keys,
        userStatus: schema.users.status
      })
      .from(schema.keys)
      .innerJoin(schema.users, eq(schema.keys.userId, schema.users.id))
      .where(eq(schema.keys.apiKey, apiKey))
      .limit(1);

    if (keyData.length === 0 || !keyData[0]) {
      console.log(`[AUTH] IP: ${clientIp} | Key: ${maskedKey} | ${c.req.method} ${c.req.path} -> 401 Invalid API Key`);
      return c.json({ error: 'Invalid API Key' }, 401);
    }
    const { key, userStatus } = keyData[0];
    if (userStatus !== 'active') {
      console.log(`[AUTH] IP: ${clientIp} | Key: ${maskedKey} | ${c.req.method} ${c.req.path} -> 403 Account suspended`);
      return c.json({ error: 'Account suspended' }, 403);
    }
    if (!key.enabled || key.deletedAt) {
      console.log(`[AUTH] IP: ${clientIp} | Key: ${maskedKey} | ${c.req.method} ${c.req.path} -> 401 Key disabled/deleted`);
      return c.json({ error: 'Invalid API Key' }, 401);
    }
    if (key.expiresAt && new Date(key.expiresAt) < new Date()) {
      console.log(`[AUTH] IP: ${clientIp} | Key: ${maskedKey} | ${c.req.method} ${c.req.path} -> 401 Key expired`);
      return c.json({ error: 'API Key has expired' }, 401);
    }
    const whitelist = await db.select().from(schema.ipWhitelist).where(eq(schema.ipWhitelist.userId, key.userId));
    cached = { record: key, whitelist, expiry: now + KEY_CACHE_TTL };
    keyCache.set(apiKey, cached);
  }

  // Rate limiting
  let limit = rateLimits[apiKey];
  if (!limit || limit.resetTime < now) {
    limit = { count: 0, resetTime: now + 60000 };
    rateLimits[apiKey] = limit;
  }

  if (limit.count >= RATE_LIMIT_MAX) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  limit.count++;

  // IP Whitelist check
  if (cached && cached.whitelist.length > 0) {
    const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'unknown';
    const allowed = cached.whitelist.some((w: any) => w.ipAddress === clientIp);
    if (!allowed) {
      return c.json({ error: `IP ${clientIp} is not in the whitelist` }, 403);
    }
  }

  c.set('keyRecord', cached.record as any);
  await next();
};
