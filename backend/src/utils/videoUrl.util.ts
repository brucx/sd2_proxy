import { config } from '../config.js';
import type { ArkTaskResponse } from './arkFormat.util.js';

// Build the outward-facing /v URL for a task. Returns undefined when
// PUBLIC_BASE_URL is unset so the caller can decide to pass through upstream.
export function buildPublicVideoUrl(taskId: string): string | undefined {
  if (!config.PUBLIC_BASE_URL) return undefined;
  return `${config.PUBLIC_BASE_URL}/v/${taskId}.mp4`;
}

// Mutate an Ark-shape response so content.video_url points at our /v endpoint
// instead of the raw upstream signed URL. No-op when the task isn't succeeded,
// when there's no video_url, or when PUBLIC_BASE_URL is unset.
// Pass returnCdnUrl=false to opt out (leave the upstream signed URL as-is).
// last_frame_url is left alone — those are separate assets not served by /v.
export function rewriteArkVideoUrl(
  response: ArkTaskResponse,
  returnCdnUrl: boolean = true,
): ArkTaskResponse {
  if (!returnCdnUrl) return response;
  if (!config.PUBLIC_BASE_URL) return response;
  if (response.status !== 'succeeded') return response;
  if (!response.content?.video_url) return response;
  const rewritten = buildPublicVideoUrl(response.id);
  if (!rewritten) return response;
  response.content = { ...response.content, video_url: rewritten };
  return response;
}

// Compute the expiration timestamp for the upstream signed URL.
// ark/meitu: upstream_finished_at + 23h55m (ARK_VIDEO_URL_TTL_MS)
// evolink:   null (permanent URL from files.evolink.ai)
export function computeVideoExpiresAt(
  provider: string,
  upstreamFinishedAt: Date | null | undefined,
): Date | null {
  if (provider === 'evolink') return null;
  const anchor = upstreamFinishedAt ?? new Date();
  return new Date(anchor.getTime() + config.ARK_VIDEO_URL_TTL_MS);
}
