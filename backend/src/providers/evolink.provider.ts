// Evolink upstream provider — Ark-format request ↔ Evolink API format translation.

import { config } from '../config.js';
import type { UpstreamProvider, CreateTaskResult, QueryTaskResult, CancelTaskResult } from './types.js';
import { normalizeToArkResponse, normalizeStatus, toLifecycleStatus, arkErrorResponse } from '../utils/arkFormat.util.js';

/**
 * Infer Evolink model mode (text/image/reference) from request body content.
 */
function inferMode(body: any): 'text-to-video' | 'image-to-video' | 'reference-to-video' {
  const contents = body.content || [];

  const hasVideo = contents.some((c: any) => c.type === 'video_url' || c.type === 'video')
    || (Array.isArray(body.video_urls) && body.video_urls.length > 0);

  const hasAudio = contents.some((c: any) => c.type === 'audio_url' || c.type === 'audio')
    || (Array.isArray(body.audio_urls) && body.audio_urls.length > 0);

  if (hasVideo || hasAudio) return 'reference-to-video';

  let hasImage = false;
  let hasReferenceRole = false;

  for (const c of contents) {
    if (c.type === 'image_url') {
      hasImage = true;
      const role = c.role || c.image_url?.role;
      if (role === 'reference_image') {
        hasReferenceRole = true;
      }
    }
  }

  if (Array.isArray(body.image_urls) && body.image_urls.length > 0) {
    hasImage = true;
  }

  if (hasImage) {
    if (hasReferenceRole) return 'reference-to-video';
    return 'image-to-video';
  }

  return 'text-to-video';
}

/** Convert Ark-style request body → Evolink request body. */
function translateCreateBody(body: any, evolinkModel: string): any {
  const contents = body.content || [];

  const textParts = contents
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text);
  const prompt = textParts.join('\n') || body.prompt || '';

  const imageUrls: string[] = [];
  for (const c of contents) {
    if (c.type === 'image_url' && c.image_url?.url) imageUrls.push(c.image_url.url);
  }
  if (Array.isArray(body.image_urls)) imageUrls.push(...body.image_urls);

  const videoUrls: string[] = [];
  for (const c of contents) {
    if ((c.type === 'video_url' || c.type === 'video') && (c.video_url?.url || c.url)) {
      videoUrls.push(c.video_url?.url || c.url);
    }
  }
  if (Array.isArray(body.video_urls)) videoUrls.push(...body.video_urls);

  const evolinkBody: any = { model: evolinkModel, prompt };

  const audioUrls: string[] = [];
  for (const c of contents) {
    if ((c.type === 'audio_url' || c.type === 'audio') && (c.audio_url?.url || c.url)) {
      audioUrls.push(c.audio_url?.url || c.url);
    }
  }
  if (Array.isArray(body.audio_urls)) audioUrls.push(...body.audio_urls);

  if (imageUrls.length > 0) evolinkBody.image_urls = imageUrls;
  if (videoUrls.length > 0) evolinkBody.video_urls = videoUrls;
  if (audioUrls.length > 0) evolinkBody.audio_urls = audioUrls;

  if (body.duration !== undefined && body.duration !== null) evolinkBody.duration = body.duration;

  if (body.ratio) evolinkBody.aspect_ratio = body.ratio;
  else if (body.aspect_ratio) evolinkBody.aspect_ratio = body.aspect_ratio;

  // Ark uses `resolution`, Evolink uses `quality` — map with 720p default.
  evolinkBody.quality = body.resolution || body.quality || '720p';

  if (body.generate_audio !== undefined) evolinkBody.generate_audio = body.generate_audio;

  if (body.model_params?.web_search !== undefined) {
    evolinkBody.model_params = { web_search: body.model_params.web_search };
  }

  return evolinkBody;
}

