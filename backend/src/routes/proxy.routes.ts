import { Hono } from 'hono';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { calculateCost, detectVideoInput } from '../utils/cost.util.js';
import { proxyAuthMiddleware } from '../middlewares/proxy.middleware.js';
import { concurrencyCache, keyConcurrencyCache } from '../services/concurrency.service.js';
import { getProvider } from '../providers/index.js';
import type { AppVariables } from '../types.js';

export const proxyRoutes = new Hono<{ Variables: AppVariables }>();

export const createHandler = async (c: any) => {
  const keyRecord = c.get('keyRecord');
  const body = await c.req.json();
  const startTime = Date.now();
  const clientIp = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';

  // Balance check — also fetch user's provider setting
  const userId = keyRecord.userId;
  const userRecord = await db.select({
    balance: schema.users.balance,
    provider: schema.users.provider,
  }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);

  if (userRecord.length > 0 && parseFloat(userRecord[0]!.balance) <= 0) {
    return c.json({ error: '余额不足，请联系管理员充值' }, 403);
  }

  const provider = userRecord[0]?.provider || 'ark';

  // Key quota check
  if (keyRecord.quotaLimit !== null && keyRecord.quotaLimit !== undefined) {
    const used = parseFloat(keyRecord.quotaUsed || '0');
    const limit = parseFloat(keyRecord.quotaLimit);
    if (used >= limit) {
      return c.json({ error: '该 Key 配额已用尽，请调整配额或重置已用量' }, 403);
    }
  }

  // User-level concurrency check
  let cc = concurrencyCache.get(userId);
  if (!cc) { cc = { limit: 3, active: 0 }; concurrencyCache.set(userId, cc); }
  if (cc.active >= cc.limit) {
    return c.json({ error: `并发数已达上限 (${cc.limit})，请稍后重试` }, 429);
  }

  // Key-level concurrency check
  if (keyRecord.concurrencyLimit !== null && keyRecord.concurrencyLimit !== undefined) {
    const keyActive = keyConcurrencyCache.get(keyRecord.id) || 0;
    if (keyActive >= keyRecord.concurrencyLimit) {
      return c.json({ error: `该 Key 并发数已达上限 (${keyRecord.concurrencyLimit})，请稍后重试` }, 429);
    }
  }
  cc.active++;
  keyConcurrencyCache.set(keyRecord.id, (keyConcurrencyCache.get(keyRecord.id) || 0) + 1);

  const originalBody = JSON.stringify(body);

  try {
    // Delegate to the appropriate upstream provider
    const upstream = getProvider(provider);
    const result = await upstream.createTask(body);

    const durationMs = Date.now() - startTime;
    const responseBody = JSON.stringify(result.rawResponse);
    const isVideoInput = detectVideoInput(JSON.parse(originalBody));

    if (result.statusCode >= 200 && result.statusCode < 300 && result.taskId) {
      // Evolink-specific billing fields; Ark has no top-level duration/quality/credits.
      const evolinkFields = provider === 'evolink'
        ? {
            videoDuration: body.duration || null,
            videoQuality: body.quality || '720p',
            // credits_reserved from upstream create response — authoritative billing value.
            creditsReserved: typeof result.credits === 'number' ? String(result.credits) : null,
          }
        : {};

      await db.insert(schema.usageLogs).values({
        userId: keyRecord.userId,
        keyId: keyRecord.id,
        endpoint: '/create',
        taskId: result.taskId,
        hasVideoInput: isVideoInput,
        status: 'pending',
        provider,
        ...evolinkFields,
        requestBody: originalBody.substring(0, 8192),
      });
    } else {
       cc.active--; // Upstream error, release concurrency immediately
       const ka = keyConcurrencyCache.get(keyRecord.id) || 0;
       if (ka > 0) keyConcurrencyCache.set(keyRecord.id, ka - 1);
    }

    db.insert(schema.requestLogs).values({
      userId: keyRecord.userId,
      keyId: keyRecord.id,
      endpoint: '/create',
      method: 'POST',
      requestBody: originalBody,
      responseBody,
      responseStatus: result.statusCode,
      durationMs,
      ipAddress: clientIp,
    }).catch(err => console.error('Request log insert error:', err));

    c.status(result.statusCode as any);
    return c.json(result.rawResponse);
  } catch (error) {
    console.error('Proxy Create Error:', error);
    cc.active--;
    const ka2 = keyConcurrencyCache.get(keyRecord.id) || 0;
    if (ka2 > 0) keyConcurrencyCache.set(keyRecord.id, ka2 - 1);
    db.insert(schema.requestLogs).values({
      userId: keyRecord.userId,
      keyId: keyRecord.id,
      endpoint: '/create',
      method: 'POST',
      requestBody: originalBody,
      responseBody: JSON.stringify({ error: 'Internal Server Error' }),
      responseStatus: 500,
      durationMs: Date.now() - startTime,
      ipAddress: clientIp,
    }).catch(err => console.error('Request log insert error:', err));
    return c.json({ error: 'Internal Server Error' }, 500);
  }
};

// Per-task-ID poll throttle: minimum 3s between queries for the same task
const taskPollTracker = new Map<string, number>();
// Clean up stale entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [k, v] of taskPollTracker) {
    if (v < cutoff) taskPollTracker.delete(k);
  }
}, 5 * 60 * 1000);

