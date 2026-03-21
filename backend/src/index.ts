import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { config } from 'dotenv';
import { db } from './db/index.js';
import * as schema from './db/schema.js';
import { eq, desc, sql, and, gte, lte, isNull } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cron from 'node-cron';

config();

// -- Environment Variable Validation --
const requiredEnvVars = ['JWT_SECRET'] as const;
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`FATAL: Environment variable ${envVar} is not set.`);
    process.exit(1);
  }
}

const app = new Hono<{
  Variables: {
    user: any;
    keyRecord: any;
  }
}>();

app.use('*', logger());
app.use('*', cors({
  origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()) : '*',
}));

// Security response headers
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
});

// Disable caching for all API responses
app.use('/api/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate');
  c.header('Pragma', 'no-cache');
});

const JWT_SECRET = process.env.JWT_SECRET!;
const UPSTREAM_URL = process.env.UPSTREAM_URL || 'http://127.0.0.1';
const ARK_API_KEY = process.env.ARK_API_KEY || '';
const PENDING_TIMEOUT_MS = (parseInt(process.env.PENDING_TIMEOUT_MINUTES || '20')) * 60 * 1000;

// Upstream pricing (CNY per million tokens)
const PRICE_WITH_VIDEO = parseFloat(process.env.PRICE_WITH_VIDEO || '28');
const PRICE_WITHOUT_VIDEO = parseFloat(process.env.PRICE_WITHOUT_VIDEO || '46');

// Detect if request body contains video input
function detectVideoInput(body: any): boolean {
  try {
    const contents = body?.content || [];
    return Array.isArray(contents) && contents.some((item: any) => item.type === 'video_url' || item.type === 'video');
  } catch {
    return false;
  }
}

// Calculate cost in CNY
function calculateCost(completionTokens: number, hasVideo: boolean): string {
  const pricePerToken = (hasVideo ? PRICE_WITH_VIDEO : PRICE_WITHOUT_VIDEO) / 1_000_000;
  return (completionTokens * pricePerToken).toFixed(6);
}

// -- Authentication Middleware for Panel --
const authMiddleware = async (c: any, next: any) => {
  const token = c.req.header('Authorization')?.split(' ')[1];
  if (!token) return c.json({ error: 'Unauthorized' }, 401);

  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    c.set('user', payload);
    await next();
  } catch (err) {
    return c.json({ error: 'Invalid token' }, 401);
  }
};

const adminMiddleware = async (c: any, next: any) => {
  const user = c.get('user') as any;
  if (user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403);
  await next();
};

// -- Login Brute-force Protection --
const loginAttempts: Record<string, { count: number; resetTime: number }> = {};
const LOGIN_MAX_ATTEMPTS = 5; // 5 attempts per minute per IP

// -- Panel API --

// Login
app.post('/api/panel/login', async (c) => {
  // Rate limit login by IP
  const loginIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'unknown';
  const now = Date.now();
  let attempt = loginAttempts[loginIp];
  if (!attempt || attempt.resetTime < now) {
    attempt = { count: 0, resetTime: now + 60000 };
    loginAttempts[loginIp] = attempt;
  }
  if (attempt.count >= LOGIN_MAX_ATTEMPTS) {
    return c.json({ error: '登录尝试过于频繁，请稍后再试' }, 429);
  }
  attempt.count++;

  const { username, password } = await c.req.json();

  if (!username || !password) return c.json({ error: 'Invalid credentials' }, 401);

  const user = await db.select().from(schema.users).where(eq(schema.users.username, username)).limit(1);

  if (!user || user.length === 0 || !user[0]) return c.json({ error: 'Invalid credentials' }, 401);

  const match = await bcrypt.compare(password, user[0].passwordHash);
  if (!match) return c.json({ error: 'Invalid credentials' }, 401);

  const token = jwt.sign({ id: user[0].id, role: user[0].role }, JWT_SECRET, { expiresIn: '24h' });
  return c.json({ token, role: user[0].role, username: user[0].username });
});

// Get current user info
app.get('/api/panel/me', authMiddleware, async (c) => {
  const user = c.get('user') as any;
  const userInfo = await db.select({ id: schema.users.id, username: schema.users.username, role: schema.users.role }).from(schema.users).where(eq(schema.users.id, user.id)).limit(1);
  return c.json(userInfo[0]);
});

