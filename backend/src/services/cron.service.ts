import cron from 'node-cron';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { eq, and, sql, lt } from 'drizzle-orm';
import { config } from '../config.js';
import { calculateCost } from '../utils/cost.util.js';
import { getProvider } from '../providers/index.js';
import { concurrencyCache, keyConcurrencyCache } from './concurrency.service.js';
import { logger } from '../utils/logger.util.js';
import { attemptModerationFallback, isFallbackEligible } from '../utils/autoFallback.util.js';
import { rewriteArkVideoUrl, computeVideoExpiresAt } from '../utils/videoUrl.util.js';
import { maybeKickoffUpload, retryFailedUploads } from './videoOffload.service.js';

const CRON_BATCH_SIZE = 10;

let cronTask: cron.ScheduledTask | null = null;

const processPendingTask = async (log: any) => {
  try {
    const upstreamId = log.upstreamTaskId || log.taskId;
    if (!upstreamId) return;

    // Recover the user-facing model name from the original request body so the
    // translated response carries the caller's model, not the provider's
    // internal endpoint id.
    let userModel: string | undefined;
    try {
      if (log.requestBody) {
        const parsed = JSON.parse(log.requestBody);
        if (parsed?.model) userModel = parsed.model;
      }
    } catch { /* ignore */ }

    const provider = getProvider(log.provider || 'meitu');
    const parsedBody = (() => {
      try { return log.requestBody ? JSON.parse(log.requestBody) : null; } catch { return null; }
    })();
    const result = await provider.queryTask(upstreamId, userModel, parsedBody);

    if (result.statusCode >= 200 && result.statusCode < 300) {
      const normalizedStatus = result.arkResponse.status;

      // Auto-mode fallback before terminal write — same logic as the route
      // handler. Without this, an idle (un-polled) auto task would be
      // permanently marked failed by the cron, never reaching evolink.
      if (normalizedStatus === 'failed') {
        const failedErrorCode = result.arkResponse.error?.code;
        if (isFallbackEligible(log, failedErrorCode)) {
          const fallback = await attemptModerationFallback({
            log,
            failedErrorCode,
            failedQueryRaw: result.upstreamRaw,
            parsedRequestBody: parsedBody,
            userModel,
          });
          if (fallback.triggered) {
            logger.info(`[auto-fallback] Cron re-routed task ${log.taskId} meitu→evolink`);
            return; // Next cron tick will pick up the new evolink task as 'pending'.
          }
        }
      }

      if (['succeeded', 'failed', 'cancelled', 'expired'].includes(normalizedStatus)) {
        let cost = '0';
        if (normalizedStatus === 'succeeded') {
          const storedCredits = log.creditsReserved ? parseFloat(log.creditsReserved) : undefined;
          cost = calculateCost(log.provider || 'meitu', {
            completionTokens: result.completionTokens || 0,
            hasVideo: log.hasVideoInput,
            duration: result.duration || log.videoDuration || 5,
            quality: log.videoQuality || '720p',
            model: userModel,
            ...(typeof storedCredits === 'number' ? { credits: storedCredits } : {}),
          });
        }
        
        // Optimistic lock: only update if status is 'pending' or 'expired' to allow recovery
        let statusUpdated = false;
        const startedSec = typeof result.arkResponse.created_at === 'number' ? result.arkResponse.created_at : undefined;
        const finishedSec = typeof result.arkResponse.updated_at === 'number' ? result.arkResponse.updated_at : undefined;
        const timingFields = {
          ...(startedSec ? { upstreamStartedAt: new Date(startedSec * 1000) } : {}),
          ...(finishedSec ? { upstreamFinishedAt: new Date(finishedSec * 1000) } : {}),
          ...(startedSec && finishedSec ? { taskDurationMs: (finishedSec - startedSec) * 1000 } : {}),
        };
        // Capture raw upstream URL before the Ark-shape snapshot gets its
        // video_url rewritten to the self-hosted /v URL. NULL when no video
        // (non-succeeded) or no content.
        const rawUpstreamVideoUrl: string | undefined = result.arkResponse.content?.video_url;
        const storedArkResponse: any = { ...result.arkResponse, id: log.taskId || result.arkResponse.id };
        rewriteArkVideoUrl(storedArkResponse);
        const videoFields = (normalizedStatus === 'succeeded' && rawUpstreamVideoUrl)
          ? {
              upstreamVideoUrl: rawUpstreamVideoUrl,
              upstreamVideoExpiresAt: computeVideoExpiresAt(
                log.provider || 'meitu',
                timingFields.upstreamFinishedAt ?? log.upstreamFinishedAt ?? null,
              ),
            }
          : {};
        await db.transaction(async (tx) => {
          const updateResult = await tx.update(schema.usageLogs)
            .set({
              status: normalizedStatus,
              completionTokens: result.completionTokens || 0,
              ...(result.duration ? { videoDuration: result.duration } : {}),
              costYuan: cost,
              // Persist the Ark-shape snapshot with our task id and self URL.
              resultData: JSON.stringify(storedArkResponse),
              ...videoFields,
              ...(result.upstreamRaw !== undefined
                ? { upstreamQueryRaw: JSON.stringify(result.upstreamRaw) }
                : {}),
              ...timingFields,
              updatedAt: new Date()
            })
            .where(and(
              eq(schema.usageLogs.id, log.id),
              sql`${schema.usageLogs.status} IN ('pending', 'expired')`
            ))
            .returning({ id: schema.usageLogs.id });

          statusUpdated = updateResult.length > 0;

          // Only deduct balance if we actually transitioned from pending
          if (statusUpdated && normalizedStatus === 'succeeded' && parseFloat(cost) > 0) {
            await tx.update(schema.users)
              .set({ balance: sql`${schema.users.balance} - ${cost}` })
              .where(eq(schema.users.id, log.userId));
              
            if (log.keyId) {
              await tx.update(schema.keys)
                .set({ quotaUsed: sql`${schema.keys.quotaUsed}::numeric + ${cost}::numeric` })
                .where(eq(schema.keys.id, log.keyId));
            }
          }
        });

        // Only decrement concurrency if we were the one to transition status
        if (statusUpdated) {
          const ucc = concurrencyCache.get(log.userId);
          if (ucc && ucc.active > 0) ucc.active--;

          if (log.keyId) {
            const kcc = keyConcurrencyCache.get(log.keyId) || 0;
            if (kcc > 0) keyConcurrencyCache.set(log.keyId, kcc - 1);
          }

          // Fire-and-forget S3 offload of the freshly-finished video.
          if (normalizedStatus === 'succeeded' && rawUpstreamVideoUrl) {
            maybeKickoffUpload({
              id: log.id,
              taskId: log.taskId,
              provider: log.provider || 'meitu',
              upstreamVideoUrl: rawUpstreamVideoUrl,
              upstreamFinishedAt: timingFields.upstreamFinishedAt ?? log.upstreamFinishedAt ?? null,
            }).catch(err => logger.error({ err, taskId: log.taskId }, 'maybeKickoffUpload error'));
          }
        }

        logger.info(`[${log.provider || 'meitu'}] Updated task ${log.taskId} status to ${normalizedStatus}, cost: ¥${cost}, applied: ${statusUpdated}`);
      }
    }
  } catch (err) {
    logger.error({ err, taskId: log.taskId }, `Cron: Error processing task ${log.taskId}`);
  }
};