export const getResultHandler = async (c: any) => {
  const keyRecord = c.get('keyRecord');
  let body: any = {};
  if (c.req.method === 'GET') {
    body = { id: c.req.param('id') };
  } else {
    body = await c.req.json();
  }
  const startTime = Date.now();
  const clientIp = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
  const requestBodyStr = JSON.stringify(body);

  // Enforce minimum 3-second interval per task ID
  const queryTaskId = body.id;
  if (queryTaskId) {
    const lastPoll = taskPollTracker.get(queryTaskId);
    const now = Date.now();
    if (lastPoll && (now - lastPoll) < 3000) {
      return c.json({ error: '同一任务ID查询间隔需不少于 3 秒，请稍后重试' }, 429);
    }
    taskPollTracker.set(queryTaskId, now);
  }

  try {
    // Look up existing log to determine provider
    const existingLog = queryTaskId
      ? await db.select().from(schema.usageLogs).where(eq(schema.usageLogs.taskId, queryTaskId)).limit(1)
      : [];
    const logProvider = existingLog.length > 0 ? (existingLog[0]!.provider || 'ark') : 'ark';

    // Use the correct provider for querying
    const upstream = getProvider(logProvider);
    const result = await upstream.queryTask(queryTaskId);

    const durationMs = Date.now() - startTime;
    const responseBody = JSON.stringify(result.rawResponse);

    if (result.statusCode >= 200 && result.statusCode < 300 && result.rawResponse.status) {
      const normalizedStatus = result.rawResponse.status; // Already normalized by provider
      if (normalizedStatus === 'succeeded' || normalizedStatus === 'failed') {
        if (existingLog.length > 0) {
            // Calculate cost using provider-appropriate method
            let cost = '0';
            if (normalizedStatus === 'succeeded') {
              // For Evolink, prefer persisted credits_reserved (captured at create time —
              // query endpoint never exposes usage). Fall back to per-second table.
              const storedCredits = existingLog[0]?.creditsReserved
                ? parseFloat(existingLog[0].creditsReserved)
                : undefined;
              cost = calculateCost(logProvider, {
                completionTokens: result.completionTokens || 0,
                hasVideo: existingLog[0]?.hasVideoInput ?? false,
                duration: result.duration || existingLog[0]?.videoDuration || 5,
                quality: existingLog[0]?.videoQuality || '720p',
                ...(typeof storedCredits === 'number' ? { credits: storedCredits } : {}),
              });
            }

            // Optimistic lock: only update if status is 'pending' or 'expired' to allow recovery
            let statusUpdated = false;
            await db.transaction(async (tx) => {
              const updateResult = await tx.update(schema.usageLogs)
                .set({
                  status: normalizedStatus,
                  completionTokens: result.completionTokens || 0,
                  // Update Evolink video duration if provided by upstream
                  ...(result.duration ? { videoDuration: result.duration } : {}),
                  costYuan: cost,
                  resultData: responseBody,
                  updatedAt: new Date()
                })
                .where(and(
                  eq(schema.usageLogs.taskId, queryTaskId),
                  sql`${schema.usageLogs.status} IN ('pending', 'expired')`
                ))
                .returning({ id: schema.usageLogs.id });

              statusUpdated = updateResult.length > 0;

              // Only deduct balance if we actually transitioned from pending or recovered from expired
              if (statusUpdated && normalizedStatus === 'succeeded' && parseFloat(cost) > 0) {
                await tx.update(schema.users)
                  .set({ balance: sql`${schema.users.balance} - ${cost}` })
                  .where(eq(schema.users.id, existingLog[0]!.userId));
                // Accumulate key quota used
                await tx.update(schema.keys)
                  .set({ quotaUsed: sql`${schema.keys.quotaUsed}::numeric + ${cost}::numeric` })
                  .where(eq(schema.keys.id, existingLog[0]!.keyId));
              }
            });

            // Only decrement concurrency if we were the one to transition status
            if (statusUpdated) {
              const ucc = concurrencyCache.get(existingLog[0]!.userId);
              if (ucc && ucc.active > 0) ucc.active--;
              // Release key-level concurrency
              const kcc = keyConcurrencyCache.get(existingLog[0]!.keyId) || 0;
              if (kcc > 0) keyConcurrencyCache.set(existingLog[0]!.keyId, kcc - 1);
            }
        }
      }
    }

    db.insert(schema.requestLogs).values({
      userId: keyRecord.userId,
      keyId: keyRecord.id,
      endpoint: '/get_result',
      method: c.req.method,
      requestBody: requestBodyStr,
      responseBody,
      responseStatus: result.statusCode,
      durationMs,
      ipAddress: clientIp,
    }).catch(err => console.error('Request log insert error:', err));

    c.status(result.statusCode as any);
    return c.json(result.rawResponse);
  } catch (error) {
    console.error('Proxy Get Result Error:', error);
    db.insert(schema.requestLogs).values({
      userId: keyRecord.userId,
      keyId: keyRecord.id,
      endpoint: '/get_result',
      method: c.req.method,
      requestBody: requestBodyStr,
      responseBody: JSON.stringify({ error: 'Internal Server Error' }),
      responseStatus: 500,
      durationMs: Date.now() - startTime,
      ipAddress: clientIp,
    }).catch(err => console.error('Request log insert error:', err));
    return c.json({ error: 'Internal Server Error' }, 500);
  }
};

proxyRoutes.post('/create', proxyAuthMiddleware, createHandler);
proxyRoutes.post('/get_result', proxyAuthMiddleware, getResultHandler);
