import { Hono } from 'hono';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { eq, desc, and, gte, lte, isNull, sql } from 'drizzle-orm';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { concurrencyCache } from '../services/concurrency.service.js';
import type { AppVariables } from '../types.js';

export const tenantRoutes = new Hono<{ Variables: AppVariables }>();

tenantRoutes.use('*', authMiddleware);

// Tenant: Get own balance
tenantRoutes.get('/balance', async (c) => {
  const user = c.get('user');
  const dbUser = await db.select({ balance: schema.users.balance, concurrencyLimit: schema.users.concurrencyLimit }).from(schema.users).where(eq(schema.users.id, user.id)).limit(1);
  if (dbUser.length === 0) return c.json({ error: 'User not found' }, 404);

  // Get total topped up from balance_audit
  const topUps = await db.select({
    totalTopUp: sql<string>`coalesce(sum(${schema.balanceAudit.amount}::numeric), 0)`,
  }).from(schema.balanceAudit).where(eq(schema.balanceAudit.userId, user.id));

  const cc = concurrencyCache.get(user.id);
  const balance = parseFloat(dbUser[0]!.balance);
  const totalTopUp = parseFloat(String(topUps[0]?.totalTopUp || '0'));
  const totalConsumed = Math.max(totalTopUp - balance, 0);

  return c.json({
    balance: balance.toFixed(4),
    totalTopUp: totalTopUp.toFixed(4),
    totalConsumed: totalConsumed.toFixed(4),
    concurrencyLimit: dbUser[0]!.concurrencyLimit,
    activeConcurrency: cc?.active || 0,
  });
});

