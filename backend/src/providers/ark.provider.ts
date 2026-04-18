// Ark upstream provider — extracted from existing proxy.routes.ts logic

import { config } from '../config.js';
import type { UpstreamProvider, CreateTaskResult, QueryTaskResult } from './types.js';

class ArkProvider implements UpstreamProvider {
  name = 'ark' as const;

  async createTask(body: any): Promise<CreateTaskResult> {
    // Model mapping: user-facing name → Ark endpoint ID
    const userModel = body.model;
    const mappedModel = config.MODEL_MAPPING[userModel];
    if (!mappedModel) {
      return {
        taskId: '',
        rawResponse: {
          error: `Unsupported model: "${userModel}". Supported models: ${Object.keys(config.MODEL_MAPPING).join(', ')}`
        },
        statusCode: 400,
      };
    }

    const upstreamBody = { ...body, model: mappedModel };

    const upstreamRes = await fetch(`${config.UPSTREAM_URL}/api/v1/doubao/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.ARK_API_KEY}`,
      },
      body: JSON.stringify(upstreamBody),
    });

    const data: any = await upstreamRes.json();
    return {
      taskId: data.id || '',
      rawResponse: data,
      statusCode: upstreamRes.status,
    };
  }

  async queryTask(taskId: string): Promise<QueryTaskResult> {
    const upstreamRes = await fetch(`${config.UPSTREAM_URL}/api/v1/doubao/get_result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.ARK_API_KEY}`,
      },
      body: JSON.stringify({ id: taskId }),
    });

    const data: any = await upstreamRes.json();

    return {
      status: data.status || 'pending',
      rawResponse: data,
      statusCode: upstreamRes.status,
      completionTokens: data.usage?.completion_tokens || 0,
    };
  }
}

export const arkProvider = new ArkProvider();
