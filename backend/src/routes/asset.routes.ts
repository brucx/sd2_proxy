import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { proxyAuthMiddleware } from '../middlewares/proxy.middleware.js';
import {
  createMaterial,
  getMaterialForToken,
  listMaterialsForToken,
  serializeForClient,
  ASSET_TYPES,
  type AssetType,
} from '../services/material.service.js';
import { logger } from '../utils/logger.util.js';
import type { AppVariables } from '../types.js';

export const assetRoutes = new Hono<{ Variables: AppVariables }>();

// Volcengine-style envelope. RequestId mirrors the upstream pattern (yyyymmddHHMMSS + 20 hex).
function wrap(action: string, result: Record<string, any>): Record<string, any> {
  const d = new Date();
  const stamp =
    d.getUTCFullYear().toString() +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    String(d.getUTCDate()).padStart(2, '0') +
    String(d.getUTCHours()).padStart(2, '0') +
    String(d.getUTCMinutes()).padStart(2, '0') +
    String(d.getUTCSeconds()).padStart(2, '0');
  const tail = randomBytes(10).toString('hex').toUpperCase();
  return {
    ResponseMetadata: {
      RequestId: `${stamp}${tail}`,
      Action: action,
      Version: '2024-01-01',
      Service: 'ark',
      Region: 'cn-beijing',
    },
    Result: result,
  };
}

function wrapError(action: string, code: string, message: string): Record<string, any> {
  const env = wrap(action, {});
  env.ResponseMetadata.Error = { Code: code, Message: message };
  return env;
}

// Resolve the provider to use for client-facing status aggregation. null key
// provider falls back to user default. We cache neither — this is one small
// lookup per asset request.
async function providerForKey(keyRecord: any): Promise<string> {
  if (keyRecord.provider) return keyRecord.provider;
  const [u] = await db.select({ provider: schema.users.provider })
    .from(schema.users).where(eq(schema.users.id, keyRecord.userId)).limit(1);
  return u?.provider || 'meitu';
}

// Small helper to log request/response for audit (mirrors previous behavior).
function logRequest(keyRecord: any, endpoint: string, method: string, req: string, res: string, status: number, durationMs: number, ip: string) {
  db.insert(schema.requestLogs).values({
    userId: keyRecord.userId,
    keyId: keyRecord.id,
    endpoint,
    method,
    requestBody: req,
    responseBody: res,
    responseStatus: status,
    durationMs,
    ipAddress: ip,
  }).catch(err => logger.error({ err }, `Asset route log error (${endpoint})`));
}

// -------- CreateAsset --------

assetRoutes.post('/CreateAsset', proxyAuthMiddleware, async (c) => {
  const keyRecord = c.get('keyRecord');
  const start = Date.now();
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';

  let body: any;
  try { body = await c.req.json(); }
  catch { return c.json(wrapError('CreateAsset', 'InvalidParameter', 'malformed JSON body'), 400); }

  const reqStr = JSON.stringify(body);
  const url: string = body?.URL || body?.url;
  const name: string = body?.Name || body?.name || '';
  const assetType: string = body?.AssetType || body?.assetType;

  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    const payload = wrapError('CreateAsset', 'InvalidParameter.URL', 'URL must be a public http(s) URL');
    logRequest(keyRecord, '/open/CreateAsset', 'POST', reqStr, JSON.stringify(payload), 400, Date.now() - start, ip);
    return c.json(payload, 400);
  }
  if (!ASSET_TYPES.includes(assetType as AssetType)) {
    const payload = wrapError('CreateAsset', 'InvalidParameter.AssetType', `AssetType must be one of ${ASSET_TYPES.join(', ')}`);
    logRequest(keyRecord, '/open/CreateAsset', 'POST', reqStr, JSON.stringify(payload), 400, Date.now() - start, ip);
    return c.json(payload, 400);
  }

  try {
    const material = await createMaterial(keyRecord, {
      url,
      name,
      assetType: assetType as AssetType,
    });
    const payload = wrap('CreateAsset', { Id: material.id });
    logRequest(keyRecord, '/open/CreateAsset', 'POST', reqStr, JSON.stringify(payload), 200, Date.now() - start, ip);
    return c.json(payload);
  } catch (err: any) {
    logger.error({ err, keyId: keyRecord.id }, '[CreateAsset] unexpected error');
    const payload = wrapError('CreateAsset', 'InternalError', err?.message || 'Internal Server Error');
    logRequest(keyRecord, '/open/CreateAsset', 'POST', reqStr, JSON.stringify(payload), 500, Date.now() - start, ip);
    return c.json(payload, 500);
  }
});

