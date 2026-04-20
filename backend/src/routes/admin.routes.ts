import { Hono } from 'hono';
import bcrypt from 'bcrypt';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { eq, desc, and, gte, lte, sql, like, isNull } from 'drizzle-orm';
import { authMiddleware, adminMiddleware } from '../middlewares/auth.middleware.js';
import { clearKeyCache } from '../middlewares/proxy.middleware.js';
import { concurrencyCache } from '../services/concurrency.service.js';
import type { AppVariables } from '../types.js';

export const adminRoutes = new Hono<{ Variables: AppVariables }>();

adminRoutes.use('*', authMiddleware, adminMiddleware);

// Admin: Platform-wide statistics
adminRoutes.get('/stats', async (c) => {
  const [userStats] = await db.select({
    totalUsers: sql<number>`count(*)`,
    activeUsers: sql<number>`count(*) filter (where ${schema.users.status} = 'active')`,
    suspendedUsers: sql<number>`count(*) filter (where ${schema.users.status} = 'suspended')`,
    totalBalance: sql<string>`coalesce(sum(${schema.users.balance}), 0)`,
  }).from(schema.users);

  const [keyStats] = await db.select({
    totalKeys: sql<number>`count(*)`,
    activeKeys: sql<number>`count(*) filter (where ${schema.keys.enabled} = true and ${schema.keys.deletedAt} is null)`,
  }).from(schema.keys);

  const [rechargeStats] = await db.select({
    totalRecharge: sql<string>`coalesce(sum(${schema.balanceAudit.amount}), 0)`,
  }).from(schema.balanceAudit);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [taskStats] = await db.select({
    totalTasks: sql<number>`count(*)`,
    pendingTasks: sql<number>`count(*) filter (where ${schema.usageLogs.status} = 'pending')`,
    succeededTasks: sql<number>`count(*) filter (where ${schema.usageLogs.status} = 'succeeded')`,
    failedTasks: sql<number>`count(*) filter (where ${schema.usageLogs.status} = 'failed')`,
    todayTasks: sql<number>`count(*) filter (where ${schema.usageLogs.createdAt} >= ${today})`,
    todayCost: sql<string>`coalesce(sum(${schema.usageLogs.costYuan}::numeric) filter (where ${schema.usageLogs.createdAt} >= ${today}), 0)`,
  }).from(schema.usageLogs);

  const totalBalance = parseFloat(String(userStats?.totalBalance || '0'));
  const totalRecharge = parseFloat(String(rechargeStats?.totalRecharge || '0'));

  return c.json({
    users: {
      total: Number(userStats?.totalUsers || 0),
      active: Number(userStats?.activeUsers || 0),
      suspended: Number(userStats?.suspendedUsers || 0),
    },
    keys: {
      total: Number(keyStats?.totalKeys || 0),
      active: Number(keyStats?.activeKeys || 0),
    },
    finance: {
      totalBalance: totalBalance.toFixed(4),
      totalRecharge: totalRecharge.toFixed(4),
      totalConsumed: Math.max(totalRecharge - totalBalance, 0).toFixed(4),
    },
    tasks: {
      total: Number(taskStats?.totalTasks || 0),
      pending: Number(taskStats?.pendingTasks || 0),
      succeeded: Number(taskStats?.succeededTasks || 0),
      failed: Number(taskStats?.failedTasks || 0),
      today: Number(taskStats?.todayTasks || 0),
      todayCost: parseFloat(String(taskStats?.todayCost || '0')).toFixed(4),
    },
  });
});

// Admin: Per-provider consumption statistics.
// Aggregates usage_logs by provider. Always returns lifetime totals plus
// today's metrics; when ?startDate / ?endDate are provided, also returns
// per-provider totals within that range (rangeTasks / rangeCost).
adminRoutes.get('/stats/providers', async (c) => {
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const { rows, hasRange, range } = await fetchProviderStats(startDate, endDate);

  return c.json({
    range: hasRange ? range : null,
    providers: rows.map(r => ({
      provider: r.provider,
      totalTasks: Number(r.totalTasks || 0),
      succeeded: Number(r.succeeded || 0),
      failed: Number(r.failed || 0),
      pending: Number(r.pending || 0),
      cancelled: Number(r.cancelled || 0),
      expired: Number(r.expired || 0),
      totalTokens: Number(r.totalTokens || 0),
      totalCost: parseFloat(String(r.totalCost || '0')).toFixed(4),
      avgDurationMs: r.avgDurationMs != null ? Math.round(Number(r.avgDurationMs)) : null,
      todayTasks: Number(r.todayTasks || 0),
      todayCost: parseFloat(String(r.todayCost || '0')).toFixed(4),
      rangeTasks: hasRange ? Number(r.rangeTasks || 0) : null,
      rangeCost: hasRange ? parseFloat(String(r.rangeCost || '0')).toFixed(4) : null,
    })),
  });
});