// Change own password
app.put('/api/panel/me/password', authMiddleware, async (c) => {
  const user = c.get('user') as any;
  const { oldPassword, newPassword } = await c.req.json();

  if (!oldPassword || !newPassword) return c.json({ error: 'Old password and new password are required' }, 400);
  if (typeof newPassword !== 'string' || newPassword.length < 6) return c.json({ error: '密码长度不能少于 6 位' }, 400);

  const dbUser = await db.select().from(schema.users).where(eq(schema.users.id, user.id)).limit(1);
  if (dbUser.length === 0) return c.json({ error: 'User not found' }, 404);

  const match = await bcrypt.compare(oldPassword, dbUser[0]!.passwordHash);
  if (!match) return c.json({ error: 'Old password is incorrect' }, 400);

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, user.id));
  return c.json({ success: true });
});

// Admin: Reset user password
app.put('/api/panel/admin/users/:id/password', authMiddleware, adminMiddleware, async (c) => {
  const userId = parseInt(c.req.param('id'));
  const { newPassword } = await c.req.json();

  if (!newPassword) return c.json({ error: 'New password is required' }, 400);
  if (typeof newPassword !== 'string' || newPassword.length < 6) return c.json({ error: '密码长度不能少于 6 位' }, 400);

  const targetUser = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (targetUser.length === 0) return c.json({ error: 'User not found' }, 404);

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, userId));
  return c.json({ success: true });
});

// Admin: Get all users
app.get('/api/panel/admin/users', authMiddleware, adminMiddleware, async (c) => {
  const usersList = await db.select({ id: schema.users.id, username: schema.users.username, role: schema.users.role, concurrencyLimit: schema.users.concurrencyLimit, balance: schema.users.balance, createdAt: schema.users.createdAt }).from(schema.users);
  return c.json(usersList.map(u => ({
    ...u,
    activeConcurrency: concurrencyCache.get(u.id)?.active || 0,
  })));
});

// Admin: Update user concurrency limit
app.put('/api/panel/admin/users/:id/concurrency', authMiddleware, adminMiddleware, async (c) => {
  const userId = parseInt(c.req.param('id'));
  const { concurrencyLimit } = await c.req.json();
  if (typeof concurrencyLimit !== 'number' || concurrencyLimit < 1 || concurrencyLimit > 100) {
    return c.json({ error: '并发数必须在 1-100 之间' }, 400);
  }
  const targetUser = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (targetUser.length === 0) return c.json({ error: 'User not found' }, 404);
  await db.update(schema.users).set({ concurrencyLimit }).where(eq(schema.users.id, userId));
  // Update cache
  const cc = concurrencyCache.get(userId);
  if (cc) { cc.limit = concurrencyLimit; }
  else { concurrencyCache.set(userId, { limit: concurrencyLimit, active: 0 }); }
  return c.json({ success: true });
});

// Admin: Create user
app.post('/api/panel/admin/users', authMiddleware, adminMiddleware, async (c) => {
  const { username, password, role } = await c.req.json();
  if (!username || !password) return c.json({ error: 'Username and password are required' }, 400);
  if (typeof password !== 'string' || password.length < 6) return c.json({ error: '密码长度不能少于 6 位' }, 400);
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    await db.insert(schema.users).values({ username, passwordHash, role: role || 'tenant' });
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ error: 'Username may already exist' }, 400);
  }
});

// Admin: Add balance to user
app.post('/api/panel/admin/users/:id/balance', authMiddleware, adminMiddleware, async (c) => {
  const userId = parseInt(c.req.param('id'));
  const adminUser = c.get('user') as any;
  const { amount, description } = await c.req.json();

  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    return c.json({ error: '充值金额必须大于 0' }, 400);
  }

  const targetUser = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (targetUser.length === 0) return c.json({ error: 'User not found' }, 404);

  // Insert audit record
  await db.insert(schema.balanceAudit).values({
    userId,
    amount: numAmount.toFixed(4),
    description: description || '管理员充值',
    operatorId: adminUser.id,
  });

  // Atomic balance update — prevents race conditions
  await db.update(schema.users)
    .set({ balance: sql`(${schema.users.balance}::numeric + ${numAmount})::text` })
    .where(eq(schema.users.id, userId));

  // Read updated balance for response
  const updatedUser = await db.select({ balance: schema.users.balance }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return c.json({ success: true, balance: updatedUser[0]?.balance || '0' });
});

