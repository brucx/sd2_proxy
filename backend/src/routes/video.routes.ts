import { Hono } from 'hono';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { eq } from 'drizzle-orm';

export const videoRoutes = new Hono();

// GET /v/:filename  (filename = {task_id}.mp4)
// Resolves the task's upstream video URL and 302s the client to it. This
// endpoint hides the upstream signature/domain from casual inspection while
// relying on the client actually following redirects (devtools still sees the
// final URL — the point is cosmetic, not cryptographic).
//
// Responses:
//   302 Location: <upstream>  — task succeeded and URL still valid
//   404                         — unknown task, or task not in succeeded state
//   410                         — upstream signed URL has expired (ark/meitu)
videoRoutes.get('/:filename', async (c) => {
  const filename = c.req.param('filename');
  // Only accept .mp4 so we don't leak information about other asset types.
  if (!filename.endsWith('.mp4')) {
    return c.json({ error: 'not_found' }, 404);
  }
  const taskId = filename.slice(0, -'.mp4'.length);
  if (!taskId) return c.json({ error: 'not_found' }, 404);

  const rows = await db.select({
    taskId: schema.usageLogs.taskId,
    status: schema.usageLogs.status,
    upstreamVideoUrl: schema.usageLogs.upstreamVideoUrl,
    upstreamVideoExpiresAt: schema.usageLogs.upstreamVideoExpiresAt,
  }).from(schema.usageLogs)
    .where(eq(schema.usageLogs.taskId, taskId))
    .limit(1);

  const row = rows[0];
  // 404 for both missing and not-yet-terminal so we don't leak task existence
  // via a different status code before the video is actually ready.
  if (!row || row.status !== 'succeeded' || !row.upstreamVideoUrl) {
    return c.json({ error: 'not_found', message: 'Video not available.' }, 404);
  }

  // Expiry check. NULL expiresAt means permanent (evolink).
  if (row.upstreamVideoExpiresAt && Date.now() >= row.upstreamVideoExpiresAt.getTime()) {
    return c.json({
      error: 'video_expired',
      message: 'Video link expired. Upstream signed URLs are valid for 24 hours after task completion.',
      task_id: row.taskId,
      expired_at: row.upstreamVideoExpiresAt.toISOString(),
    }, 410);
  }

  // Short private-cache hint lets well-behaved players avoid redundant
  // redirects within a single session without allowing shared caches to
  // hoard the signed URL.
  c.header('Cache-Control', 'private, max-age=60');
  return c.redirect(row.upstreamVideoUrl, 302);
});