export function startCronJobs() {
  cronTask = cron.schedule('*/5 * * * *', async () => {
    logger.info('Running Cron Job to poll pending tasks...');
    try {
      const pendingLogs = await db.select().from(schema.usageLogs).where(eq(schema.usageLogs.status, 'pending'));

      // Process in batches
      for (let i = 0; i < pendingLogs.length; i += CRON_BATCH_SIZE) {
        const batch = pendingLogs.slice(i, i + CRON_BATCH_SIZE);
        await Promise.allSettled(batch.map(log => processPendingTask(log)));
      }

      // Recover expired tasks that may have completed upstream
      const expiredLogs = await db.select().from(schema.usageLogs).where(eq(schema.usageLogs.status, 'expired'));
      for (let i = 0; i < expiredLogs.length; i += CRON_BATCH_SIZE) {
        const batch = expiredLogs.slice(i, i + CRON_BATCH_SIZE);
        await Promise.allSettled(batch.map(log => processPendingTask(log)));
      }
      if (expiredLogs.length > 0) {
        logger.info(`Attempted recovery of ${expiredLogs.length} expired tasks`);
      }

      // Auto-expire stuck tasks (with a final check before expiring)
      const now = Date.now();
      const stillPending = await db.select().from(schema.usageLogs).where(eq(schema.usageLogs.status, 'pending'));
      for (const log of stillPending) {
        const age = now - new Date(log.createdAt).getTime();
        if (age > config.PENDING_TIMEOUT_MS) {
          let recovered = false;
          try {
            const upstreamId = log.upstreamTaskId || log.taskId;
            if (upstreamId) {
              const provider = getProvider(log.provider || 'meitu');
              const finalResult = await provider.queryTask(upstreamId);
              if (finalResult.statusCode >= 200 && finalResult.statusCode < 300) {
                const finalStatus = finalResult.arkResponse.status;
                if (['succeeded', 'failed', 'cancelled'].includes(finalStatus)) {
                  await processPendingTask(log);
                  recovered = true;
                  logger.info(`Recovered task ${log.taskId} with status ${finalStatus} before expiring`);
                }
              }
            }
          } catch (err) {
            logger.error({ err, taskId: log.taskId }, `Final check failed for task ${log.taskId}, will expire`);
          }

          if (!recovered) {
            let expiredUpdated = false;
            await db.transaction(async (tx) => {
              const updateResult = await tx.update(schema.usageLogs)
                .set({ status: 'expired', updatedAt: new Date() })
                .where(and(
                  eq(schema.usageLogs.id, log.id),
                  eq(schema.usageLogs.status, 'pending')
                ))
                .returning({ id: schema.usageLogs.id });
              expiredUpdated = updateResult.length > 0;
            });

            if (expiredUpdated) {
              const ucc = concurrencyCache.get(log.userId);
              if (ucc && ucc.active > 0) ucc.active--;
              
              if (log.keyId) {
                const kcc = keyConcurrencyCache.get(log.keyId) || 0;
                if (kcc > 0) keyConcurrencyCache.set(log.keyId, kcc - 1);
              }
              logger.info(`Auto-expired stuck task ${log.taskId}`);
            }
          }
        }
      }

      // Retry S3 uploads for tasks where the inline kickoff didn't land
      // (process restart between terminal write and upload, transient S3
      // error, etc.). No-op when S3 is disabled.
      try {
        await retryFailedUploads(CRON_BATCH_SIZE);
      } catch (err) {
        logger.error({ err }, 'S3 upload retry pass error');
      }

      // Cleanup request logs older than 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const deleteResult = await db.delete(schema.requestLogs).where(lt(schema.requestLogs.createdAt, thirtyDaysAgo));
      // Drizzle delete result depends on driver, but we don't necessarily need to log the count unless we use returning() or postgres allows it.

    } catch (error) {
      logger.error({ err: error }, 'Cron Job Error');
    }
  });
}

export function stopCronJobs() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }
}