// Tenant: Get own balance
app.get('/api/panel/balance', authMiddleware, async (c) => {
  const user = c.get('user') as any;
  const dbUser = await db.select({ balance: schema.users.balance, concurrencyLimit: schema.users.concurrencyLimit }).from(schema.users).where(eq(schema.users.id, user.id)).limit(1);
  if (dbUser.length === 0) return c.json({ error: 'User not found' }, 404);

  // Get total topped up from balance_audit
  const topUps = await db.select({
    totalTopUp: sql<string>`coalesce(sum(${schema.balanceAudit.amount}::numeric), 0)`,
  }).from(schema.balanceAudit).where(eq(schema.balanceAudit.userId, user.id));

  const cc = concurrencyCache.get(user.id);
  const balance = parseFloat(dbUser[0]!.balance);
  const totalTopUp = parseFloat(String(topUps[0]?.totalTopUp || '0'));
  // totalConsumed = totalTopUp - balance, 无需再聚合 usage_logs
  const totalConsumed = Math.max(totalTopUp - balance, 0);

  return c.json({
    balance: balance.toFixed(4),
    totalTopUp: totalTopUp.toFixed(4),
    totalConsumed: totalConsumed.toFixed(4),
    concurrencyLimit: dbUser[0]!.concurrencyLimit,
    activeConcurrency: cc?.active || 0,
  });
});

