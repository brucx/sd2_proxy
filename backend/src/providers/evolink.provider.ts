// Evolink upstream provider — Ark-format request ↔ Evolink API format translation.

import { config } from '../config.js';
import type { UpstreamProvider, CreateTaskResult, QueryTaskResult, CancelTaskResult } from './types.js';
import { normalizeToArkResponse, normalizeStatus, toLifecycleStatus, arkErrorResponse } from '../utils/arkFormat.util.js';

/**
 * Infer Evolink model mode (text/image/reference) from request body content.
 */
function inferMode(body: any): 'text-to-video' | 'image-to-video' | 'reference-to-video' {
  const contents = body.content || [];

  const hasImage = contents.some((c: any) => c.type === 'image_url')
    || (Array.isArray(body.image_urls) && body.image_urls.length > 0);

  const hasVideo = contents.some((c: any) => c.type === 'video_url' || c.type === 'video')
    || (Array.isArray(body.video_urls) && body.video_urls.length > 0);

  const hasAudio = contents.some((c: any) => c.type === 'audio_url' || c.type === 'audio')
    || (Array.isArray(body.audio_urls) && body.audio_urls.length > 0);

  if (hasVideo || hasAudio) return 'reference-to-video';
  if (hasImage) return 'image-to-video';
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
function preNormalizeEvolink(data: any): any {
  if (!data || typeof data !== 'object') return data;
  const out: any = { ...data };
  if (Array.isArray(data.results) && data.results.length > 0) {
    out.content = { video_url: data.results[0], ...(data.content || {}) };
  }
  if (data.quality && out.resolution === undefined) out.resolution = data.quality;
  if (data.aspect_ratio && out.ratio === undefined) out.ratio = data.aspect_ratio;
  if (data.task_info?.video_duration != null && out.duration == null) {
    out.duration = data.task_info.video_duration;
  }
  // Evolink uses `created` (unix seconds); align with Ark's `created_at`.
  if (out.created_at == null && typeof data.created === 'number') {
    out.created_at = data.created;
  }
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
    const arkResponse = normalizeToArkResponse(preNormalizeEvolink(data), {
      id: upstreamTaskId,
      model: userModel,
    });

    const reserved = data.usage?.credits_reserved;
    return {
      upstreamTaskId,
      arkResponse,
      statusCode: upstreamRes.status,
      ...(typeof reserved === 'number' ? { credits: reserved } : {}),
    };
  }

  async queryTask(upstreamTaskId: string, userModel?: string): Promise<QueryTaskResult> {
    const upstreamRes = await fetch(`${config.EVOLINK_URL}/v1/tasks/${upstreamTaskId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${config.EVOLINK_API_KEY}` },
    });

    const data: any = await upstreamRes.json();
    const arkResponse = normalizeToArkResponse(preNormalizeEvolink(data), {
      id: upstreamTaskId,
      model: userModel,
    });

    return {
      status: toLifecycleStatus(normalizeStatus(data.status)),
      arkResponse,
      statusCode: upstreamRes.status,
      duration: data.task_info?.video_duration,
    };
  }

  async cancelTask(upstreamTaskId: string): Promise<CancelTaskResult> {
    // Evolink exposes no public cancel endpoint in their v1 spec — mark locally.
    return { statusCode: 200, body: { id: upstreamTaskId, note: 'local-cancel-only' } };
  }
}

export const evolinkProvider = new EvolinkProvider();
