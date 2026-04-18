// Evolink upstream provider — V3 (Ark format) ↔ Evolink API format translation

import { config } from '../config.js';
import type { UpstreamProvider, CreateTaskResult, QueryTaskResult } from './types.js';

/**
 * Infer Evolink model mode (text/image/reference) from request body content.
 *
 * V3 body uses `content[]` with type markers:
 *   - type=text          → text content
 *   - type=image_url     → image material
 *   - type=video_url     → video material
 *   - type=video         → same as video_url (alternate format)
 *
 * Also checks top-level `image_urls`, `video_urls`, `audio_urls` if present.
 */
function inferMode(body: any): 'text-to-video' | 'image-to-video' | 'reference-to-video' {
  const contents = body.content || [];

  const hasImage = contents.some((c: any) => c.type === 'image_url')
    || (Array.isArray(body.image_urls) && body.image_urls.length > 0);

  const hasVideo = contents.some((c: any) => c.type === 'video_url' || c.type === 'video')
    || (Array.isArray(body.video_urls) && body.video_urls.length > 0);

  const hasAudio = Array.isArray(body.audio_urls) && body.audio_urls.length > 0;

  // reference-to-video: has video or audio material
  if (hasVideo || hasAudio) return 'reference-to-video';
  // image-to-video: has image material
  if (hasImage) return 'image-to-video';
  // text-to-video: only text
  return 'text-to-video';
}

/**
 * Convert V3 (Ark-style) request body → Evolink request body.
 */
function translateCreateBody(body: any, evolinkModel: string): any {
  const contents = body.content || [];

  // Extract text prompt from content array
  const textParts = contents
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text);
  const prompt = textParts.join('\n') || body.prompt || '';

  // Extract image URLs from content array
  const imageUrls: string[] = [];
  for (const c of contents) {
    if (c.type === 'image_url' && c.image_url?.url) {
      imageUrls.push(c.image_url.url);
    }
  }
  // Also accept top-level image_urls
  if (Array.isArray(body.image_urls)) {
    imageUrls.push(...body.image_urls);
  }

  // Extract video URLs from content array
  const videoUrls: string[] = [];
  for (const c of contents) {
    if ((c.type === 'video_url' || c.type === 'video') && (c.video_url?.url || c.url)) {
      videoUrls.push(c.video_url?.url || c.url);
    }
  }
  if (Array.isArray(body.video_urls)) {
    videoUrls.push(...body.video_urls);
  }

  // Build Evolink request
  const evolinkBody: any = {
    model: evolinkModel,
    prompt,
  };

  if (imageUrls.length > 0) evolinkBody.image_urls = imageUrls;
  if (videoUrls.length > 0) evolinkBody.video_urls = videoUrls;
  if (Array.isArray(body.audio_urls) && body.audio_urls.length > 0) {
    evolinkBody.audio_urls = body.audio_urls;
  }

  // Duration: V3 uses same field name
  if (body.duration !== undefined && body.duration !== null) {
    evolinkBody.duration = body.duration;
  }

  // Aspect ratio: V3 uses 'ratio', Evolink uses 'aspect_ratio'
  if (body.ratio) {
    evolinkBody.aspect_ratio = body.ratio;
  } else if (body.aspect_ratio) {
    evolinkBody.aspect_ratio = body.aspect_ratio;
  }

  // Quality (resolution): pass through if set, default 720p
  evolinkBody.quality = body.quality || '720p';

  // Audio generation
  if (body.generate_audio !== undefined) {
    evolinkBody.generate_audio = body.generate_audio;
  }

  // Web search (text-to-video only)
  if (body.model_params?.web_search !== undefined) {
    evolinkBody.model_params = { web_search: body.model_params.web_search };
  }

  return evolinkBody;
}

/**
 * Translate Evolink query task response → V3 (Ark-style) response format.
 */
function translateQueryResponse(data: any): any {
  // Map Evolink status to V3 status
  const statusMap: Record<string, string> = {
    'completed': 'succeeded',
    'failed': 'failed',
    'pending': 'pending',
    'processing': 'processing',
  };

  const translated: any = {
    id: data.id,
    status: statusMap[data.status] || data.status,
    model: data.model,
    created: data.created,
    object: data.object,
    type: data.type,
  };

  // Progress
  if (data.progress !== undefined) {
    translated.progress = data.progress;
  }

  // Task info
  if (data.task_info) {
    translated.task_info = data.task_info;
  }

  // Error info
  if (data.error) {
    translated.error = data.error;
  }

  // Results → output.video_url (V3 format)
  if (data.results && Array.isArray(data.results) && data.results.length > 0) {
    translated.output = { video_url: data.results[0] };
    // Keep full results array too
    translated.results = data.results;
  }

  // Usage — Evolink uses credits, but downstream expects completion_tokens field
  if (data.usage) {
    translated.usage = {
      completion_tokens: 0, // Evolink doesn't use tokens
      ...data.usage,
    };
  }

  return translated;
}


class EvolinkProvider implements UpstreamProvider {
  name = 'evolink' as const;

  async createTask(body: any): Promise<CreateTaskResult> {
    const userModel = body.model;
    const modelBase = config.EVOLINK_MODEL_BASE[userModel];
    if (!modelBase) {
      return {
        taskId: '',
        rawResponse: {
          error: `Unsupported model for Evolink: "${userModel}". Supported models: ${Object.keys(config.EVOLINK_MODEL_BASE).join(', ')}`
        },
        statusCode: 400,
      };
    }

    // Determine mode from request body content
    const mode = inferMode(body);
    const evolinkModel = `${modelBase}-${mode}`;

    // Translate V3 body → Evolink body
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

    // Translate response back to V3 format
    const translated: any = {
      id: data.id || '',
      status: data.status === 'completed' ? 'succeeded' : (data.status || 'pending'),
      model: userModel, // Return the original user model name
      created: data.created,
      object: data.object,
      type: data.type,
    };

    if (data.progress !== undefined) translated.progress = data.progress;
    if (data.task_info) translated.task_info = data.task_info;
    if (data.usage) translated.usage = { completion_tokens: 0, ...data.usage };
    if (data.error) translated.error = data.error;

    // credits_reserved is the authoritative billing value and only appears in
    // the create response — the /v1/tasks/{id} query endpoint never returns usage.
    const reserved = data.usage?.credits_reserved;

    return {
      taskId: data.id || '',
      rawResponse: translated,
      statusCode: upstreamRes.status,
      ...(typeof reserved === 'number' ? { credits: reserved } : {}),
    };
  }

  async queryTask(taskId: string): Promise<QueryTaskResult> {
    const upstreamRes = await fetch(`${config.EVOLINK_URL}/v1/tasks/${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.EVOLINK_API_KEY}`,
      },
    });

    const data: any = await upstreamRes.json();
    const translated = translateQueryResponse(data);

    const statusMap: Record<string, 'pending' | 'processing' | 'succeeded' | 'failed'> = {
      'completed': 'succeeded',
      'failed': 'failed',
      'pending': 'pending',
      'processing': 'processing',
    };

    return {
      status: statusMap[data.status] || 'pending',
      rawResponse: translated,
      statusCode: upstreamRes.status,
      // Only populated on the (rare) pending-state query; completed tasks strip task_info down to can_cancel.
      duration: data.task_info?.video_duration,
    };
  }
}

export const evolinkProvider = new EvolinkProvider();