// Tenant: Get recharge records (balance audit)
app.get('/api/panel/balance/records', authMiddleware, async (c) => {
  const user = c.get('user') as any;
  const page = parseInt(c.req.query('page') || '1');
  const pageSize = parseInt(c.req.query('pageSize') || '20');
  const offset = (page - 1) * pageSize;

  try {
    const where = eq(schema.balanceAudit.userId, user.id);

    const countResult = await db.select({ count: sql<number>`count(*)` }).from(schema.balanceAudit).where(where);
    const total = Number(countResult[0]?.count || 0);

    // Create an alias for the operator user
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

// Tenant: Get keys (exclude soft-deleted)
app.get('/api/panel/keys', authMiddleware, async (c) => {
  const user = c.get('user') as any;
  const userKeys = await db.select().from(schema.keys).where(and(eq(schema.keys.userId, user.id), isNull(schema.keys.deletedAt)));
  return c.json(userKeys);
});

// Tenant: Create key
app.post('/api/panel/keys', authMiddleware, async (c) => {
  const user = c.get('user') as any;
  const { name } = await c.req.json();
  const { v4: uuidv4 } = await import('uuid');
  const apiKey = `sk-${uuidv4().replace(/-/g, '')}`;

  await db.insert(schema.keys).values({ userId: user.id, apiKey, name });
  return c.json({ success: true, apiKey });
});

// Tenant: Soft-delete own key
app.delete('/api/panel/keys/:id', authMiddleware, async (c) => {
  const user = c.get('user') as any;
  const keyId = parseInt(c.req.param('id'));
  const keyRecord = await db.select().from(schema.keys).where(and(eq(schema.keys.id, keyId), eq(schema.keys.userId, user.id))).limit(1);
  if (keyRecord.length === 0) return c.json({ error: 'Key not found' }, 404);

  await db.update(schema.keys).set({ deletedAt: new Date(), enabled: false }).where(eq(schema.keys.id, keyId));
  return c.json({ success: true });
});

// Tenant: Get Usage (with pagination & date filter)
app.get('/api/panel/usage', authMiddleware, async (c) => {
  const user = c.get('user') as any;
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

    // Per-key summary
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

// Get usage log result detail (for expanding rows)
app.get('/api/panel/usage/:id/result', authMiddleware, async (c) => {
  const user = c.get('user') as any;
  const logId = parseInt(c.req.param('id'));

  try {
    const log = await db.select({
      id: schema.usageLogs.id,
      userId: schema.usageLogs.userId,
      resultData: schema.usageLogs.resultData,
    }).from(schema.usageLogs).where(eq(schema.usageLogs.id, logId)).limit(1);

    if (log.length === 0) return c.json({ error: 'Not found' }, 404);

    // Tenant can only view own records
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
app.get('/api/panel/usage/export', authMiddleware, async (c) => {
  const user = c.get('user') as any;
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

// Admin: Get All Usage (with pagination, user & date filter)
app.get('/api/panel/admin/usage', authMiddleware, adminMiddleware, async (c) => {
  const page = parseInt(c.req.query('page') || '1');
  const pageSize = parseInt(c.req.query('pageSize') || '20');
  const userIdFilter = c.req.query('userId');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const offset = (page - 1) * pageSize;

  try {
    const conditions: any[] = [];
    if (userIdFilter) conditions.push(eq(schema.usageLogs.userId, parseInt(userIdFilter)));
    if (startDate) conditions.push(gte(schema.usageLogs.createdAt, new Date(startDate)));
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.usageLogs.createdAt, end));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const countResult = where
      ? await db.select({ count: sql<number>`count(*)` }).from(schema.usageLogs).where(where)
      : await db.select({ count: sql<number>`count(*)` }).from(schema.usageLogs);
    const total = Number(countResult[0]?.count || 0);

    const totalsResult = where
      ? await db.select({
          totalTokens: sql<number>`coalesce(sum(${schema.usageLogs.completionTokens}), 0)`,
          totalCost: sql<string>`coalesce(sum(${schema.usageLogs.costYuan}::numeric), 0)`,
        }).from(schema.usageLogs).where(where)
      : await db.select({
          totalTokens: sql<number>`coalesce(sum(${schema.usageLogs.completionTokens}), 0)`,
          totalCost: sql<string>`coalesce(sum(${schema.usageLogs.costYuan}::numeric), 0)`,
        }).from(schema.usageLogs);

    let query = db
      .select({
        id: schema.usageLogs.id,
        userId: schema.usageLogs.userId,
        username: schema.users.username,
        keyId: schema.usageLogs.keyId,
        endpoint: schema.usageLogs.endpoint,
        taskId: schema.usageLogs.taskId,
        completionTokens: schema.usageLogs.completionTokens,
        hasVideoInput: schema.usageLogs.hasVideoInput,
        costYuan: schema.usageLogs.costYuan,
        status: schema.usageLogs.status,
        createdAt: schema.usageLogs.createdAt,
      })
      .from(schema.usageLogs)
      .innerJoin(schema.users, eq(schema.usageLogs.userId, schema.users.id))
      .orderBy(desc(schema.usageLogs.createdAt))
      .limit(pageSize)
      .offset(offset);

    const logs = where ? await (query as any).where(where) : await query;

    return c.json({
      logs, total, page, pageSize,
      totalTokens: Number(totalsResult[0]?.totalTokens || 0),
      totalCost: parseFloat(String(totalsResult[0]?.totalCost || '0')).toFixed(4),
    });
  } catch (error) {
    console.error('Admin usage query error:', error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

// Admin: Export Usage CSV
app.get('/api/panel/admin/usage/export', authMiddleware, adminMiddleware, async (c) => {
  const userIdFilter = c.req.query('userId');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');

  try {
    const conditions: any[] = [];
    if (userIdFilter) conditions.push(eq(schema.usageLogs.userId, parseInt(userIdFilter)));
    if (startDate) conditions.push(gte(schema.usageLogs.createdAt, new Date(startDate)));
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.usageLogs.createdAt, end));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    let query = db
      .select({
        id: schema.usageLogs.id,
        username: schema.users.username,
        keyId: schema.usageLogs.keyId,
        endpoint: schema.usageLogs.endpoint,
        taskId: schema.usageLogs.taskId,
        completionTokens: schema.usageLogs.completionTokens,
        hasVideoInput: schema.usageLogs.hasVideoInput,
        costYuan: schema.usageLogs.costYuan,
        status: schema.usageLogs.status,
        createdAt: schema.usageLogs.createdAt,
      })
      .from(schema.usageLogs)
      .innerJoin(schema.users, eq(schema.usageLogs.userId, schema.users.id))
      .orderBy(desc(schema.usageLogs.createdAt))
      .limit(50000);

    const logs = where ? await (query as any).where(where) : await query;

    const header = 'ID,Username,KeyID,Endpoint,TaskID,Tokens,InputType,UnitPrice,Cost(CNY),Status,CreatedAt';
    const rows = logs.map((u: any) =>
      [u.id, u.username, u.keyId, u.endpoint, u.taskId || '', u.completionTokens || 0,
       u.hasVideoInput ? '含视频' : '纯文本', u.hasVideoInput ? 28 : 46,
       u.costYuan, u.status, new Date(u.createdAt).toISOString()].join(',')
    );
    const csv = '\uFEFF' + [header, ...rows].join('\n');

    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="usage_all_${new Date().toISOString().slice(0,10)}.csv"`);
    return c.body(csv);
  } catch (error) {
    console.error('Admin usage export error:', error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

// Admin: Get Request Logs (with pagination & user filter)
app.get('/api/panel/admin/request-logs', authMiddleware, adminMiddleware, async (c) => {
  const page = parseInt(c.req.query('page') || '1');
  const pageSize = parseInt(c.req.query('pageSize') || '50');
  const userIdFilter = c.req.query('userId');
  const offset = (page - 1) * pageSize;

  try {
    // Build conditions
    const conditions = userIdFilter ? eq(schema.requestLogs.userId, parseInt(userIdFilter)) : undefined;

    // Get total count
    const countResult = conditions
      ? await db.select({ count: sql<number>`count(*)` }).from(schema.requestLogs).where(conditions)
      : await db.select({ count: sql<number>`count(*)` }).from(schema.requestLogs);
    const total = Number(countResult[0]?.count || 0);

    // Get logs with user info
    let query = db
      .select({
        id: schema.requestLogs.id,
        userId: schema.requestLogs.userId,
        username: schema.users.username,
        keyId: schema.requestLogs.keyId,
        endpoint: schema.requestLogs.endpoint,
        method: schema.requestLogs.method,
        requestBody: schema.requestLogs.requestBody,
        responseBody: schema.requestLogs.responseBody,
        responseStatus: schema.requestLogs.responseStatus,
        durationMs: schema.requestLogs.durationMs,
        ipAddress: schema.requestLogs.ipAddress,
        createdAt: schema.requestLogs.createdAt,
      })
      .from(schema.requestLogs)
      .innerJoin(schema.users, eq(schema.requestLogs.userId, schema.users.id))
      .orderBy(desc(schema.requestLogs.createdAt))
      .limit(pageSize)
      .offset(offset);

    const logs = conditions
      ? await (query as any).where(conditions)
      : await query;

    return c.json({ logs, total, page, pageSize });
  } catch (error) {
    console.error('Request logs query error:', error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

// Admin: Get all keys (with username)
app.get('/api/panel/admin/keys', authMiddleware, adminMiddleware, async (c) => {
  const allKeys = await db
    .select({
      id: schema.keys.id,
      userId: schema.keys.userId,
      username: schema.users.username,
      apiKey: schema.keys.apiKey,
      name: schema.keys.name,
      enabled: schema.keys.enabled,
      createdAt: schema.keys.createdAt,
    })
    .from(schema.keys)
    .innerJoin(schema.users, eq(schema.keys.userId, schema.users.id));
  return c.json(allKeys);
});

// Admin: Create key for a user
app.post('/api/panel/admin/keys', authMiddleware, adminMiddleware, async (c) => {
  const { userId, name } = await c.req.json();
  if (!userId || !name) return c.json({ error: 'userId and name are required' }, 400);

  const targetUser = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (targetUser.length === 0) return c.json({ error: 'User not found' }, 404);

  const { v4: uuidv4 } = await import('uuid');
  const apiKey = `sk-${uuidv4().replace(/-/g, '')}`;
  await db.insert(schema.keys).values({ userId, apiKey, name });
  return c.json({ success: true, apiKey });
});

// Admin: Toggle key enabled/disabled
app.put('/api/panel/admin/keys/:id/toggle', authMiddleware, adminMiddleware, async (c) => {
  const keyId = parseInt(c.req.param('id'));
  const keyRecord = await db.select().from(schema.keys).where(eq(schema.keys.id, keyId)).limit(1);
  if (keyRecord.length === 0) return c.json({ error: 'Key not found' }, 404);

  const newEnabled = !keyRecord[0]!.enabled;
  await db.update(schema.keys).set({ enabled: newEnabled }).where(eq(schema.keys.id, keyId));
  return c.json({ success: true, enabled: newEnabled });
});

// -- IP Whitelist Management --

// Get current user's IP whitelist
app.get('/api/panel/whitelist', authMiddleware, async (c) => {
  const user = c.get('user') as any;
  const list = await db.select().from(schema.ipWhitelist).where(eq(schema.ipWhitelist.userId, user.id));
  return c.json(list);
});

// Add IP to whitelist (max 2)
app.post('/api/panel/whitelist', authMiddleware, async (c) => {
  const user = c.get('user') as any;
  const { ipAddress } = await c.req.json();

  if (!ipAddress || typeof ipAddress !== 'string') {
    return c.json({ error: 'ipAddress is required' }, 400);
  }

  // Improved IPv4 validation (validates octets 0-255)
  const ipv4Regex = /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
  const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  const trimmedIp = ipAddress.trim();
  if (!ipv4Regex.test(trimmedIp) && !ipv6Regex.test(trimmedIp)) {
    return c.json({ error: 'Invalid IP address format' }, 400);
  }

  // Check current count
  const existing = await db.select().from(schema.ipWhitelist).where(eq(schema.ipWhitelist.userId, user.id));
  if (existing.length >= 2) {
    return c.json({ error: '最多只能设置 2 个白名单 IP' }, 400);
  }

  // Check duplicate
  const duplicate = existing.find(e => e.ipAddress === trimmedIp);
  if (duplicate) {
    return c.json({ error: '该 IP 已在白名单中' }, 400);
  }

  await db.insert(schema.ipWhitelist).values({ userId: user.id, ipAddress: trimmedIp });
  return c.json({ success: true });
});

// Delete IP from whitelist
app.delete('/api/panel/whitelist/:id', authMiddleware, async (c) => {
  const user = c.get('user') as any;
  const id = parseInt(c.req.param('id'));
  const record = await db.select().from(schema.ipWhitelist).where(eq(schema.ipWhitelist.id, id)).limit(1);
  if (record.length === 0 || record[0]!.userId !== user.id) {
    return c.json({ error: 'Not found' }, 404);
  }
  await db.delete(schema.ipWhitelist).where(eq(schema.ipWhitelist.id, id));
  return c.json({ success: true });
});

// -- API Proxy Middleware & Handlers --

// Simple In-memory Rate Limiting (Requests per minute per key)
const rateLimits: Record<string, { count: number, resetTime: number }> = {};
const RATE_LIMIT_MAX = 60; // 60 requests per minute

// Periodically clean up expired rate limit and login attempt entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const key of Object.keys(rateLimits)) {
    if (rateLimits[key] && rateLimits[key].resetTime < now) delete rateLimits[key];
  }
  for (const key of Object.keys(loginAttempts)) {
    if (loginAttempts[key] && loginAttempts[key].resetTime < now) delete loginAttempts[key];
  }
}, 5 * 60 * 1000);

// In-memory concurrency tracking per user
const concurrencyCache: Map<number, { limit: number, active: number }> = new Map();

// API Key cache with TTL to avoid per-request DB queries
const keyCache: Map<string, { record: any; whitelist: any[]; expiry: number }> = new Map();
const KEY_CACHE_TTL = 60_000; // 60 seconds

const proxyAuthMiddleware = async (c: any, next: any) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const apiKey = authHeader.split(' ')[1];
  const now = Date.now();

  // Check cache first
  let cached = keyCache.get(apiKey);
  if (!cached || cached.expiry < now) {
    const keyRecord = await db.select().from(schema.keys).where(eq(schema.keys.apiKey, apiKey)).limit(1);
    if (keyRecord.length === 0) {
      return c.json({ error: 'Invalid API Key' }, 401);
    }
    if (!keyRecord[0]!.enabled || keyRecord[0]!.deletedAt) {
      return c.json({ error: 'Invalid API Key' }, 401);
    }
    const whitelist = await db.select().from(schema.ipWhitelist).where(eq(schema.ipWhitelist.userId, keyRecord[0]!.userId));
    cached = { record: keyRecord[0], whitelist, expiry: now + KEY_CACHE_TTL };
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

  // IP Whitelist check (using cached whitelist)
  if (cached.whitelist.length > 0) {
    const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'unknown';
    const allowed = cached.whitelist.some((w: any) => w.ipAddress === clientIp);
    if (!allowed) {
      return c.json({ error: `IP ${clientIp} is not in the whitelist` }, 403);
    }
  }

  c.set('keyRecord', cached.record);
  await next();
};

// Model ID mapping: user-facing name -> internal endpoint ID
const MODEL_MAP: Record<string, string> = {
  'doubao-seedance-2.0-fast': 'ep-20260307130821-xw5wf',
  'doubao-seedance-2.0-fast-260128': 'ep-20260307130821-xw5wf',
  'doubao-seedance-2-0': 'ep-20260307130721-bx7tv',
  'doubao-seedance-2-0-260128': 'ep-20260307130721-bx7tv',
};

app.post('/api/v1/doubao/create', proxyAuthMiddleware, async (c) => {
  const keyRecord = c.get('keyRecord') as any;
  const body = await c.req.json();
  const startTime = Date.now();
  const clientIp = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';

  // Balance check
  const userId = keyRecord.userId;
  const userRecord = await db.select({ balance: schema.users.balance }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (userRecord.length > 0 && parseFloat(userRecord[0]!.balance) <= 0) {
    return c.json({ error: '余额不足，请联系管理员充值' }, 403);
  }

  // Concurrency check
  let cc = concurrencyCache.get(userId);
  if (!cc) { cc = { limit: 3, active: 0 }; concurrencyCache.set(userId, cc); }
  if (cc.active >= cc.limit) {
    return c.json({ error: `并发数已达上限 (${cc.limit})，请稍后重试` }, 429);
  }
  cc.active++;

  // Save original model name for logging before mapping
  const originalBody = JSON.stringify(body);

  // Map model name to endpoint ID
  const userModel = body.model;
  const mappedModel = MODEL_MAP[userModel];
  if (!mappedModel) {
    cc.active--; // Rollback concurrency on validation error
    return c.json({
      error: `Unsupported model: "${userModel}". Supported models: ${Object.keys(MODEL_MAP).join(', ')}`
    }, 400);
  }
  body.model = mappedModel;

  try {
    const upstreamRes = await fetch(`${UPSTREAM_URL}/api/v1/doubao/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ARK_API_KEY}`
      },
      body: JSON.stringify(body)
    });

    const data: any = await upstreamRes.json();
    const durationMs = Date.now() - startTime;
    const responseBody = JSON.stringify(data);

    // Detect video input from original request body
    const isVideoInput = detectVideoInput(JSON.parse(originalBody));

    if (upstreamRes.ok && data.id) {
      await db.insert(schema.usageLogs).values({
        userId: keyRecord.userId,
        keyId: keyRecord.id,
        endpoint: '/create',
        taskId: data.id,
        hasVideoInput: isVideoInput,
        status: 'pending'
      });
    }

    // Log request asynchronously (don't block response)
    db.insert(schema.requestLogs).values({
      userId: keyRecord.userId,
      keyId: keyRecord.id,
      endpoint: '/create',
      method: 'POST',
      requestBody: originalBody,
      responseBody: responseBody,
      responseStatus: upstreamRes.status,
      durationMs,
      ipAddress: clientIp,
    }).catch(err => console.error('Request log insert error:', err));

    c.status(upstreamRes.status as any);
    return c.json(data);
  } catch (error) {
    console.error('Proxy Create Error:', error);
    cc.active--; // Rollback concurrency on error
    // Log failed request
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

app.post('/api/v1/doubao/get_result', proxyAuthMiddleware, async (c) => {
  const keyRecord = c.get('keyRecord') as any;
  const body = await c.req.json();
  const startTime = Date.now();
  const clientIp = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
  const requestBodyStr = JSON.stringify(body);

  try {
    const upstreamRes = await fetch(`${UPSTREAM_URL}/api/v1/doubao/get_result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ARK_API_KEY}`
      },
      body: JSON.stringify(body)
    });

    const data: any = await upstreamRes.json();
    const durationMs = Date.now() - startTime;
    const responseBody = JSON.stringify(data);

    if (upstreamRes.ok && data.status) {
      // Update usage log if status changed to succeeded or failed
      if (data.status === 'succeeded' || data.status === 'failed') {
        const completionTokens = data.usage?.completion_tokens || 0;

        // Look up the existing log to get hasVideoInput for cost calculation
        const existingLog = await db.select().from(schema.usageLogs).where(eq(schema.usageLogs.taskId, data.id)).limit(1);
        const hasVideo = existingLog[0]?.hasVideoInput ?? false;
        const cost = data.status === 'succeeded' ? calculateCost(completionTokens, hasVideo) : '0';

        await db.update(schema.usageLogs)
          .set({
            status: data.status,
            completionTokens: completionTokens,
            costYuan: cost,
            resultData: JSON.stringify(data),
            updatedAt: new Date()
          })
          .where(eq(schema.usageLogs.taskId, data.id));

        // Decrement concurrency counter
        if (existingLog[0]) {
          const ucc = concurrencyCache.get(existingLog[0].userId);
          if (ucc && ucc.active > 0) ucc.active--;
          // Atomic balance deduction on success
          if (data.status === 'succeeded' && parseFloat(cost) > 0) {
            await db.update(schema.users)
              .set({ balance: sql`(${schema.users.balance}::numeric - ${parseFloat(cost)})::text` })
              .where(eq(schema.users.id, existingLog[0].userId));
          }
        }
      }
    }

    // Log request asynchronously
    db.insert(schema.requestLogs).values({
      userId: keyRecord.userId,
      keyId: keyRecord.id,
      endpoint: '/get_result',
      method: 'POST',
      requestBody: requestBodyStr,
      responseBody: responseBody,
      responseStatus: upstreamRes.status,
      durationMs,
      ipAddress: clientIp,
    }).catch(err => console.error('Request log insert error:', err));

    c.status(upstreamRes.status as any);
    return c.json(data);
  } catch (error) {
    console.error('Proxy Get Result Error:', error);
    // Log failed request
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

// -- Cron Job --
// Poll pending tasks every 5 minutes (batched concurrent processing)
const CRON_BATCH_SIZE = 10;

const processPendingTask = async (log: any) => {
  try {
    if (!log.taskId) return;

    const upstreamRes = await fetch(`${UPSTREAM_URL}/api/v1/doubao/get_result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ARK_API_KEY}`
      },
      body: JSON.stringify({ id: log.taskId })
    });

    if (upstreamRes.ok) {
      const data: any = await upstreamRes.json();
      if (['succeeded', 'failed', 'cancelled', 'expired'].includes(data.status)) {
        const completionTokens = data.usage?.completion_tokens || 0;
        const cost = data.status === 'succeeded' ? calculateCost(completionTokens, log.hasVideoInput) : '0';
        await db.update(schema.usageLogs)
          .set({
            status: data.status,
            completionTokens: completionTokens,
            costYuan: cost,
            resultData: JSON.stringify(data),
            updatedAt: new Date()
          })
          .where(eq(schema.usageLogs.id, log.id));
        // Decrement concurrency counter
        const ucc = concurrencyCache.get(log.userId);
        if (ucc && ucc.active > 0) ucc.active--;
        // Atomic balance deduction on success
        if (data.status === 'succeeded' && parseFloat(cost) > 0) {
          await db.update(schema.users)
            .set({ balance: sql`(${schema.users.balance}::numeric - ${parseFloat(cost)})::text` })
            .where(eq(schema.users.id, log.userId));
        }
        console.log(`Updated task ${log.taskId} status to ${data.status}, cost: ¥${cost}`);
      }
    }
  } catch (err) {
    console.error(`Cron: Error processing task ${log.taskId}:`, err);
  }
};

cron.schedule('*/5 * * * *', async () => {
  console.log('Running Cron Job to poll pending tasks...');
  try {
    const pendingLogs = await db.select().from(schema.usageLogs).where(eq(schema.usageLogs.status, 'pending'));

    // Process in batches of CRON_BATCH_SIZE concurrently
    for (let i = 0; i < pendingLogs.length; i += CRON_BATCH_SIZE) {
      const batch = pendingLogs.slice(i, i + CRON_BATCH_SIZE);
      await Promise.allSettled(batch.map(log => processPendingTask(log)));
    }

    // Auto-expire stuck pending tasks exceeding timeout threshold
    const now = Date.now();
    const stillPending = await db.select().from(schema.usageLogs).where(eq(schema.usageLogs.status, 'pending'));
    for (const log of stillPending) {
      const age = now - new Date(log.createdAt).getTime();
      if (age > PENDING_TIMEOUT_MS) {
        await db.update(schema.usageLogs)
          .set({ status: 'expired', updatedAt: new Date() })
          .where(eq(schema.usageLogs.id, log.id));
        const ucc = concurrencyCache.get(log.userId);
        if (ucc && ucc.active > 0) ucc.active--;
        console.log(`Auto-expired stuck task ${log.taskId} (pending ${Math.round(age / 60000)}min), decremented concurrency for user ${log.userId}`);
      }
    }
  } catch (error) {
    console.error('Cron Job Error:', error);
  }
});

// Setup Initial Admin (Run once)
const setupInitialAdmin = async () => {
  try {
    const admin = await db.select().from(schema.users).where(eq(schema.users.username, 'admin')).limit(1);
    if (admin.length === 0) {
      const adminPwd = process.env.ADMIN_DEFAULT_PASSWORD || 'admin123';
      const passwordHash = await bcrypt.hash(adminPwd, 10);
      await db.insert(schema.users).values({ username: 'admin', passwordHash, role: 'admin' });
      console.log('Initial admin created (admin/' + (process.env.ADMIN_DEFAULT_PASSWORD ? '***' : 'admin123') + ')');
    }
  } catch (e) {
    console.error('Error setting up initial admin', e);
  }
}

// Load concurrency cache from database on startup
const loadConcurrencyCache = async () => {
  try {
    const allUsers = await db.select({ id: schema.users.id, concurrencyLimit: schema.users.concurrencyLimit }).from(schema.users);
    for (const u of allUsers) {
      const pending = await db.select({ count: sql<number>`count(*)` })
        .from(schema.usageLogs)
        .where(and(eq(schema.usageLogs.userId, u.id), eq(schema.usageLogs.status, 'pending')));
      concurrencyCache.set(u.id, { limit: u.concurrencyLimit, active: Number(pending[0]?.count || 0) });
    }
    console.log('Concurrency cache loaded for', concurrencyCache.size, 'users');
  } catch (e) {
    console.error('Error loading concurrency cache', e);
  }
};

setupInitialAdmin().then(() => loadConcurrencyCache());

// Serve Frontend Static Files
app.use('/*', serveStatic({ root: '../frontend/dist' }));

// For client-side routing, handle fallback
app.get('*', serveStatic({ path: '../frontend/dist/index.html' }));

const port = 3000;
console.log(`Server is running on port ${port}`);

serve({
  fetch: app.fetch,
  port
});