// Shape Evolink task payload close enough to Ark that the generic normalizer
// can finish the job. Evolink uses `results[]`, `quality`, `aspect_ratio`.
// `requestBody` (the original create-time request) lets us back-fill Ark
// echo fields (resolution/ratio/duration/generate_audio/...) that Evolink
// doesn't return — required for client compatibility with the Ark response.
function preNormalizeEvolink(data: any, requestBody?: any): any {
  if (!data || typeof data !== 'object') return data;
  const out: any = { ...data };
  // Evolink's top-level `duration` actually carries upstream execution seconds
  // (despite the name — upstream bug, observed empirically on completed tasks).
  // Strip it from the spread so it can't pollute Ark's `duration`, which means
  // output video length and gets back-filled from the request below.
  const evolinkExecSec: number | undefined =
    typeof data.duration === 'number'
      ? data.duration
      : (typeof data.task_info?.video_duration === 'number'
          ? data.task_info.video_duration
          : undefined);
  delete out.duration;
  if (Array.isArray(data.results) && data.results.length > 0) {
    out.content = { video_url: data.results[0], ...(data.content || {}) };
  }
  if (data.quality && out.resolution === undefined) out.resolution = data.quality;
  if (data.aspect_ratio && out.ratio === undefined) out.ratio = data.aspect_ratio;
  // Evolink uses `created` (unix seconds); align with Ark's `created_at`.
  if (out.created_at == null && typeof data.created === 'number') {
    out.created_at = data.created;
  }
  // Evolink doesn't return an end timestamp — synthesize `updated_at` from
  // created_at + execution seconds so the route layer's timing bookkeeping
  // (upstream_started_at / upstream_finished_at / task_duration_ms) works
  // uniformly across providers.
  if (
    out.updated_at == null
    && typeof out.created_at === 'number'
    && typeof evolinkExecSec === 'number'
  ) {
    out.updated_at = out.created_at + evolinkExecSec;
  }

  // Ark-compatibility back-fill. Evolink omits these from its task responses,
  // so synthesize them from the original request + Ark defaults
  // (see docs/ark/get.md, docs/ark/create.md). Lets clients written against
  // the Ark response shape consume Evolink results unchanged.
  const req = requestBody && typeof requestBody === 'object' ? requestBody : {};
  if (out.resolution === undefined) {
    out.resolution = req.resolution || req.quality || '720p';
  }
  if (out.ratio === undefined) {
    out.ratio = req.ratio || req.aspect_ratio || '16:9';
  }
  if (out.duration === undefined) {
    out.duration = typeof req.duration === 'number' ? req.duration : 5;
  }
  if (out.framespersecond === undefined) out.framespersecond = 24;
  if (out.generate_audio === undefined) {
    out.generate_audio = typeof req.generate_audio === 'boolean' ? req.generate_audio : true;
  }
  if (out.service_tier === undefined) {
    out.service_tier = data.usage?.user_group || req.service_tier || 'default';
  }
  if (out.execution_expires_after === undefined) {
    out.execution_expires_after = typeof req.execution_expires_after === 'number'
      ? req.execution_expires_after
      : 172800;
  }

  // Ensure usage exists with Ark-shape token fields. Real values are filled in
  // by the route layer for terminal evolink tasks (synthetic tokens reverse-
  // mapped from credit-based cost — see proxy.routes.ts).
  const upstreamUsage = data.usage && typeof data.usage === 'object' ? data.usage : {};
  const ct = typeof upstreamUsage.completion_tokens === 'number' ? upstreamUsage.completion_tokens : 0;
  const tt = typeof upstreamUsage.total_tokens === 'number' ? upstreamUsage.total_tokens : ct;
  out.usage = {
    completion_tokens: ct,
    total_tokens: tt,
    ...(upstreamUsage.tool_usage ? { tool_usage: upstreamUsage.tool_usage } : {}),
  };

  return out;
}

class EvolinkProvider implements UpstreamProvider {
  name = 'evolink' as const;

  async createTask(body: any, userModel: string): Promise<CreateTaskResult> {
    const modelBase = config.EVOLINK_MODEL_BASE[userModel];
    if (!modelBase) {
      return {
        upstreamTaskId: '',
        arkResponse: {
          id: '',
          status: 'failed',
          ...arkErrorResponse(
            'unsupported_model',
            `Unsupported model for Evolink: "${userModel}". Supported: ${Object.keys(config.EVOLINK_MODEL_BASE).join(', ')}`,
          ),
        } as any,
        statusCode: 400,
      };
    }

    const mode = inferMode(body);
    const evolinkModel = `${modelBase}-${mode}`;
    const evolinkBody = translateCreateBody(body, evolinkModel);

    const upstreamRes = await fetch(`${config.EVOLINK_URL}/v1/videos/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.EVOLINK_API_KEY}`,
      },
      body: JSON.stringify(evolinkBody),
    });

    const data: any = await upstreamRes.json();
    const upstreamTaskId = data.id || '';
    const arkResponse = normalizeToArkResponse(preNormalizeEvolink(data, body), {
      id: upstreamTaskId,
      model: userModel,
    });

    const reserved = data.usage?.credits_reserved;
    return {
      upstreamTaskId,
      arkResponse,
      statusCode: upstreamRes.status,
      ...(typeof reserved === 'number' ? { credits: reserved } : {}),
      upstreamRaw: data,
    };
  }

  async queryTask(upstreamTaskId: string, userModel?: string, requestBody?: any): Promise<QueryTaskResult> {
    const upstreamRes = await fetch(`${config.EVOLINK_URL}/v1/tasks/${upstreamTaskId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${config.EVOLINK_API_KEY}` },
    });

    const data: any = await upstreamRes.json();
    const arkResponse = normalizeToArkResponse(preNormalizeEvolink(data, requestBody), {
      id: upstreamTaskId,
      model: userModel,
    });

    return {
      status: toLifecycleStatus(normalizeStatus(data.status)),
      arkResponse,
      statusCode: upstreamRes.status,
      upstreamRaw: data,
    };
  }

  async cancelTask(upstreamTaskId: string): Promise<CancelTaskResult> {
    // Evolink exposes no public cancel endpoint in their v1 spec — mark locally.
    return { statusCode: 200, body: { id: upstreamTaskId, note: 'local-cancel-only' } };
  }
}

export const evolinkProvider = new EvolinkProvider();
