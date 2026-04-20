// Aivideoapi.ai upstream provider — Ark-shape request/response ↔ aivideoapi.ai
// `/v1/videos/generations` + `/v1/tasks/{id}` contract.
//
// aivideoapi wraps Seedance 2.0 behind a REST API that takes a nested `input`
// object on create and returns `{code,msg,data:{taskId}}`. Task polling returns
// `{id,status,model,output:{urls,last_frame_url,metadata}}` with statuses
// pending|processing|completed|failed. See docs/aivideo/aivideo.md.

import { config } from '../config.js';
import type { UpstreamProvider, CreateTaskResult, QueryTaskResult, CancelTaskResult } from './types.js';
import { normalizeToArkResponse, normalizeStatus, toLifecycleStatus, arkErrorResponse } from '../utils/arkFormat.util.js';

// Pull text / image / video / audio parts out of an Ark-shape body and return
// them in a form aivideoapi's `input` object accepts. The same request body
// can carry inputs either inline on `content[]` (Ark style) or flat on
// `image_urls` / `video_urls` / `audio_urls` arrays — we accept both and
// concatenate, matching the evolink provider's tolerance.
function translateCreateBody(body: any, aivideoModel: string): any {
  const contents: any[] = Array.isArray(body.content) ? body.content : [];

  const textParts = contents
    .filter((c: any) => c?.type === 'text')
    .map((c: any) => c.text);
  const prompt = textParts.join('\n') || body.prompt || '';

  const imageUrls: string[] = [];
  for (const c of contents) {
    if (c?.type === 'image_url' && c.image_url?.url) imageUrls.push(c.image_url.url);
  }
  if (Array.isArray(body.image_urls)) {
    for (const v of body.image_urls) {
      if (typeof v === 'string') imageUrls.push(v);
      else if (v && typeof v === 'object' && typeof v.url === 'string') imageUrls.push(v.url);
    }
  }

  const videoUrls: string[] = [];
  for (const c of contents) {
    if ((c?.type === 'video_url' || c?.type === 'video') && (c.video_url?.url || c.url)) {
      videoUrls.push(c.video_url?.url || c.url);
    }
  }
  if (Array.isArray(body.video_urls)) {
    for (const v of body.video_urls) if (typeof v === 'string') videoUrls.push(v);
  }

  const audioUrls: string[] = [];
  for (const c of contents) {
    if ((c?.type === 'audio_url' || c?.type === 'audio') && (c.audio_url?.url || c.url)) {
      audioUrls.push(c.audio_url?.url || c.url);
    }
  }
  if (Array.isArray(body.audio_urls)) {
    for (const v of body.audio_urls) if (typeof v === 'string') audioUrls.push(v);
  }

  const input: any = { prompt };
  if (imageUrls.length > 0) input.image_urls = imageUrls.map((url) => ({ url }));
  if (videoUrls.length > 0) input.video_urls = videoUrls;
  if (audioUrls.length > 0) input.audio_urls = audioUrls;

  if (typeof body.duration === 'number') input.duration = body.duration;
  const ratio = body.ratio || body.aspect_ratio;
  if (ratio) input.aspect_ratio = ratio;
  input.resolution = body.resolution || body.quality || '720p';
  if (typeof body.generate_audio === 'boolean') input.generate_audio = body.generate_audio;
  if (typeof body.watermark === 'boolean') input.watermark = body.watermark;
  if (typeof body.seed === 'number') input.seed = body.seed;
  if (typeof body.return_last_frame === 'boolean') input.return_last_frame = body.return_last_frame;
  if (typeof body.generation_type === 'string') input.generation_type = body.generation_type;

  const webSearch = body.model_params?.web_search ?? body.web_search;
  if (typeof webSearch === 'boolean') input.web_search = webSearch;

  const out: any = { model: aivideoModel, input };
  if (typeof body.callback_url === 'string') out.callback_url = body.callback_url;
  return out;
}

