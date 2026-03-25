import { Hono } from 'hono';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { calculateCost, detectVideoInput } from '../utils/cost.util.js';
import { proxyAuthMiddleware } from '../middlewares/proxy.middleware.js';
import { concurrencyCache, keyConcurrencyCache } from '../services/concurrency.service.js';
import type { AppVariables } from '../types.js';

export const proxyRoutes = new Hono<{ Variables: AppVariables }>();

proxyRoutes.post('/create', proxyAuthMiddleware, async (c) => {
  const keyRecord = c.get('keyRecord');
  const body = await c.req.json();
  const startTime = Date.now();
  const clientIp = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';

  // Balance check
  const userId = keyRecord.userId;
  const userRecord = await db.select({ balance: schema.users.balance }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (userRecord.length > 0 && parseFloat(userRecord[0]!.balance) <= 0) {
    return c.json({ error: '余额不足，请联系管理员充值' }, 403);
  }

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

  const userModel = body.model;
  const mappedModel = config.MODEL_MAPPING[userModel];
  if (!mappedModel) {
    cc.active--; 
    return c.json({
      error: `Unsupported model: "${userModel}". Supported models: ${Object.keys(config.MODEL_MAPPING).join(', ')}`
    }, 400);
  }
  body.model = mappedModel;

  try {
    const upstreamRes = await fetch(`${config.UPSTREAM_URL}/api/v1/doubao/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.ARK_API_KEY}`
      },
      body: JSON.stringify(body)
    });

    const data: any = await upstreamRes.json();
    const durationMs = Date.now() - startTime;
    const responseBody = JSON.stringify(data);
    const isVideoInput = detectVideoInput(JSON.parse(originalBody));

    if (upstreamRes.ok && data.id) {
      await db.insert(schema.usageLogs).values({
        userId: keyRecord.userId,
        keyId: keyRecord.id,
        endpoint: '/create',
        taskId: data.id,
        hasVideoInput: isVideoInput,
        status: 'pending',
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
      responseStatus: upstreamRes.status,
      durationMs,
      ipAddress: clientIp,
    }).catch(err => console.error('Request log insert error:', err));

    c.status(upstreamRes.status as any);
    return c.json(data);
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
});

proxyRoutes.post('/get_result', proxyAuthMiddleware, async (c) => {
  const keyRecord = c.get('keyRecord');
  const body = await c.req.json();
  const startTime = Date.now();
  const clientIp = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
  const requestBodyStr = JSON.stringify(body);

  try {
    const upstreamRes = await fetch(`${config.UPSTREAM_URL}/api/v1/doubao/get_result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.ARK_API_KEY}`
      },
      body: JSON.stringify(body)
    });

    const data: any = await upstreamRes.json();
    const durationMs = Date.now() - startTime;
    const responseBody = JSON.stringify(data);

    if (upstreamRes.ok && data.status) {
      if (data.status === 'succeeded' || data.status === 'failed') {
        const completionTokens = data.usage?.completion_tokens || 0;
        const existingLog = await db.select().from(schema.usageLogs).where(eq(schema.usageLogs.taskId, data.id)).limit(1);
        
        if (existingLog.length > 0) {
            const hasVideo = existingLog[0]?.hasVideoInput ?? false;
            const cost = data.status === 'succeeded' ? calculateCost(completionTokens, hasVideo) : '0';

            // Optimistic lock: only update if status is still 'pending' to prevent double deduction
            let statusUpdated = false;
            await db.transaction(async (tx) => {
              const updateResult = await tx.update(schema.usageLogs)
                .set({
                  status: data.status,
                  completionTokens: completionTokens,
                  costYuan: cost,
                  resultData: JSON.stringify(data),
                  updatedAt: new Date()
                })
                .where(and(
                  eq(schema.usageLogs.taskId, data.id),
                  eq(schema.usageLogs.status, 'pending')
                ))
                .returning({ id: schema.usageLogs.id });

              statusUpdated = updateResult.length > 0;

              // Only deduct balance if we actually transitioned from pending
              if (statusUpdated && data.status === 'succeeded' && parseFloat(cost) > 0) {
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
      method: 'POST',
      requestBody: requestBodyStr,
      responseBody,
      responseStatus: upstreamRes.status,
      durationMs,
      ipAddress: clientIp,
    }).catch(err => console.error('Request log insert error:', err));

    c.status(upstreamRes.status as any);
    return c.json(data);
  } catch (error) {
    console.error('Proxy Get Result Error:', error);
    db.insert(schema.requestLogs).values({
      userId: keyRecord.userId,
      keyId: keyRecord.id,
      endpoint: '/get_result',
      method: 'POST',
      requestBody: requestBodyStr,
      responseBody: JSON.stringify({ error: 'Internal Server Error' }),
      responseStatus: 500,
      durationMs: Date.now() - startTime,
      ipAddress: clientIp,
    }).catch(err => console.error('Request log insert error:', err));
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});
