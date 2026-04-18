// Unified Ark-format response shape. All providers normalize their upstream
// response into this structure so downstream clients see a single API contract.
// Reference: docs/ark/create.md, docs/ark/get.md

export type ArkStatus = 'queued' | 'running' | 'cancelled' | 'succeeded' | 'failed' | 'expired';

export interface ArkError {
  code: string;
  message: string;
}

export interface ArkTaskResponse {
  id: string;
  model?: string;
  status: ArkStatus;
  error: ArkError | null;
  created_at?: number;
  updated_at?: number;
  content?: { video_url?: string; last_frame_url?: string } | null;
  seed?: number | null;
  resolution?: string | null;
  ratio?: string | null;
  duration?: number | null;
  frames?: number | null;
  framespersecond?: number | null;
  generate_audio?: boolean | null;
  service_tier?: string | null;
  execution_expires_after?: number | null;
  usage?: {
    completion_tokens?: number;
    total_tokens?: number;
    tool_usage?: { web_search?: number };
    rate_cny_per_million?: number; // Ark CNY-per-million-token rate for this task spec (non-standard field, see docs/ark/pricing.md).
  } | null;
}

// Map arbitrary upstream status strings → Ark status enum.
// Accepts both Ark-native values and the legacy Meitu/Evolink variants.
export function normalizeStatus(raw: unknown): ArkStatus {
  const s = typeof raw === 'string' ? raw.toLowerCase() : '';
  switch (s) {
    case 'queued':
    case 'pending':
      return 'queued';
    case 'running':
    case 'processing':
    case 'in_progress':
      return 'running';
    case 'succeeded':
    case 'completed':
    case 'success':
      return 'succeeded';
    case 'failed':
    case 'error':
      return 'failed';
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    case 'expired':
    case 'timeout':
      return 'expired';
    default:
      return 'queued';
  }
}

// Collapses Ark status → the lifecycle-level status we persist in usage_logs.
// 'pending' means the task is still being worked on upstream; terminal statuses
// are stored verbatim so billing/concurrency bookkeeping can finalize.
export function toLifecycleStatus(
  s: ArkStatus,
): 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'expired' {
  if (s === 'queued' || s === 'running') return 'pending';
  return s;
}

// Strip provider-specific noise ({_request_id, fileformat, ...}) and coerce
// into the Ark shape. `overrides` lets callers inject our own task id / the
// user-facing model name before the translated data arrives.
export function normalizeToArkResponse(
  upstream: any,
  overrides: { id: string; model?: string | undefined },
): ArkTaskResponse {
  const d = upstream ?? {};
  const status = normalizeStatus(d.status);

  const out: ArkTaskResponse = {
    id: overrides.id,
    model: overrides.model ?? d.model,
    status,
    error: d.error && typeof d.error === 'object' ? {
      code: d.error.code ?? '',
      message: d.error.message ?? '',
    } : null,
  };

  if (d.created_at != null) out.created_at = d.created_at;
  if (d.updated_at != null) out.updated_at = d.updated_at;

  // content: unified under {video_url, last_frame_url}. Different providers
  // expose the video URL in different places:
  //   - Ark: content.video_url
  //   - Meitu: content.video_url (passthrough of Ark upstream)
  //   - Evolink (already translated by its provider): output.video_url / results[0]
  const videoUrl =
    d.content?.video_url ??
    d.output?.video_url ??
    (Array.isArray(d.results) ? d.results[0] : undefined);
  const lastFrame = d.content?.last_frame_url;
  if (videoUrl || lastFrame) {
    out.content = {};
    if (videoUrl) out.content.video_url = videoUrl;
    if (lastFrame) out.content.last_frame_url = lastFrame;
  } else if (d.content === null) {
    out.content = null;
  }

  if (d.seed !== undefined) out.seed = d.seed;
  if (d.resolution !== undefined) out.resolution = d.resolution;
  if (d.ratio !== undefined) out.ratio = d.ratio;
  if (d.duration !== undefined) out.duration = d.duration;
  if (d.frames !== undefined) out.frames = d.frames;
  if (d.framespersecond !== undefined) out.framespersecond = d.framespersecond;
  if (d.generate_audio !== undefined) out.generate_audio = d.generate_audio;
  if (d.service_tier !== undefined) out.service_tier = d.service_tier;
  if (d.execution_expires_after !== undefined) out.execution_expires_after = d.execution_expires_after;

  if (d.usage && typeof d.usage === 'object') {
    const ct = typeof d.usage.completion_tokens === 'number' ? d.usage.completion_tokens : 0;
    const tt = typeof d.usage.total_tokens === 'number' ? d.usage.total_tokens : ct;
    out.usage = { completion_tokens: ct, total_tokens: tt };
    if (d.usage.tool_usage) out.usage.tool_usage = d.usage.tool_usage;
  }

  return out;
}

// Build an Ark-format error envelope (used when rejecting requests before the
// upstream call — e.g. unsupported model).
export function arkErrorResponse(code: string, message: string): { error: ArkError & { type: string } } {
  return { error: { code, message, type: 'invalid_request_error' as any } };
}
