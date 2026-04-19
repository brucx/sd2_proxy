import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { eq, and, sql, or, isNull, isNotNull, lt } from 'drizzle-orm';
import { config } from '../config.js';
import { logger } from '../utils/logger.util.js';
import { isS3Enabled, buildObjectKey, kickoffUpload } from '../utils/s3.util.js';

// Atomically claim the upload for a task: flip s3_upload_status to 'uploading'
// only if it's currently NULL or 'failed' (and under attempt cap). Returns
// true when this caller owns the upload and should proceed.
async function claimUpload(logId: number): Promise<boolean> {
  const updated = await db.update(schema.usageLogs)
    .set({ s3UploadStatus: 'uploading' })
    .where(and(
      eq(schema.usageLogs.id, logId),
      or(
        isNull(schema.usageLogs.s3UploadStatus),
        eq(schema.usageLogs.s3UploadStatus, 'failed'),
      ),
      lt(schema.usageLogs.s3UploadAttempts, config.S3_UPLOAD_MAX_ATTEMPTS),
    ))
    .returning({ id: schema.usageLogs.id });
  return updated.length > 0;
}

// Mark upload successful and persist the object key.
async function markDone(logId: number, key: string): Promise<void> {
  await db.update(schema.usageLogs)
    .set({
      s3Key: key,
      s3UploadStatus: 'done',
      s3UploadedAt: new Date(),
      s3UploadError: null,
    })
    .where(eq(schema.usageLogs.id, logId));
}

// Mark upload failed; cron will retry until attempts hits the cap.
async function markFailed(logId: number, err: Error): Promise<void> {
  await db.update(schema.usageLogs)
    .set({
      s3UploadStatus: 'failed',
      s3UploadAttempts: sql`${schema.usageLogs.s3UploadAttempts} + 1`,
      s3UploadError: String(err?.message || err).slice(0, 1000),
    })
    .where(eq(schema.usageLogs.id, logId));
}

// Fire-and-forget. Safe to call multiple times; the DB-level claim ensures
// only one worker actually runs the upload.
//
// Required fields on `log`: id, taskId, provider, upstreamVideoUrl,
// upstreamFinishedAt. Skips silently when:
//   - S3 disabled (no bucket configured)
//   - log lacks an upstream URL
//   - claim fails (already uploading / done / cap reached)
export async function maybeKickoffUpload(log: {
  id: number;
  taskId: string | null;
  provider: string | null;
  upstreamVideoUrl: string | null;
  upstreamFinishedAt: Date | null;
}): Promise<void> {
  if (!isS3Enabled()) return;
  if (!log.upstreamVideoUrl || !log.taskId) return;

  const claimed = await claimUpload(log.id);
  if (!claimed) return;

  const key = buildObjectKey(log.taskId, log.upstreamFinishedAt);
  kickoffUpload({
    taskId: log.taskId,
    sourceUrl: log.upstreamVideoUrl,
    key,
    onSuccess: () => markDone(log.id, key),
    onFailure: (err) => markFailed(log.id, err),
  });
}

// Cron entry point: find succeeded tasks whose offload hasn't completed and
// whose upstream URL is still valid (evolink: never expires). Retries up to
// S3_UPLOAD_MAX_ATTEMPTS per task.
export async function retryFailedUploads(batchSize = 10): Promise<number> {
  if (!isS3Enabled()) return 0;

  const candidates = await db.select({
    id: schema.usageLogs.id,
    taskId: schema.usageLogs.taskId,
    provider: schema.usageLogs.provider,
    upstreamVideoUrl: schema.usageLogs.upstreamVideoUrl,
    upstreamFinishedAt: schema.usageLogs.upstreamFinishedAt,
  }).from(schema.usageLogs)
    .where(and(
      eq(schema.usageLogs.status, 'succeeded'),
      // Not yet uploaded successfully
      or(
        isNull(schema.usageLogs.s3UploadStatus),
        eq(schema.usageLogs.s3UploadStatus, 'failed'),
      ),
      // Source still reachable: either no expiry (evolink) or expiry in future.
      // Use SQL `now()` instead of a bound Date param — postgres@3.4.8 rejects
      // Date bindings for `timestamp without time zone` in this nested-or shape.
      or(
        isNull(schema.usageLogs.upstreamVideoExpiresAt),
        sql`${schema.usageLogs.upstreamVideoExpiresAt} > now()`,
      ),
      // We have something to upload
      isNotNull(schema.usageLogs.upstreamVideoUrl),
      lt(schema.usageLogs.s3UploadAttempts, config.S3_UPLOAD_MAX_ATTEMPTS),
    ))
    .limit(batchSize);

  if (candidates.length === 0) return 0;

  for (const c of candidates) {
    await maybeKickoffUpload(c);
  }
  logger.info(`[s3] Retry pass: kicked ${candidates.length} upload(s)`);
  return candidates.length;
}
