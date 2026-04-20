import { config } from '../config.js';
import { getPresignedUrl, isS3Enabled } from './s3.util.js';
import { logger } from './logger.util.js';
import type { ArkTaskResponse } from './arkFormat.util.js';

export type VideoUrlMode = 'cdn' | 'upstream' | 's3';

// Coerce the DB value (may be null/legacy/garbage) into a safe enum value.
export function normalizeVideoUrlMode(raw: string | null | undefined): VideoUrlMode {
  return raw === 'upstream' || raw === 's3' ? raw : 'cdn';
}

// Build the outward-facing /v URL for a task. Returns undefined when
// PUBLIC_BASE_URL is unset so the caller can decide to pass through upstream.
export function buildPublicVideoUrl(taskId: string): string | undefined {
  if (!config.PUBLIC_BASE_URL) return undefined;
  return `${config.PUBLIC_BASE_URL}/v/${taskId}.mp4`;
}

// Resolve what video_url should be exposed to the client for this task.
// Returns `undefined` when the caller should leave the upstream URL as-is
// (either mode='upstream', or s3 wasn't ready so we fall back to upstream).
//
// s3 fallback: if S3 isn't enabled, the object isn't uploaded yet, or the
// presign itself fails, fall back to the upstream raw URL (return undefined)
// so the response still carries a usable link.
export async function resolveVideoUrl(
  mode: VideoUrlMode,
  ctx: { taskId: string; s3Key?: string | null; s3UploadStatus?: string | null },
): Promise<string | undefined> {
  if (mode === 'upstream') return undefined;

  if (mode === 's3') {
    if (isS3Enabled() && ctx.s3UploadStatus === 'done' && ctx.s3Key) {
      try {
        return await getPresignedUrl(ctx.s3Key);
      } catch (err) {
        logger.error({ err, taskId: ctx.taskId }, '[videoUrl] s3 presign failed, falling back to upstream');
      }
    }
    // s3 not ready → leave upstream URL in place
    return undefined;
  }

  // mode === 'cdn'
  return buildPublicVideoUrl(ctx.taskId);
}

// Mutate an Ark-shape response so content.video_url is replaced with the
// pre-resolved URL from `resolveVideoUrl`. No-op when the task isn't
// succeeded, when there's no video_url to replace, or when the caller passed
// `undefined` (signal to leave the upstream URL in place).
// last_frame_url is left alone — those are separate assets not served by /v.
export function rewriteArkVideoUrl(
  response: ArkTaskResponse,
  replacementUrl: string | undefined,
): ArkTaskResponse {
  if (!replacementUrl) return response;
  if (response.status !== 'succeeded') return response;
  if (!response.content?.video_url) return response;
  response.content = { ...response.content, video_url: replacementUrl };
  return response;
}

// Compute the expiration timestamp for the upstream signed URL.
// ark / meitu / aivideo: upstream_finished_at + 23h55m (ARK_VIDEO_URL_TTL_MS)
// evolink:               null (permanent URL from files.evolink.ai)
export function computeVideoExpiresAt(
  provider: string,
  upstreamFinishedAt: Date | null | undefined,
): Date | null {
  if (provider === 'evolink') return null;
  const anchor = upstreamFinishedAt ?? new Date();
  return new Date(anchor.getTime() + config.ARK_VIDEO_URL_TTL_MS);
}
