import { Hono } from 'hono';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { proxyAuthMiddleware } from '../middlewares/proxy.middleware.js';
import type { AppVariables } from '../types.js';

export const playgroundRoutes = new Hono<{ Variables: AppVariables }>();

// GET /api/v1/playground/history
// Authenticated with the same Bearer API key the Playground already holds.
// Returns usage rows scoped to *this key* (not the whole user) so switching
// keys in the UI gives a clean per-key reconciliation view.
// `costDisplay` = stored upstream cost × PLAYGROUND_MARKUP_RATIO, rounded to
// 4 decimals. The raw upstream `costYuan` is intentionally NOT returned.
//
// Query params:
//   page       1-based, default 1
//   pageSize   default 20, max 1000 (the large cap is there so the export path
//              can pull the full filtered window in one request)
//   startDate  inclusive ISO date, filters on createdAt
//   endDate    inclusive ISO date (expanded to 23:59:59.999 of that day)
playgroundRoutes.get('/history', proxyAuthMiddleware, async (c) => {
  const keyRecord = c.get('keyRecord');
  const page = Math.max(parseInt(c.req.query('page') || '1'), 1);
  const pageSize = Math.min(Math.max(parseInt(c.req.query('pageSize') || '20'), 1), 1000);
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const offset = (page - 1) * pageSize;

  const conditions: any[] = [eq(schema.usageLogs.keyId, keyRecord.id)];
  if (startDate) {
    const d = new Date(startDate);
    if (!isNaN(d.getTime())) conditions.push(gte(schema.usageLogs.createdAt, d));
  }
  if (endDate) {
    const d = new Date(endDate);
    if (!isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.usageLogs.createdAt, d));
    }
  }
  const where = and(...conditions);

  const [countResult, rows] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(schema.usageLogs).where(where),
    db.select({
      id: schema.usageLogs.id,
      taskId: schema.usageLogs.taskId,
      endpoint: schema.usageLogs.endpoint,
      status: schema.usageLogs.status,
      costYuan: schema.usageLogs.costYuan,
      videoDuration: schema.usageLogs.videoDuration,
      videoQuality: schema.usageLogs.videoQuality,
      hasVideoInput: schema.usageLogs.hasVideoInput,
      taskDurationMs: schema.usageLogs.taskDurationMs,
      createdAt: schema.usageLogs.createdAt,
      updatedAt: schema.usageLogs.updatedAt,
    })
      .from(schema.usageLogs)
      .where(where)
      .orderBy(desc(schema.usageLogs.createdAt))
      .limit(pageSize)
      .offset(offset),
  ]);

  const markup = config.PLAYGROUND_MARKUP_RATIO;
  const items = rows.map(r => {
    const upstream = parseFloat(r.costYuan || '0') || 0;
    const display = upstream * markup;
    return {
      id: r.id,
      taskId: r.taskId,
      endpoint: r.endpoint,
      status: r.status,
      videoDuration: r.videoDuration,
      videoQuality: r.videoQuality,
      hasVideoInput: r.hasVideoInput,
      taskDurationMs: r.taskDurationMs,
      costDisplay: display.toFixed(4),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });

  return c.json({
    items,
    total: Number(countResult[0]?.count || 0),
    page,
    pageSize,
    currency: 'CNY',
  });
});
