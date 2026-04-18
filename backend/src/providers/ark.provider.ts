// Ark (Volcengine) upstream provider.
// Endpoints are already in the unified target format; we just pass through the
// body, rewrite the model to the activated endpoint/model ID, and hand the
// response to the generic normalizer.

import { config } from '../config.js';
import type { UpstreamProvider, CreateTaskResult, QueryTaskResult, CancelTaskResult } from './types.js';
import { normalizeToArkResponse, normalizeStatus, toLifecycleStatus, arkErrorResponse } from '../utils/arkFormat.util.js';

const ARK_BASE = '/api/v3/contents/generations/tasks';

class ArkProvider implements UpstreamProvider {
  name = 'ark' as const;

  async createTask(body: any, userModel: string): Promise<CreateTaskResult> {
    const mapped = config.ARK_MODEL_MAPPING[userModel] ?? userModel;
    const upstreamBody = { ...body, model: mapped };

    const upstreamRes = await fetch(`${config.ARK_URL}${ARK_BASE}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.ARK_API_KEY}`,
      },
      body: JSON.stringify(upstreamBody),
    });

    const data: any = await upstreamRes.json();

    // Ark create returns either {id} or {error:{...}}.
    if (!upstreamRes.ok || !data?.id) {
      const err = data?.error;
      return {
        upstreamTaskId: '',
        arkResponse: {
          id: '',
          status: 'failed',
          ...arkErrorResponse(err?.code || 'upstream_error', err?.message || 'Ark upstream error'),
        } as any,
        statusCode: upstreamRes.status || 500,
      };
    }

    const arkResponse = normalizeToArkResponse(
      { ...data, status: data.status ?? 'queued' },
      { id: data.id, model: userModel },
    );

    return { upstreamTaskId: data.id, arkResponse, statusCode: upstreamRes.status, upstreamRaw: data };
  }

  async queryTask(upstreamTaskId: string, userModel?: string): Promise<QueryTaskResult> {
    const upstreamRes = await fetch(`${config.ARK_URL}${ARK_BASE}/${upstreamTaskId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${config.ARK_API_KEY}` },
    });

    const data: any = await upstreamRes.json();
    const arkResponse = normalizeToArkResponse(data, {
      id: upstreamTaskId,
      model: userModel,
    });

    return {
      status: toLifecycleStatus(normalizeStatus(data.status)),
      arkResponse,
      statusCode: upstreamRes.status,
      completionTokens: data.usage?.completion_tokens || 0,
      quality: data.resolution,
      upstreamRaw: data,
    };
  }

  async cancelTask(upstreamTaskId: string): Promise<CancelTaskResult> {
    const upstreamRes = await fetch(`${config.ARK_URL}${ARK_BASE}/${upstreamTaskId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${config.ARK_API_KEY}` },
    });

    // Ark's DELETE returns no body on success (per docs/ark/cancel.md).
    let body: any = null;
    try { body = await upstreamRes.json(); } catch { /* empty body is expected */ }
    return { statusCode: upstreamRes.status, body };
  }
}

export const arkProvider = new ArkProvider();
