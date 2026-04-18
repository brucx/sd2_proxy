// Auto-mode moderation fallback. When a Meitu task fails with a content-
// moderation error code (substring match against config.AUTO_FALLBACK_ERROR_CODE_PATTERN)
// and the task was created under provider='auto', re-create the task on Evolink
// transparently — same task_id stays visible to the client, and the next poll
// returns 'queued' on the new upstream.
//
// Single-hop only: gated by `fallback_from_provider IS NULL` so a fallback
// task cannot trigger another fallback.

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { evolinkProvider } from '../providers/evolink.provider.js';
import type { ArkTaskResponse } from './arkFormat.util.js';
import { logger } from './logger.util.js';

export interface FallbackResult {
  triggered: boolean;
  // Populated only when triggered=true. Mirrors the upstream createTask result
  // shape so callers can return it to the client without further work.
  arkResponse?: ArkTaskResponse;
  statusCode?: number;
  newUpstreamTaskId?: string;
}

export interface FallbackInput {
  log: typeof schema.usageLogs.$inferSelect; // current usage_log row (status still 'pending' on disk)
  failedErrorCode: string | undefined;        // upstream error.code from the failed query
  failedQueryRaw: unknown;                    // raw upstream query response (preserved for audit)
  parsedRequestBody: any;                     // original create-time body, parsed
  userModel: string | undefined;              // user-facing model name from request body
}

/**
 * Evaluate whether the failure is eligible for auto-mode fallback. Pure check,
 * no side effects.
 */
export function isFallbackEligible(
  log: { autoMode?: boolean | null; fallbackFromProvider?: string | null; provider?: string | null },
  errorCode: string | undefined,
): boolean {
  if (!errorCode) return false;
  if (!log.autoMode) return false;
  if (log.fallbackFromProvider) return false;       // already fell back once
  if (log.provider !== 'meitu') return false;       // only meitu→evolink supported
  return errorCode.includes(config.AUTO_FALLBACK_ERROR_CODE_PATTERN);
}

/**
 * Attempt the fallback. Returns triggered=false (and writes nothing) when
 *   - not eligible per `isFallbackEligible`
 *   - request body is missing/unparseable
 *   - the Evolink createTask itself fails (non-2xx or no upstream id)
 * On triggered=true, the usage_log row is mutated in place: provider/upstream
 * id/timing/audit fields all swing to the new Evolink task.
 */
export async function attemptModerationFallback(input: FallbackInput): Promise<FallbackResult> {
  const { log, failedErrorCode, failedQueryRaw, parsedRequestBody, userModel } = input;

  if (!isFallbackEligible(log, failedErrorCode)) {
    return { triggered: false };
  }
  if (!parsedRequestBody || typeof parsedRequestBody !== 'object') {
    logger.warn({ taskId: log.taskId }, 'auto-fallback: missing/invalid requestBody, skipping');
    return { triggered: false };
  }
  if (!userModel) {
    logger.warn({ taskId: log.taskId }, 'auto-fallback: missing userModel, skipping');
    return { triggered: false };
  }

  let createResult;
  try {
    createResult = await evolinkProvider.createTask(parsedRequestBody, userModel);
  } catch (err) {
    logger.error({ err, taskId: log.taskId }, 'auto-fallback: evolink createTask threw');
    return { triggered: false };
  }

  if (createResult.statusCode < 200 || createResult.statusCode >= 300 || !createResult.upstreamTaskId) {
    logger.warn(
      { taskId: log.taskId, statusCode: createResult.statusCode },
      'auto-fallback: evolink createTask failed, leaving original failure in place',
    );
    return { triggered: false };
  }

  const arkCreated = typeof createResult.arkResponse?.created_at === 'number'
    ? createResult.arkResponse.created_at
    : undefined;

  // In-place handoff. Optimistic guard on status='pending' so we don't clobber
  // a row that some other path (cron, concurrent poll) already finalized.
  const updateResult = await db.update(schema.usageLogs)
    .set({
      provider: 'evolink',
      upstreamTaskId: createResult.upstreamTaskId,
      fallbackFromProvider: 'meitu',
      fallbackReason: failedErrorCode || null,
      // The new evolink task is fresh — reset timing so subsequent
      // upstream_finished_at math reflects evolink's run, not meitu's.
      upstreamStartedAt: arkCreated ? new Date(arkCreated * 1000) : null,
      upstreamFinishedAt: null,
      taskDurationMs: null,
      // Preserve the meitu failed-query payload for forensics (we will not get
      // another chance to write it once the row goes terminal).
      upstreamQueryRaw: JSON.stringify(failedQueryRaw),
      // Audit: replace create-time raw with evolink's response. (Original meitu
      // create raw is in request_logs from the original /create call.)
      upstreamCreateRaw: createResult.upstreamRaw !== undefined
        ? JSON.stringify(createResult.upstreamRaw)
        : null,
      // Refresh evolink billing inputs.
      creditsReserved: typeof createResult.credits === 'number' ? String(createResult.credits) : null,
      videoQuality: parsedRequestBody.resolution || parsedRequestBody.quality || log.videoQuality || '720p',
      videoDuration: typeof parsedRequestBody.duration === 'number' ? parsedRequestBody.duration : log.videoDuration,
      updatedAt: new Date(),
    })
    .where(sql`${schema.usageLogs.id} = ${log.id} AND ${schema.usageLogs.status} = 'pending' AND ${schema.usageLogs.fallbackFromProvider} IS NULL`)
    .returning({ id: schema.usageLogs.id });

  if (updateResult.length === 0) {
    // Lost the race — either status moved off pending, or another worker
    // already triggered the fallback. Either way, our evolink task is now
    // orphaned (no row points at it). Acceptable: evolink will run, no client
    // poll can reach it via our id, billing won't double-charge.
    logger.warn({ taskId: log.taskId }, 'auto-fallback: lost race on row update, evolink task orphaned');
    return { triggered: false };
  }

  logger.info(
    { taskId: log.taskId, evolinkId: createResult.upstreamTaskId, reason: failedErrorCode },
    'auto-fallback: meitu→evolink',
  );

  return {
    triggered: true,
    arkResponse: createResult.arkResponse,
    statusCode: createResult.statusCode,
    newUpstreamTaskId: createResult.upstreamTaskId,
  };
}
