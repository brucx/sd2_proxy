import { Hono } from 'hono';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { config } from '../config.js';
import { proxyAuthMiddleware } from '../middlewares/proxy.middleware.js';
import type { AppVariables } from '../types.js';

export const assetRoutes = new Hono<{ Variables: AppVariables }>();

/**
 * Generic asset API proxy handler.
 * Forwards requests to the upstream /api/v1/open/* endpoints.
 * No billing — only request logging.
 */
const createAssetProxyHandler = (upstreamPath: string, endpointLabel: string) => {
  return async (c: any) => {
    const keyRecord = c.get('keyRecord');
    const body = await c.req.json();
    const startTime = Date.now();
    const clientIp = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
    const requestBodyStr = JSON.stringify(body);

    try {
      const upstreamRes = await fetch(`${config.UPSTREAM_URL}${upstreamPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.ARK_API_KEY}`
        },
        body: requestBodyStr
      });

      const data: any = await upstreamRes.json();
      const durationMs = Date.now() - startTime;
      const responseBody = JSON.stringify(data);

      // Log the request (no billing for asset APIs)
      db.insert(schema.requestLogs).values({
        userId: keyRecord.userId,
        keyId: keyRecord.id,
        endpoint: endpointLabel,
        method: 'POST',
        requestBody: requestBodyStr,
        responseBody,
        responseStatus: upstreamRes.status,
        durationMs,
        ipAddress: clientIp,
      }).catch(err => console.error(`Asset proxy request log error (${endpointLabel}):`, err));

      c.status(upstreamRes.status as any);
      return c.json(data);
    } catch (error) {
      console.error(`Asset Proxy Error (${endpointLabel}):`, error);
      const durationMs = Date.now() - startTime;
      db.insert(schema.requestLogs).values({
        userId: keyRecord.userId,
        keyId: keyRecord.id,
        endpoint: endpointLabel,
        method: 'POST',
        requestBody: requestBodyStr,
        responseBody: JSON.stringify({ error: 'Internal Server Error' }),
        responseStatus: 500,
        durationMs,
        ipAddress: clientIp,
      }).catch(err => console.error(`Asset proxy request log error (${endpointLabel}):`, err));
      return c.json({ error: 'Internal Server Error' }, 500);
    }
  };
};

// CreateAsset - 创建真人素材
assetRoutes.post('/CreateAsset', proxyAuthMiddleware,
  createAssetProxyHandler('/api/v1/open/CreateAsset', '/open/CreateAsset'));

// GetAsset - 查询真人素材
assetRoutes.post('/GetAsset', proxyAuthMiddleware,
  createAssetProxyHandler('/api/v1/open/GetAsset', '/open/GetAsset'));

// ListAssets - 查询已上传的素材
assetRoutes.post('/ListAssets', proxyAuthMiddleware,
  createAssetProxyHandler('/api/v1/open/ListAssets', '/open/ListAssets'));

// ListMediaAssetGroup - 查询公共素材
assetRoutes.post('/ListMediaAssetGroup', proxyAuthMiddleware,
  createAssetProxyHandler('/api/v1/open/ListMediaAssetGroup', '/open/ListMediaAssetGroup'));