// -------- GetAsset --------

assetRoutes.post('/GetAsset', proxyAuthMiddleware, async (c) => {
  const keyRecord = c.get('keyRecord');
  const start = Date.now();
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';

  let body: any;
  try { body = await c.req.json(); }
  catch { return c.json(wrapError('GetAsset', 'InvalidParameter', 'malformed JSON body'), 400); }

  const reqStr = JSON.stringify(body);
  const id: string = body?.Id || body?.id;
  if (!id) {
    const payload = wrapError('GetAsset', 'InvalidParameter.Id', 'Id is required');
    logRequest(keyRecord, '/open/GetAsset', 'POST', reqStr, JSON.stringify(payload), 400, Date.now() - start, ip);
    return c.json(payload, 400);
  }

  const entry = await getMaterialForToken(keyRecord, id);
  if (!entry) {
    // 404-equivalent — match Meitu shape (empty Result + Error in metadata).
    const payload = wrapError('GetAsset', 'AssetNotFound', `asset ${id} not found`);
    logRequest(keyRecord, '/open/GetAsset', 'POST', reqStr, JSON.stringify(payload), 404, Date.now() - start, ip);
    return c.json(payload, 404);
  }

  const provider = await providerForKey(keyRecord);
  const result = await serializeForClient(entry, provider);
  const payload = wrap('GetAsset', result);
  logRequest(keyRecord, '/open/GetAsset', 'POST', reqStr, JSON.stringify(payload), 200, Date.now() - start, ip);
  return c.json(payload);
});

// -------- ListAssets --------

assetRoutes.post('/ListAssets', proxyAuthMiddleware, async (c) => {
  const keyRecord = c.get('keyRecord');
  const start = Date.now();
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';

  let body: any;
  try { body = await c.req.json(); }
  catch { return c.json(wrapError('ListAssets', 'InvalidParameter', 'malformed JSON body'), 400); }

  const reqStr = JSON.stringify(body);
  const filter = body?.Filter || {};
  const provider = await providerForKey(keyRecord);

  const { items, totalCount } = await listMaterialsForToken(keyRecord, {
    groupType: filter?.GroupType,
    statuses: Array.isArray(filter?.Statuses) ? filter.Statuses : undefined,
    name: filter?.Name,
    pageNumber: Number(body?.PageNumber) || 1,
    pageSize: Number(body?.PageSize) || 20,
    sortBy: body?.SortBy,
    sortOrder: body?.SortOrder,
  });
  const serialized = await Promise.all(items.map(entry => serializeForClient(entry, provider)));

  const payload = wrap('ListAssets', {
    Items: serialized,
    TotalCount: totalCount,
    PageNumber: Number(body?.PageNumber) || 1,
    PageSize: Math.min(Math.max(Number(body?.PageSize) || 20, 1), 100),
  });
  logRequest(keyRecord, '/open/ListAssets', 'POST', reqStr, '<omitted>', 200, Date.now() - start, ip);
  return c.json(payload);
});

// -------- ListMediaAssetGroup (public virtual-human library) --------
// Keep proxying to upstream: this is a shared, public catalog, not per-token
// data, so there's no isolation concern and we don't want to reimplement the
// discovery/search index here.
assetRoutes.post('/ListMediaAssetGroup', proxyAuthMiddleware, async (c) => {
  const keyRecord = c.get('keyRecord');
  const start = Date.now();
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
  const reqStr = await c.req.text();
  try {
    const upstreamRes = await fetch(`${config.UPSTREAM_URL}/api/v1/open/ListMediaAssetGroup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.MEITU_API_KEY}`,
      },
      body: reqStr,
    });
    const data: any = await upstreamRes.json();
    const resStr = JSON.stringify(data);
    logRequest(keyRecord, '/open/ListMediaAssetGroup', 'POST', reqStr, resStr, upstreamRes.status, Date.now() - start, ip);
    c.status(upstreamRes.status as any);
    return c.json(data);
  } catch (err: any) {
    logger.error({ err }, '[ListMediaAssetGroup] proxy error');
    const payload = wrapError('ListMediaAssetGroup', 'InternalError', err?.message || 'Internal Server Error');
    logRequest(keyRecord, '/open/ListMediaAssetGroup', 'POST', reqStr, JSON.stringify(payload), 500, Date.now() - start, ip);
    return c.json(payload, 500);
  }
});