// Tenant: Get recharge records
tenantRoutes.get('/balance/records', async (c) => {
  const user = c.get('user');
  const page = parseInt(c.req.query('page') || '1');
  const pageSize = parseInt(c.req.query('pageSize') || '20');
  const offset = (page - 1) * pageSize;

  try {
    const where = eq(schema.balanceAudit.userId, user.id);

    const countResult = await db.select({ count: sql<number>`count(*)` }).from(schema.balanceAudit).where(where);
    const total = Number(countResult[0]?.count || 0);

    const operatorUser = schema.users;

    const records = await db
      .select({
        id: schema.balanceAudit.id,
        amount: schema.balanceAudit.amount,
        description: schema.balanceAudit.description,
        operatorName: operatorUser.username,
        createdAt: schema.balanceAudit.createdAt,
      })
      .from(schema.balanceAudit)
      .innerJoin(operatorUser, eq(schema.balanceAudit.operatorId, operatorUser.id))
      .where(where)
      .orderBy(desc(schema.balanceAudit.createdAt))
      .limit(pageSize)
      .offset(offset);

    return c.json({ records, total, page, pageSize });
  } catch (error) {
    console.error('Balance records query error:', error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

// Tenant: Get keys
tenantRoutes.get('/keys', async (c) => {
  const user = c.get('user');
  const userKeys = await db.select().from(schema.keys).where(and(eq(schema.keys.userId, user.id), isNull(schema.keys.deletedAt)));
  return c.json(userKeys);
});

// Tenant: Create key
tenantRoutes.post('/keys', async (c) => {
  const user = c.get('user');
  const { name, expiresAt } = await c.req.json();
  const { v4: uuidv4 } = await import('uuid');
  const apiKey = `sk-${uuidv4().replace(/-/g, '')}`;

  await db.insert(schema.keys).values({
    userId: user.id,
    apiKey,
    name,
    ...(expiresAt ? { expiresAt: new Date(expiresAt) } : {}),
  });
  return c.json({ success: true, apiKey });
});

// Tenant: Soft-delete own key
tenantRoutes.delete('/keys/:id', async (c) => {
  const user = c.get('user');
  const keyId = parseInt(c.req.param('id'));
  const keyRecord = await db.select().from(schema.keys).where(and(eq(schema.keys.id, keyId), eq(schema.keys.userId, user.id))).limit(1);
  if (keyRecord.length === 0) return c.json({ error: 'Key not found' }, 404);

  await db.update(schema.keys).set({ deletedAt: new Date(), enabled: false }).where(eq(schema.keys.id, keyId));
  return c.json({ success: true });
});

// Tenant: Get Usage
tenantRoutes.get('/usage', async (c) => {
  const user = c.get('user');
  const page = parseInt(c.req.query('page') || '1');
  const pageSize = parseInt(c.req.query('pageSize') || '20');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const offset = (page - 1) * pageSize;

  try {
    const conditions: any[] = [eq(schema.usageLogs.userId, user.id)];
    if (startDate) conditions.push(gte(schema.usageLogs.createdAt, new Date(startDate)));
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.usageLogs.createdAt, end));
    }
    const where = and(...conditions);

    const countResult = await db.select({ count: sql<number>`count(*)` }).from(schema.usageLogs).where(where);
    const total = Number(countResult[0]?.count || 0);

    const totalsResult = await db.select({
      totalTokens: sql<number>`coalesce(sum(${schema.usageLogs.completionTokens}), 0)`,
      totalCost: sql<string>`coalesce(sum(${schema.usageLogs.costYuan}::numeric), 0)`,
    }).from(schema.usageLogs).where(where);

    const logs = await db.select().from(schema.usageLogs)
      .where(where)
      .orderBy(desc(schema.usageLogs.createdAt))
      .limit(pageSize)
      .offset(offset);

    const keySummary = await db.select({
      keyId: schema.usageLogs.keyId,
      keyName: schema.keys.name,
      totalTokens: sql<number>`coalesce(sum(${schema.usageLogs.completionTokens}), 0)`,
      totalCost: sql<string>`coalesce(sum(${schema.usageLogs.costYuan}::numeric), 0)`,
      requestCount: sql<number>`count(*)`,
    })
      .from(schema.usageLogs)
      .innerJoin(schema.keys, eq(schema.usageLogs.keyId, schema.keys.id))
      .where(where)
      .groupBy(schema.usageLogs.keyId, schema.keys.name);

    return c.json({
      logs, total, page, pageSize,
      totalTokens: Number(totalsResult[0]?.totalTokens || 0),
      totalCost: parseFloat(String(totalsResult[0]?.totalCost || '0')).toFixed(4),
      keySummary: keySummary.map(k => ({
        keyId: k.keyId,
        keyName: k.keyName,
        totalTokens: Number(k.totalTokens),
        totalCost: parseFloat(String(k.totalCost || '0')).toFixed(4),
        requestCount: Number(k.requestCount),
      })),
    });
  } catch (error) {
    console.error('Tenant usage query error:', error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

// Tenant: Get usage log result detail
tenantRoutes.get('/usage/:id/result', async (c) => {
  const user = c.get('user');
  const logId = parseInt(c.req.param('id'));

  try {
    const log = await db.select({
      id: schema.usageLogs.id,
      userId: schema.usageLogs.userId,
      resultData: schema.usageLogs.resultData,
    }).from(schema.usageLogs).where(eq(schema.usageLogs.id, logId)).limit(1);

    if (log.length === 0) return c.json({ error: 'Not found' }, 404);
    if (user.role !== 'admin' && log[0]!.userId !== user.id) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    return c.json({ resultData: log[0]!.resultData });
  } catch (error) {
    console.error('Usage result query error:', error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

// Tenant: Export Usage CSV
tenantRoutes.get('/usage/export', async (c) => {
  const user = c.get('user');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');

  try {
    const conditions: any[] = [eq(schema.usageLogs.userId, user.id)];
    if (startDate) conditions.push(gte(schema.usageLogs.createdAt, new Date(startDate)));
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.usageLogs.createdAt, end));
    }

    const logs = await db.select().from(schema.usageLogs)
      .where(and(...conditions))
      .orderBy(desc(schema.usageLogs.createdAt))
      .limit(50000);

    const header = 'ID,KeyID,Endpoint,TaskID,Tokens,InputType,UnitPrice,Cost(CNY),Status,CreatedAt';
    const rows = logs.map(u =>
      [u.id, u.keyId, u.endpoint, u.taskId || '', u.completionTokens || 0,
       u.hasVideoInput ? '含视频' : '纯文本', u.hasVideoInput ? 28 : 46,
       u.costYuan, u.status, new Date(u.createdAt).toISOString()].join(',')
    );
    const csv = '\uFEFF' + [header, ...rows].join('\n');

    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="usage_${new Date().toISOString().slice(0,10)}.csv"`);
    return c.body(csv);
  } catch (error) {
    console.error('Tenant usage export error:', error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

// Get current user's IP whitelist
tenantRoutes.get('/whitelist', async (c) => {
  const user = c.get('user');
  const list = await db.select().from(schema.ipWhitelist).where(eq(schema.ipWhitelist.userId, user.id));
  return c.json(list);
});

// Add IP to whitelist
tenantRoutes.post('/whitelist', async (c) => {
  const user = c.get('user');
  const { ipAddress } = await c.req.json();

  if (!ipAddress || typeof ipAddress !== 'string') {
    return c.json({ error: 'ipAddress is required' }, 400);
  }

  const ipv4Regex = /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
  const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  const trimmedIp = ipAddress.trim();
  if (!ipv4Regex.test(trimmedIp) && !ipv6Regex.test(trimmedIp)) {
    return c.json({ error: 'Invalid IP address format' }, 400);
  }

  const existing = await db.select().from(schema.ipWhitelist).where(eq(schema.ipWhitelist.userId, user.id));
  if (existing.length >= 2) {
    return c.json({ error: '最多只能设置 2 个白名单 IP' }, 400);
  }

  const duplicate = existing.find(e => e.ipAddress === trimmedIp);
  if (duplicate) {
    return c.json({ error: '该 IP 已在白名单中' }, 400);
  }

  await db.insert(schema.ipWhitelist).values({ userId: user.id, ipAddress: trimmedIp });
  return c.json({ success: true });
});

// Delete IP from whitelist
tenantRoutes.delete('/whitelist/:id', async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'));
  const record = await db.select().from(schema.ipWhitelist).where(eq(schema.ipWhitelist.id, id)).limit(1);
  if (record.length === 0 || record[0]!.userId !== user.id) {
    return c.json({ error: 'Not found' }, 404);
  }
  await db.delete(schema.ipWhitelist).where(eq(schema.ipWhitelist.id, id));
  return c.json({ success: true });
});