// Shape aivideoapi task payload so the generic ark normalizer can finish the
// translation. aivideoapi exposes outputs under `output.urls[0]` /
// `output.last_frame_url` and echoes parameters under `output.metadata`.
// `requestBody` (original create-time body) backs Ark echo fields that
// aivideoapi omits pre-completion so clients see a uniform response shape.
function preNormalizeAivideo(data: any, requestBody?: any): any {
  if (!data || typeof data !== 'object') return data;
  const out: any = { ...data };

  const output = data.output && typeof data.output === 'object' ? data.output : null;
  const metadata = output?.metadata && typeof output.metadata === 'object' ? output.metadata : {};

  const videoUrl = Array.isArray(output?.urls) ? output.urls[0] : undefined;
  const lastFrameUrl = output?.last_frame_url;
  if (videoUrl || lastFrameUrl) {
    out.content = {
      ...(videoUrl ? { video_url: videoUrl } : {}),
      ...(lastFrameUrl ? { last_frame_url: lastFrameUrl } : {}),
    };
  }

  // aivideoapi uses `completed_at` for the terminal timestamp; Ark uses
  // `updated_at`. Preserve `created_at` verbatim (both are unix seconds).
  if (out.updated_at == null && typeof data.completed_at === 'number') {
    out.updated_at = data.completed_at;
  }

  // Hoist metadata.* onto the top level so normalizeToArkResponse can pick
  // them up. Only set when not already present so an explicit top-level value
  // wins (defensive against future upstream reshapes).
  for (const k of ['seed', 'ratio', 'duration', 'resolution', 'generate_audio', 'framespersecond'] as const) {
    if (out[k] === undefined && metadata[k] !== undefined) out[k] = metadata[k];
  }

  // Ark-compatibility back-fill from the original request for pre-completion
  // polls (metadata only appears in `completed` payloads).
  const req = requestBody && typeof requestBody === 'object' ? requestBody : {};
  if (out.resolution === undefined) out.resolution = req.resolution || req.quality || '720p';
  if (out.ratio === undefined) out.ratio = req.ratio || req.aspect_ratio || '16:9';
  if (out.duration === undefined) {
    out.duration = typeof req.duration === 'number' ? req.duration : 5;
  }
  if (out.framespersecond === undefined) out.framespersecond = 24;
  if (out.generate_audio === undefined) {
    out.generate_audio = typeof req.generate_audio === 'boolean' ? req.generate_audio : true;
  }

  // Ensure a usage object exists so the route layer's terminal reverse-map
  // (cost → Ark-equivalent tokens) has somewhere to land.
  const upstreamUsage = data.usage && typeof data.usage === 'object' ? data.usage : {};
  const ct = typeof upstreamUsage.completion_tokens === 'number' ? upstreamUsage.completion_tokens : 0;
  const tt = typeof upstreamUsage.total_tokens === 'number' ? upstreamUsage.total_tokens : ct;
  out.usage = { completion_tokens: ct, total_tokens: tt };

  return out;
}

class AivideoProvider implements UpstreamProvider {
  name = 'aivideo' as const;

  async createTask(body: any, userModel: string): Promise<CreateTaskResult> {
    const mapped = config.AIVIDEO_MODEL_MAPPING[userModel];
    if (!mapped) {
      return {
        upstreamTaskId: '',
        arkResponse: {
          id: '',
          status: 'failed',
          ...arkErrorResponse(
            'unsupported_model',
            `Unsupported model for Aivideo: "${userModel}". Supported: ${Object.keys(config.AIVIDEO_MODEL_MAPPING).join(', ')}`,
          ),
        } as any,
        statusCode: 400,
      };
    }

    const upstreamBody = translateCreateBody(body, mapped);

    const upstreamRes = await fetch(`${config.AIVIDEO_URL}/v1/videos/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.AIVIDEO_API_KEY}`,
      },
      body: JSON.stringify(upstreamBody),
    });

    const data: any = await upstreamRes.json();

    // aivideoapi returns either {code:200, msg:"success", data:{taskId}} on
    // success or {error:{code,message,type}} on failure. Treat missing taskId
    // as a failure even if HTTP status is 2xx (defensive).
    const taskId: string | undefined = data?.data?.taskId;
    if (!upstreamRes.ok || !taskId) {
      const err = data?.error;
      return {
        upstreamTaskId: '',
        arkResponse: {
          id: '',
          status: 'failed',
          ...arkErrorResponse(err?.code || 'upstream_error', err?.message || data?.msg || 'Aivideo upstream error'),
        } as any,
        statusCode: upstreamRes.status || 500,
        upstreamRaw: data,
      };
    }

    // Create returns only the taskId; synthesize a minimal Ark-shape response.
    const arkResponse = normalizeToArkResponse(
      preNormalizeAivideo({ id: taskId, status: 'queued' }, body),
      { id: taskId, model: userModel },
    );

    return { upstreamTaskId: taskId, arkResponse, statusCode: upstreamRes.status, upstreamRaw: data };
  }

  async queryTask(upstreamTaskId: string, userModel?: string, requestBody?: any): Promise<QueryTaskResult> {
    const upstreamRes = await fetch(`${config.AIVIDEO_URL}/v1/tasks/${upstreamTaskId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${config.AIVIDEO_API_KEY}` },
    });

    const data: any = await upstreamRes.json();
    const arkResponse = normalizeToArkResponse(preNormalizeAivideo(data, requestBody), {
      id: upstreamTaskId,
      model: userModel,
    });

    const duration =
      typeof data?.output?.metadata?.duration === 'number'
        ? data.output.metadata.duration
        : undefined;

    return {
      status: toLifecycleStatus(normalizeStatus(data?.status)),
      arkResponse,
      statusCode: upstreamRes.status,
      ...(duration !== undefined ? { duration } : {}),
      quality: data?.output?.metadata?.resolution,
      upstreamRaw: data,
    };
  }

  async cancelTask(upstreamTaskId: string): Promise<CancelTaskResult> {
    // aivideoapi exposes no public cancel endpoint; flip status locally so the
    // task stops consuming concurrency. The upstream job runs to completion.
    return { statusCode: 200, body: { id: upstreamTaskId, note: 'local-cancel-only' } };
  }
}

export const aivideoProvider = new AivideoProvider();
