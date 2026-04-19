import { Hono } from 'hono';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { getPresignedUrl, isS3Enabled } from '../utils/s3.util.js';
import { maybeKickoffUpload } from '../services/videoOffload.service.js';
import { logger } from '../utils/logger.util.js';

export const videoRoutes = new Hono();

// GET /v/:filename  (filename = {task_id}.mp4)
//
// Resolution order:
//   1. S3 has the object → 302 to fresh presigned URL (24h)
//   2. Upstream signed URL still valid → 302 to upstream + retry-kick S3 upload
//   3. Otherwise → 410 Gone
//
// 404 for both unknown task and not-yet-succeeded tasks so we don't leak
// existence; 410 specifically signals "had it, lost it" for clients that
// want to differentiate "expired" from "never had this".
videoRoutes.get('/:filename', async (c) => {
  const filename = c.req.param('filename');
  if (!filename.endsWith('.mp4')) {
    return c.json({ error: 'not_found' }, 404);
  }
  const taskId = filename.slice(0, -'.mp4'.length);
  if (!taskId) return c.json({ error: 'not_found' }, 404);

  const rows = await db.select({
    id: schema.usageLogs.id,
    taskId: schema.usageLogs.taskId,
    provider: schema.usageLogs.provider,
    status: schema.usageLogs.status,
    upstreamVideoUrl: schema.usageLogs.upstreamVideoUrl,
    upstreamVideoExpiresAt: schema.usageLogs.upstreamVideoExpiresAt,
    upstreamFinishedAt: schema.usageLogs.upstreamFinishedAt,
    s3Key: schema.usageLogs.s3Key,
    s3UploadStatus: schema.usageLogs.s3UploadStatus,
  }).from(schema.usageLogs)
    .where(eq(schema.usageLogs.taskId, taskId))
    .limit(1);

  const row = rows[0];
  if (!row || row.status !== 'succeeded') {
    return c.json({ error: 'not_found', message: 'Video not available.' }, 404);
  }

  // Path 1: S3 hit. Issue a fresh presigned URL each time so even if a client
  // caches the 302 response, the presign expiry is anchored to the latest
  // request. No upstream call, no DB write.
  if (isS3Enabled() && row.s3UploadStatus === 'done' && row.s3Key) {
    try {
      const url = await getPresignedUrl(row.s3Key);
      c.header('Cache-Control', 'private, max-age=60');
      return c.redirect(url, 302);
    } catch (err) {
      logger.error({ err, taskId }, '[v] presign failed, will try upstream fallback');
      // Fall through to upstream attempt rather than 5xx.
    }
  }

  // Path 2: Upstream still valid → serve it now and (if S3 enabled) try to
  // backfill so the next request can take Path 1.
  const hasUpstream = !!row.upstreamVideoUrl;
  const upstreamLive = hasUpstream && (
    !row.upstreamVideoExpiresAt || Date.now() < row.upstreamVideoExpiresAt.getTime()
  );

  if (upstreamLive) {
    if (isS3Enabled() && row.s3UploadStatus !== 'done' && row.s3UploadStatus !== 'uploading') {
      // No await — the upload runs detached.
      maybeKickoffUpload({
        id: row.id,
        taskId: row.taskId,
        provider: row.provider,
        upstreamVideoUrl: row.upstreamVideoUrl,
        upstreamFinishedAt: row.upstreamFinishedAt,
      }).catch(err => logger.error({ err, taskId }, '[v] kickoff failed'));
    }
    c.header('Cache-Control', 'private, max-age=60');
    return c.redirect(row.upstreamVideoUrl!, 302);
  }

  // Path 3: nothing available.
  return c.json({
    error: 'video_expired',
    message: 'Video link expired. Upstream signed URLs are valid for 24 hours after task completion.',
    task_id: row.taskId,
    expired_at: row.upstreamVideoExpiresAt?.toISOString() ?? null,
  }, 410);
});