// Admin: Export provider stats as CSV. Supports the same date-range filter.
adminRoutes.get('/stats/providers/export', async (c) => {
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  try {
    const { rows, hasRange } = await fetchProviderStats(startDate, endDate);

    const baseHeader = ['Provider', 'TotalTasks', 'Succeeded', 'Failed', 'Pending', 'Cancelled', 'Expired', 'TotalTokens', 'AvgDurationMs', 'TotalCost', 'TodayTasks', 'TodayCost'];
    if (hasRange) baseHeader.push('RangeTasks', 'RangeCost');
    const header = baseHeader.join(',');

    const rangeSuffix = hasRange ? `_${startDate || ''}_${endDate || ''}` : '';
    const csvRows = rows.map(r => {
      const cols: (string | number)[] = [
        r.provider || '',
        Number(r.totalTasks || 0),
        Number(r.succeeded || 0),
        Number(r.failed || 0),
        Number(r.pending || 0),
        Number(r.cancelled || 0),
        Number(r.expired || 0),
        Number(r.totalTokens || 0),
        r.avgDurationMs != null ? Math.round(Number(r.avgDurationMs)) : '',
        parseFloat(String(r.totalCost || '0')).toFixed(4),
        Number(r.todayTasks || 0),
        parseFloat(String(r.todayCost || '0')).toFixed(4),
      ];
      if (hasRange) {
        cols.push(Number(r.rangeTasks || 0), parseFloat(String(r.rangeCost || '0')).toFixed(4));
      }
      return cols.join(',');
    });
    const csv = '\uFEFF' + [header, ...csvRows].join('\n');

    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="provider_stats${rangeSuffix}_${new Date().toISOString().slice(0, 10)}.csv"`);
    return c.body(csv);
  } catch (error) {
    console.error('Provider stats export error:', error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

// Admin: Auto-mode fallback metrics. Counts how many auto-mode tasks fell back
// from Meitu to Evolink, broken down by reason and outcome — primary signal for
// validating the AUTO_FALLBACK_ERROR_CODE_PATTERN configuration.
adminRoutes.get('/stats/auto-fallback', async (c) => {
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');

  const conds = [eq(schema.usageLogs.autoMode, true)];
  if (startDate) conds.push(gte(schema.usageLogs.createdAt, new Date(startDate)));
  if (endDate) {
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    conds.push(lte(schema.usageLogs.createdAt, end));
  }
  const where = and(...conds);

  const [totals] = await db.select({
    autoTasks: sql<number>`count(*)`,
    fallbackTriggered: sql<number>`count(*) filter (where ${schema.usageLogs.fallbackFromProvider} is not null)`,
    fallbackSucceeded: sql<number>`count(*) filter (where ${schema.usageLogs.fallbackFromProvider} is not null and ${schema.usageLogs.status} = 'succeeded')`,
    fallbackFailed: sql<number>`count(*) filter (where ${schema.usageLogs.fallbackFromProvider} is not null and ${schema.usageLogs.status} = 'failed')`,
    fallbackPending: sql<number>`count(*) filter (where ${schema.usageLogs.fallbackFromProvider} is not null and ${schema.usageLogs.status} = 'pending')`,
  })
    .from(schema.usageLogs)
    .where(where);

  // Top reasons. NULL filtered out by the WHERE clause on fallbackReason.
  const reasonRows = await db.select({
    reason: schema.usageLogs.fallbackReason,
    count: sql<number>`count(*)`,
  })
    .from(schema.usageLogs)
    .where(and(where, sql`${schema.usageLogs.fallbackReason} is not null`))
    .groupBy(schema.usageLogs.fallbackReason)
    .orderBy(desc(sql`count(*)`))
    .limit(10);

  const autoTasks = Number(totals?.autoTasks || 0);
  const triggered = Number(totals?.fallbackTriggered || 0);

  return c.json({
    range: { startDate: startDate || null, endDate: endDate || null },
    autoTasks,
    fallbackTriggered: triggered,
    fallbackRate: autoTasks > 0 ? triggered / autoTasks : 0,
    fallbackSucceeded: Number(totals?.fallbackSucceeded || 0),
    fallbackFailed: Number(totals?.fallbackFailed || 0),
    fallbackPending: Number(totals?.fallbackPending || 0),
    reasons: reasonRows.map(r => ({ reason: r.reason || '', count: Number(r.count || 0) })),
  });
});

async function fetchProviderStats(startDate?: string, endDate?: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString();

  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;
  if (end) end.setHours(23, 59, 59, 999);
  const hasRange = !!(start || end);
  const startIso = start ? start.toISOString() : null;
  const endIso = end ? end.toISOString() : null;

  const rangeTasksExpr = hasRange
    ? sql<number>`count(*) filter (where ${schema.usageLogs.createdAt} >= ${startIso ?? '-infinity'}::timestamp and ${schema.usageLogs.createdAt} <= ${endIso ?? 'infinity'}::timestamp)`
    : sql<number>`0`;
  const rangeCostExpr = hasRange
    ? sql<string>`coalesce(sum(${schema.usageLogs.costYuan}::numeric) filter (where ${schema.usageLogs.createdAt} >= ${startIso ?? '-infinity'}::timestamp and ${schema.usageLogs.createdAt} <= ${endIso ?? 'infinity'}::timestamp), 0)`
    : sql<string>`'0'`;

  const rows = await db.select({
    provider: schema.usageLogs.provider,
    totalTasks: sql<number>`count(*)`,
    succeeded: sql<number>`count(*) filter (where ${schema.usageLogs.status} = 'succeeded')`,
    failed: sql<number>`count(*) filter (where ${schema.usageLogs.status} = 'failed')`,
    pending: sql<number>`count(*) filter (where ${schema.usageLogs.status} = 'pending')`,
    cancelled: sql<number>`count(*) filter (where ${schema.usageLogs.status} = 'cancelled')`,
    expired: sql<number>`count(*) filter (where ${schema.usageLogs.status} = 'expired')`,
    totalTokens: sql<number>`coalesce(sum(${schema.usageLogs.completionTokens}), 0)`,
    totalCost: sql<string>`coalesce(sum(${schema.usageLogs.costYuan}::numeric), 0)`,
    avgDurationMs: sql<number | null>`avg(${schema.usageLogs.taskDurationMs}) filter (where ${schema.usageLogs.status} = 'succeeded')`,
    todayTasks: sql<number>`count(*) filter (where ${schema.usageLogs.createdAt} >= ${todayIso}::timestamp)`,
    todayCost: sql<string>`coalesce(sum(${schema.usageLogs.costYuan}::numeric) filter (where ${schema.usageLogs.createdAt} >= ${todayIso}::timestamp), 0)`,
    rangeTasks: rangeTasksExpr,
    rangeCost: rangeCostExpr,
  })
    .from(schema.usageLogs)
    .groupBy(schema.usageLogs.provider)
    .orderBy(desc(sql`coalesce(sum(${schema.usageLogs.costYuan}::numeric), 0)`));

  return { rows, hasRange, range: { startDate: startDate || null, endDate: endDate || null } };
}

// Admin: Reset user password
adminRoutes.put('/users/:id/password', async (c) => {
  const userId = parseInt(c.req.param('id'));
  const { newPassword } = await c.req.json();

  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
    return c.json({ error: '密码长度不能少于 6 位' }, 400);
  }

  const targetUser = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (targetUser.length === 0) return c.json({ error: 'User not found' }, 404);

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, userId));
  return c.json({ success: true });
});

// Admin: Get all users
adminRoutes.get('/users', async (c) => {
  const usersList = await db.select({ 
    id: schema.users.id, 
    username: schema.users.username, 
    role: schema.users.role, 
    status: schema.users.status,
    concurrencyLimit: schema.users.concurrencyLimit, 
    balance: schema.users.balance, 
    provider: schema.users.provider,
    createdAt: schema.users.createdAt 
  }).from(schema.users);
  
  return c.json(usersList.map(u => ({
    ...u,
    activeConcurrency: concurrencyCache.get(u.id)?.active || 0,
  })));
});

// Admin: Toggle user status
adminRoutes.put('/users/:id/status', async (c) => {
  const userId = parseInt(c.req.param('id'));
  const targetUser = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (targetUser.length === 0 || !targetUser[0]) return c.json({ error: 'User not found' }, 404);
  
  const newStatus = targetUser[0].status === 'active' ? 'suspended' : 'active';
  await db.update(schema.users).set({ status: newStatus }).where(eq(schema.users.id, userId));
  
  // Clear key cache to apply suspension immediately
  clearKeyCache();
  
  return c.json({ success: true, status: newStatus });
});

// Admin: Update user concurrency limit
adminRoutes.put('/users/:id/concurrency', async (c) => {
  const userId = parseInt(c.req.param('id'));
  const { concurrencyLimit } = await c.req.json();
  if (typeof concurrencyLimit !== 'number' || concurrencyLimit < 1 || concurrencyLimit > 100) {
    return c.json({ error: '并发数必须在 1-100 之间' }, 400);
  }
  const targetUser = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (targetUser.length === 0) return c.json({ error: 'User not found' }, 404);
  
  await db.update(schema.users).set({ concurrencyLimit }).where(eq(schema.users.id, userId));
  
  const cc = concurrencyCache.get(userId);
  if (cc) { cc.limit = concurrencyLimit; }
  else { concurrencyCache.set(userId, { limit: concurrencyLimit, active: 0 }); }
  
  return c.json({ success: true });
});

// Admin: Update user provider
adminRoutes.put('/users/:id/provider', async (c) => {
  const userId = parseInt(c.req.param('id'));
  const { provider } = await c.req.json();
  if (!provider || !['meitu', 'evolink', 'ark', 'auto'].includes(provider)) {
    return c.json({ error: 'Provider 必须为 meitu / evolink / ark / auto' }, 400);
  }
  const targetUser = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (targetUser.length === 0) return c.json({ error: 'User not found' }, 404);
  
  await db.update(schema.users).set({ provider }).where(eq(schema.users.id, userId));
  return c.json({ success: true });
});

// Admin: Create user
adminRoutes.post('/users', async (c) => {
  const { username, password, role } = await c.req.json();
  if (!username || !password || typeof password !== 'string' || password.length < 6) {
    return c.json({ error: '密码长度不能少于 6 位' }, 400);
  }
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    await db.insert(schema.users).values({ username, passwordHash, role: role || 'tenant' });
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ error: 'Username may already exist' }, 400);
  }
});

// Admin: Add balance to user
adminRoutes.post('/users/:id/balance', async (c) => {
  const userId = parseInt(c.req.param('id'));
  const adminUser = c.get('user');
  const { amount, description } = await c.req.json();

  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount === 0) {
    return c.json({ error: '金额不能为 0' }, 400);
  }

  const targetUser = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (targetUser.length === 0) return c.json({ error: 'User not found' }, 404);

  // Phase 1 Optimization: DB Transaction
  await db.transaction(async (tx) => {
    // Insert audit record
    await tx.insert(schema.balanceAudit).values({
      userId,
      amount: numAmount.toFixed(4),
      description: description || (numAmount > 0 ? '管理员充值' : '管理员扣费'),
      operatorId: adminUser.id,
    });

    // Atomic balance update
    await tx.update(schema.users)
      .set({ balance: sql`${schema.users.balance} + ${numAmount}` })
      .where(eq(schema.users.id, userId));
  });

  // Read updated balance for response
  const updatedUser = await db.select({ balance: schema.users.balance }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return c.json({ success: true, balance: updatedUser[0]?.balance || '0' });
});

// Admin: Get All Usage
adminRoutes.get('/usage', async (c) => {
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
        keyName: schema.keys.name,
        apiKey: schema.keys.apiKey,
        endpoint: schema.usageLogs.endpoint,
        taskId: schema.usageLogs.taskId,
        completionTokens: schema.usageLogs.completionTokens,
        hasVideoInput: schema.usageLogs.hasVideoInput,
        costYuan: schema.usageLogs.costYuan,
        status: schema.usageLogs.status,
        provider: schema.usageLogs.provider,
        taskDurationMs: schema.usageLogs.taskDurationMs,
        createdAt: schema.usageLogs.createdAt,
      })
      .from(schema.usageLogs)
      .innerJoin(schema.users, eq(schema.usageLogs.userId, schema.users.id))
      .leftJoin(schema.keys, eq(schema.usageLogs.keyId, schema.keys.id))
      .orderBy(desc(schema.usageLogs.createdAt))
      .limit(pageSize)
      .offset(offset);

    const logsRaw = where ? await (query as any).where(where) : await query;
    const logs = logsRaw.map((l: any) => ({ ...l, keyName: l.keyName ? `${l.keyName} (...${l.apiKey?.slice(-4) || '??'})` : `Key#${l.keyId}` }));

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
adminRoutes.get('/usage/export', async (c) => {
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
        provider: schema.usageLogs.provider,
        taskDurationMs: schema.usageLogs.taskDurationMs,
        createdAt: schema.usageLogs.createdAt,
      })
      .from(schema.usageLogs)
      .innerJoin(schema.users, eq(schema.usageLogs.userId, schema.users.id))
      .orderBy(desc(schema.usageLogs.createdAt))
      .limit(50000);

    const logs = where ? await (query as any).where(where) : await query;

    const header = 'ID,Username,KeyID,Endpoint,TaskID,Tokens,InputType,UnitPrice,Cost(CNY),Status,Provider,DurationMs,CreatedAt';
    const rows = logs.map((u: any) =>
      [u.id, u.username, u.keyId, u.endpoint, u.taskId || '', u.completionTokens || 0,
       u.hasVideoInput ? '含视频' : '纯文本', u.hasVideoInput ? 28 : 46,
       u.costYuan, u.status, u.provider || '', u.taskDurationMs ?? '',
       new Date(u.createdAt).toISOString()].join(',')
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

// Admin: Get Request Logs
adminRoutes.get('/request-logs', async (c) => {
  const page = parseInt(c.req.query('page') || '1');
  const pageSize = parseInt(c.req.query('pageSize') || '50');
  const userIdFilter = c.req.query('userId');
  const endpointFilter = c.req.query('endpoint');
  const offset = (page - 1) * pageSize;

  try {
    const conditionList: any[] = [];
    if (userIdFilter) conditionList.push(eq(schema.requestLogs.userId, parseInt(userIdFilter)));
    if (endpointFilter) conditionList.push(like(schema.requestLogs.endpoint, `%${endpointFilter}%`));
    const conditions = conditionList.length > 0 ? and(...conditionList) : undefined;

    const countResult = conditions
      ? await db.select({ count: sql<number>`count(*)` }).from(schema.requestLogs).where(conditions)
      : await db.select({ count: sql<number>`count(*)` }).from(schema.requestLogs);
    const total = Number(countResult[0]?.count || 0);

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

// Admin: Get all keys
// Always excludes soft-deleted keys. By default also hides disabled keys;
// pass ?includeDisabled=true to show disabled keys in the listing.
adminRoutes.get('/keys', async (c) => {
  const includeDisabled = c.req.query('includeDisabled') === 'true';
  const conditions: any[] = [isNull(schema.keys.deletedAt)];
  if (!includeDisabled) conditions.push(eq(schema.keys.enabled, true));

  const allKeys = await db
    .select({
      id: schema.keys.id,
      userId: schema.keys.userId,
      username: schema.users.username,
      apiKey: schema.keys.apiKey,
      name: schema.keys.name,
      enabled: schema.keys.enabled,
      expiresAt: schema.keys.expiresAt,
      provider: schema.keys.provider,
      userProvider: schema.users.provider,
      returnCdnVideoUrl: schema.keys.returnCdnVideoUrl,
      createdAt: schema.keys.createdAt,
    })
    .from(schema.keys)
    .innerJoin(schema.users, eq(schema.keys.userId, schema.users.id))
    .where(and(...conditions));
  return c.json(allKeys);
});

// Admin: Create key for user
adminRoutes.post('/keys', async (c) => {
  const { userId, name, expiresAt, provider, returnCdnVideoUrl } = await c.req.json();
  if (!userId || !name) return c.json({ error: 'userId and name are required' }, 400);
  if (provider != null && provider !== '' && !['meitu', 'evolink', 'ark', 'auto'].includes(provider)) {
    return c.json({ error: 'Provider 必须为 meitu / evolink / ark / auto' }, 400);
  }

  const targetUser = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (targetUser.length === 0) return c.json({ error: 'User not found' }, 404);

  const { v4: uuidv4 } = await import('uuid');
  const apiKey = `sk-${uuidv4().replace(/-/g, '')}`;
  await db.insert(schema.keys).values({
    userId,
    apiKey,
    name,
    ...(expiresAt ? { expiresAt: new Date(expiresAt) } : {}),
    ...(provider ? { provider } : {}),
    ...(typeof returnCdnVideoUrl === 'boolean' ? { returnCdnVideoUrl } : {}),
  });
  return c.json({ success: true, apiKey });
});

// Admin: Update key video_url return mode (true → our CDN /v URL, false → upstream raw URL)
adminRoutes.put('/keys/:id/return-cdn', async (c) => {
  const keyId = parseInt(c.req.param('id'));
  const { returnCdnVideoUrl } = await c.req.json();
  if (typeof returnCdnVideoUrl !== 'boolean') {
    return c.json({ error: 'returnCdnVideoUrl 必须为布尔值' }, 400);
  }

  const keyRecord = await db.select().from(schema.keys).where(eq(schema.keys.id, keyId)).limit(1);
  if (keyRecord.length === 0) return c.json({ error: 'Key not found' }, 404);

  await db.update(schema.keys).set({ returnCdnVideoUrl }).where(eq(schema.keys.id, keyId));
  clearKeyCache();
  return c.json({ success: true });
});

// Admin: Update key provider (null/empty → inherit user-level provider)
adminRoutes.put('/keys/:id/provider', async (c) => {
  const keyId = parseInt(c.req.param('id'));
  const { provider } = await c.req.json();
  const next = provider == null || provider === '' ? null : provider;
  if (next !== null && !['meitu', 'evolink', 'ark', 'auto'].includes(next)) {
    return c.json({ error: 'Provider 必须为 meitu / evolink / ark / auto' }, 400);
  }

  const keyRecord = await db.select().from(schema.keys).where(eq(schema.keys.id, keyId)).limit(1);
  if (keyRecord.length === 0) return c.json({ error: 'Key not found' }, 404);

  await db.update(schema.keys).set({ provider: next }).where(eq(schema.keys.id, keyId));
  clearKeyCache();
  return c.json({ success: true });
});

// Admin: Toggle key
adminRoutes.put('/keys/:id/toggle', async (c) => {
  const keyId = parseInt(c.req.param('id'));
  const keyRecord = await db.select().from(schema.keys).where(eq(schema.keys.id, keyId)).limit(1);
  if (keyRecord.length === 0) return c.json({ error: 'Key not found' }, 404);

  const newEnabled = !keyRecord[0]!.enabled;
  await db.update(schema.keys).set({ enabled: newEnabled }).where(eq(schema.keys.id, keyId));
  return c.json({ success: true, enabled: newEnabled });
});

// ── Asset Management (admin panel) ──────────────────────────────

import { config } from '../config.js';

const assetAdminProxy = async (upstreamPath: string, body: any) => {
  return fetch(`${config.UPSTREAM_URL}${upstreamPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.MEITU_API_KEY}`
    },
    body: JSON.stringify(body)
  });
};

// Admin: Create Asset (submit for review)
adminRoutes.post('/assets/create', async (c) => {
  const body = await c.req.json();
  try {
    const res = await assetAdminProxy('/api/v1/open/CreateAsset', body);
    const data = await res.json();
    return c.json(data, res.status as any);
  } catch (error) {
    console.error('Admin CreateAsset error:', error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

// Admin: Get Asset status
adminRoutes.post('/assets/get', async (c) => {
  const body = await c.req.json();
  try {
    const res = await assetAdminProxy('/api/v1/open/GetAsset', body);
    const data = await res.json();
    return c.json(data, res.status as any);
  } catch (error) {
    console.error('Admin GetAsset error:', error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

// Admin: List uploaded assets
adminRoutes.post('/assets/list', async (c) => {
  const body = await c.req.json();
  try {
    const res = await assetAdminProxy('/api/v1/open/ListAssets', body);
    const data = await res.json();
    return c.json(data, res.status as any);
  } catch (error) {
    console.error('Admin ListAssets error:', error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

// Admin: List public media asset groups
adminRoutes.post('/assets/public', async (c) => {
  const body = await c.req.json();
  try {
    const res = await assetAdminProxy('/api/v1/open/ListMediaAssetGroup', body);
    const data = await res.json();
    return c.json(data, res.status as any);
  } catch (error) {
    console.error('Admin ListMediaAssetGroup error:', error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});
