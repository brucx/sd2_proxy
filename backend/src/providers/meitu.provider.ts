// Meitu upstream provider.
// Meitu proxies the Ark (Volcengine) API, so its response is already close to
// the Ark shape. We strip provider-specific noise and rewrite model/id.

import { config } from '../config.js';
import type { UpstreamProvider, CreateTaskResult, QueryTaskResult, CancelTaskResult } from './types.js';
import { normalizeToArkResponse, normalizeStatus, toLifecycleStatus, arkErrorResponse } from '../utils/arkFormat.util.js';

class MeituProvider implements UpstreamProvider {
  name = 'meitu' as const;

  async createTask(body: any, userModel: string): Promise<CreateTaskResult> {
    const mappedModel = config.MODEL_MAPPING[userModel];
    if (!mappedModel) {
      return {
        upstreamTaskId: '',
        arkResponse: {
          id: '',
          status: 'failed',
          ...arkErrorResponse(
            'unsupported_model',
            `Unsupported model: "${userModel}". Supported: ${Object.keys(config.MODEL_MAPPING).join(', ')}`,
          ),
        } as any,
        statusCode: 400,
      };
    }

    const upstreamBody = { ...body, model: mappedModel };
    const upstreamRes = await fetch(`${config.UPSTREAM_URL}/api/v1/doubao/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.MEITU_API_KEY}`,
      },
      body: JSON.stringify(upstreamBody),
    });

    const data: any = await upstreamRes.json();
    const upstreamTaskId = data.id || '';

    // Meitu's create only returns {id}; synthesize a minimal Ark response.
    const arkResponse = normalizeToArkResponse(
      { ...data, status: data.status ?? 'queued' },
      { id: upstreamTaskId, model: userModel },
    );

    return {
      upstreamTaskId,
      arkResponse,
      statusCode: upstreamRes.status,
      upstreamRaw: data,
    };
  }

  async queryTask(upstreamTaskId: string, userModel?: string): Promise<QueryTaskResult> {
    const upstreamRes = await fetch(`${config.UPSTREAM_URL}/api/v1/doubao/get_result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.MEITU_API_KEY}`,
      },
      body: JSON.stringify({ id: upstreamTaskId }),
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
      upstreamRaw: data,
    };
  }

  async cancelTask(upstreamTaskId: string): Promise<CancelTaskResult> {
    // Meitu upstream does not expose a cancel endpoint. The route layer will
    // still flip our local status to 'cancelled' so the task stops consuming
    // concurrency — but the upstream job continues until it finishes on its own.
    return { statusCode: 200, body: { id: upstreamTaskId, note: 'local-cancel-only' } };
  }
}

export const meituProvider = new MeituProvider();
