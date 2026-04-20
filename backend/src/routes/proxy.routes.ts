import { Hono } from 'hono';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { calculateCost, detectVideoInput } from '../utils/cost.util.js';
import {
  isFastModel,
  lookupArkPricePerMillion,
  reverseTokensFromCost,
} from '../utils/arkPricing.util.js';
import { proxyAuthMiddleware } from '../middlewares/proxy.middleware.js';
import { concurrencyCache, keyConcurrencyCache } from '../services/concurrency.service.js';
import { getProvider } from '../providers/index.js';
import { generateTaskId } from '../utils/taskId.util.js';
import { attemptModerationFallback, isFallbackEligible } from '../utils/autoFallback.util.js';
import { rewriteArkVideoUrl, computeVideoExpiresAt, resolveVideoUrl, normalizeVideoUrlMode } from '../utils/videoUrl.util.js';
import { maybeKickoffUpload } from '../services/videoOffload.service.js';
import { resolveForProvider } from '../services/material.service.js';
import { logger } from '../utils/logger.util.js';
import type { AppVariables } from '../types.js';

// Scan + rewrite all `asset://<id>` references in a Seedance request body.
// Each reference is re-homed per the target provider:
//   - Meitu  → `asset://<upstream_meitu_asset_id>`  (replace our id with theirs)
//   - others → direct URL (S3 presigned)            (shape-swap the *_url)
//
// Returns an error result if any referenced material isn't owned by this
// token or isn't ready yet. The rewrite happens in-place on `body`.
async function rewriteAssetRefs(
  keyRecord: any,
  body: any,
  provider: string,
): Promise<{ ok: true } | { ok: false; status: number; error: { code: string; message: string; type: string } }> {
  if (!body || typeof body !== 'object') return { ok: true };

  const resolveAssetRef = async (
    materialId: string,
  ): Promise<{ ok: true; value: string } | { ok: false; status: number; error: { code: string; message: string; type: string } }> => {
    const resolved = await resolveForProvider(keyRecord, materialId, provider);
    if (resolved.kind === 'not_found') {
      return {
        ok: false,
        status: 403,
        error: {
          code: 'asset_forbidden',
          message: `asset ${materialId} not found in this token's library`,
          type: 'invalid_request_error',
        },
      };
    }
    if (resolved.kind === 'not_ready') {
      return {
        ok: false,
        status: 409,
        error: {
          code: 'asset_not_ready',
          message: `asset ${materialId} not ready: ${resolved.reason}`,
          type: 'invalid_request_error',
        },
      };
    }
    return {
      ok: true,
      value: resolved.kind === 'asset_id' ? `asset://${resolved.value}` : resolved.value,
    };
  };

  const rewriteStringRef = async (
    raw: string,
  ): Promise<{ ok: true; value: string } | { ok: false; status: number; error: { code: string; message: string; type: string } }> => {
    const m = /^asset:\/\/(.+)$/.exec(raw.trim());
    if (!m) return { ok: true, value: raw };
    return resolveAssetRef(m[1]!);
  };

  if (Array.isArray(body.content)) {
    for (const item of body.content) {
      if (!item || typeof item !== 'object') continue;
      const holder: { obj: any } | null =
        item.image_url ? { obj: item.image_url }
        : item.video_url ? { obj: item.video_url }
        : item.audio_url ? { obj: item.audio_url }
        : null;
      if (!holder) continue;
      const urlField: string | undefined = holder.obj?.url;
      if (typeof urlField !== 'string') continue;
      const rewritten = await rewriteStringRef(urlField);
      if (!rewritten.ok) return rewritten;
      holder.obj.url = rewritten.value;
    }
  }

  for (const field of ['image_urls', 'video_urls', 'audio_urls'] as const) {
    if (!Array.isArray(body[field])) continue;
    for (let i = 0; i < body[field].length; i++) {
      const value = body[field][i];
      if (typeof value !== 'string') continue;
      const rewritten = await rewriteStringRef(value);
      if (!rewritten.ok) return rewritten;
      body[field][i] = rewritten.value;
    }
  }

  return { ok: true };
}

export const proxyRoutes = new Hono<{ Variables: AppVariables }>();

export const createHandler = async (c: any) => {
  const keyRecord = c.get('keyRecord');
  const body = await c.req.json();
  const startTime = Date.now();
  const clientIp = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';

  // Input-only validation: seedance-2.0-fast does not support 1080p output on
  // any upstream (see docs/ark/pricing.md, docs/evolink/evolink.md). Reject
  // early before touching balance / concurrency / DB.
  const requestedQuality = (body.resolution || body.quality || '').toLowerCase();
  if (requestedQuality === '1080p' && isFastModel(body.model)) {
    return c.json(
      {
        error: {
          code: 'unsupported_resolution',
          message: '1080p output is not supported on seedance-2.0-fast models.',
          type: 'invalid_request_error',
        },
      },
      400,
    );
  }

  const userId = keyRecord.userId;
  const userRecord = await db.select({
    balance: schema.users.balance,
    provider: schema.users.provider,
  }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);

  if (userRecord.length > 0 && parseFloat(userRecord[0]!.balance) <= 0) {
    return c.json({ error: '余额不足，请联系管理员充值' }, 403);
  }

  // Per-key provider overrides the user-level default; null inherits from user.
  // 'auto' is a routing flag — start on Meitu, fall back to Evolink on
  // moderation-rejection during polling (see utils/autoFallback.util.ts).
  const configuredProvider = keyRecord.provider || userRecord[0]?.provider || 'meitu';
  const autoMode = configuredProvider === 'auto';
  const provider = autoMode ? 'meitu' : configuredProvider;

  if (keyRecord.quotaLimit !== null && keyRecord.quotaLimit !== undefined) {
    const used = parseFloat(keyRecord.quotaUsed || '0');
    const limit = parseFloat(keyRecord.quotaLimit);
    if (used >= limit) {
      return c.json({ error: '该 Key 配额已用尽，请调整配额或重置已用量' }, 403);
    }
  }

  let cc = concurrencyCache.get(userId);
  if (!cc) { cc = { limit: 3, active: 0 }; concurrencyCache.set(userId, cc); }
  if (cc.active >= cc.limit) {
    return c.json({ error: `并发数已达上限 (${cc.limit})，请稍后重试` }, 429);
  }

  if (keyRecord.concurrencyLimit !== null && keyRecord.concurrencyLimit !== undefined) {
    const keyActive = keyConcurrencyCache.get(keyRecord.id) || 0;
    if (keyActive >= keyRecord.concurrencyLimit) {
      return c.json({ error: `该 Key 并发数已达上限 (${keyRecord.concurrencyLimit})，请稍后重试` }, 429);
    }
  }
  cc.active++;
  keyConcurrencyCache.set(keyRecord.id, (keyConcurrencyCache.get(keyRecord.id) || 0) + 1);

  const originalBody = JSON.stringify(body);
  const userModel = body.model;

  // Swap any `asset://<our-id>` references to their per-provider form (upstream
  // asset id for Meitu, S3 presigned URL for Evolink/Ark). Enforces per-token
  // material ownership: refs that aren't in this token's library are rejected.
  const resolveResult = await rewriteAssetRefs(keyRecord, body, provider);
  if (!resolveResult.ok) {
    cc.active--;
    const ka = keyConcurrencyCache.get(keyRecord.id) || 0;
    if (ka > 0) keyConcurrencyCache.set(keyRecord.id, ka - 1);
    return c.json({ error: resolveResult.error }, resolveResult.status as any);
  }

  try {
    const upstream = getProvider(provider);
    const result = await upstream.createTask(body, userModel);

    const durationMs = Date.now() - startTime;
    const isVideoInput = detectVideoInput(body);

    // Our own task id — surfaced to clients instead of the upstream one.
    let taskId: string | null = null;

    if (result.statusCode >= 200 && result.statusCode < 300 && result.upstreamTaskId) {
      taskId = generateTaskId();

      const evolinkFields = provider === 'evolink'
        ? {
            videoDuration: body.duration || null,
            videoQuality: body.quality || body.resolution || '720p',
            creditsReserved: typeof result.credits === 'number' ? String(result.credits) : null,
          }
        : provider === 'aivideo'
        ? {
            // aivideoapi bills per-second like evolink. Persist the same billing
            // inputs so the terminal poll can settle without re-parsing the
            // request body.
            videoDuration: body.duration || null,
            videoQuality: body.resolution || body.quality || '720p',
          }
        : provider === 'ark'
        ? { videoQuality: body.resolution || '720p' }
        : {};

      await db.insert(schema.usageLogs).values({
        userId: keyRecord.userId,
        keyId: keyRecord.id,
        endpoint: '/create',
        taskId,
        upstreamTaskId: result.upstreamTaskId,
        hasVideoInput: isVideoInput,
        status: 'pending',
        provider,
        autoMode,
        ...evolinkFields,
        requestBody: originalBody.substring(0, 8192),
        upstreamCreateRaw: result.upstreamRaw !== undefined ? JSON.stringify(result.upstreamRaw) : null,
      });
    } else {
       cc.active--;
       const ka = keyConcurrencyCache.get(keyRecord.id) || 0;
       if (ka > 0) keyConcurrencyCache.set(keyRecord.id, ka - 1);
    }

    // Rewrite the response id to our own task id so clients never see the upstream id.
    const publicResponse: any = taskId
      ? { ...result.arkResponse, id: taskId }
      : result.arkResponse;

    // Expose the Ark-equivalent CNY-per-million-token rate so clients can
    // previsualize cost as `tokens × rate / 1e6` uniformly across providers.
    const createRate = lookupArkPricePerMillion({
      model: userModel,
      hasVideo: isVideoInput,
      quality: body.resolution || body.quality,
    });
    if (createRate > 0) {
      publicResponse.usage = {
        ...(publicResponse.usage ?? {}),
        rate_cny_per_million: createRate,
      };
    }

    const responseBody = JSON.stringify(publicResponse);

    db.insert(schema.requestLogs).values({
      userId: keyRecord.userId,
      keyId: keyRecord.id,
      endpoint: '/create',
      method: 'POST',
      requestBody: originalBody,
      responseBody,
      responseStatus: result.statusCode,
      durationMs,
      ipAddress: clientIp,
    }).catch(err => console.error('Request log insert error:', err));

    c.status(result.statusCode as any);
    return c.json(publicResponse);
  } catch (error) {
    console.error('Proxy Create Error:', error);
    cc.active--;
    const ka2 = keyConcurrencyCache.get(keyRecord.id) || 0;
    if (ka2 > 0) keyConcurrencyCache.set(keyRecord.id, ka2 - 1);
    db.insert(schema.requestLogs).values({
      userId: keyRecord.userId,
      keyId: keyRecord.id,
      endpoint: '/create',
      method: 'POST',
      requestBody: originalBody,
      responseBody: JSON.stringify({ error: 'Internal Server Error' }),
      responseStatus: 500,
      durationMs: Date.now() - startTime,
      ipAddress: clientIp,
    }).catch(err => console.error('Request log insert error:', err));
    return c.json({ error: 'Internal Server Error' }, 500);
  }
};

// Per-task-id poll cache. Upstream enforces a 3s minimum query interval for
// the same task, so we reuse the last response we already returned to the
// client when a re-poll lands inside that window.
const TASK_POLL_CACHE_WINDOW_MS = 3_000;
const TASK_POLL_CACHE_RETENTION_MS = 10 * 60_000;
const taskPollResponseCache = new Map<string, {
  fetchedAt: number;
  statusCode: number;
  responseBody: string;
}>();

function getRecentTaskPollResponse(taskId: string) {
  const cached = taskPollResponseCache.get(taskId);
  if (!cached) return null;
  if ((Date.now() - cached.fetchedAt) >= TASK_POLL_CACHE_WINDOW_MS) return null;
  return cached;
}

function setRecentTaskPollResponse(taskId: string, statusCode: number, responseBody: string) {
  taskPollResponseCache.set(taskId, {
    fetchedAt: Date.now(),
    statusCode,
    responseBody,
  });
}

setInterval(() => {
  const cutoff = Date.now() - TASK_POLL_CACHE_RETENTION_MS;
  for (const [k, v] of taskPollResponseCache) {
    if (v.fetchedAt < cutoff) taskPollResponseCache.delete(k);
  }
}, 5 * 60 * 1000);

// Look up a usage_log row by our task id. Legacy (upstream) ids are also
// accepted to keep old clients working during the rollout.
async function findLogByTaskId(taskId: string) {
  const byOurs = await db.select().from(schema.usageLogs)
    .where(eq(schema.usageLogs.taskId, taskId))
    .limit(1);
  if (byOurs.length > 0) return byOurs[0];
  const byUpstream = await db.select().from(schema.usageLogs)
    .where(eq(schema.usageLogs.upstreamTaskId, taskId))
    .limit(1);
  return byUpstream[0];
}

export const getResultHandler = async (c: any) => {
  const keyRecord = c.get('keyRecord');
  let body: any = {};
  if (c.req.method === 'GET') {
    body = { id: c.req.param('id') };
  } else {
    body = await c.req.json();
  }
  const startTime = Date.now();
  const clientIp = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
  const requestBodyStr = JSON.stringify(body);

  const queryTaskId: string | undefined = body.id;

  try {
    const existingLog = queryTaskId ? await findLogByTaskId(queryTaskId) : undefined;
    if (!existingLog) {
      return c.json({ error: { code: 'task_not_found', message: `Task ${queryTaskId} not found`, type: 'invalid_request_error' } }, 404);
    }
    // Authorization: a task is only visible to the user that created it.
    // Return 404 (not 403) so callers can't probe task IDs owned by others.
    if (existingLog.userId !== keyRecord.userId) {
      return c.json({ error: { code: 'task_not_found', message: `Task ${queryTaskId} not found`, type: 'invalid_request_error' } }, 404);
    }

    const publicTaskId = existingLog.taskId || queryTaskId!;
    const cachedResponse = getRecentTaskPollResponse(publicTaskId);
    if (cachedResponse) {
      const durationMs = Date.now() - startTime;
      db.insert(schema.requestLogs).values({
        userId: keyRecord.userId,
        keyId: keyRecord.id,
        endpoint: '/get_result',
        method: c.req.method,
        requestBody: requestBodyStr,
        responseBody: cachedResponse.responseBody,
        responseStatus: cachedResponse.statusCode,
        durationMs,
        ipAddress: clientIp,
      }).catch(err => console.error('Request log insert error:', err));

      c.header('content-type', 'application/json; charset=utf-8');
      c.status(cachedResponse.statusCode as any);
      return c.body(cachedResponse.responseBody);
    }

    const upstreamId = existingLog.upstreamTaskId || queryTaskId!;
    const logProvider = existingLog.provider || 'meitu';

    // Parse the original create body to recover user-facing model name (Meitu
    // returns the endpoint id, not the model name) and pass it to the provider
    // so Evolink can synthesize Ark-shape echo fields its API omits.
    let userModel: string | undefined;
    let parsedCreateBody: any = null;
    try {
      parsedCreateBody = existingLog.requestBody ? JSON.parse(existingLog.requestBody) : null;
      if (parsedCreateBody?.model) userModel = parsedCreateBody.model;
    } catch { /* ignore malformed body */ }

    const upstream = getProvider(logProvider);
    const result = await upstream.queryTask(upstreamId, userModel, parsedCreateBody);

    const durationMs = Date.now() - startTime;
    // Rewrite id in the response so clients only ever see our task id.
    const publicResponse: any = { ...result.arkResponse, id: publicTaskId };
    // Capture the upstream-issued video URL before we rewrite it for the
    // client. Used below to populate upstream_video_url on the terminal write.
    const rawUpstreamVideoUrl: string | undefined = publicResponse.content?.video_url;
    // Surface video_url per the key's configured mode:
    //   cdn      → rewrite to our /v/{task_id}.mp4 (default)
    //   upstream → leave the upstream signed URL as-is
    //   s3       → rewrite to a fresh S3 presigned URL (falls back to cdn
    //              until the async S3 offload for this task completes)
    const videoMode = normalizeVideoUrlMode(keyRecord.videoUrlMode);
    const replacementUrl = await resolveVideoUrl(videoMode, {
      taskId: publicTaskId,
      s3Key: existingLog.s3Key,
      s3UploadStatus: existingLog.s3UploadStatus,
    });
    rewriteArkVideoUrl(publicResponse, replacementUrl);

    // Ark-equivalent CNY-per-million-token rate. Exposed uniformly on every
    // response (running, terminal, error-free) so clients can previsualize
    // cost as `completion_tokens × rate / 1e6` across all providers.
    const arkRate = lookupArkPricePerMillion({
      model: userModel,
      hasVideo: existingLog.hasVideoInput ?? false,
      quality: existingLog.videoQuality || '720p',
    });
    if (arkRate > 0) {
      publicResponse.usage = {
        ...(publicResponse.usage ?? {}),
        rate_cny_per_million: arkRate,
      };
    }

    if (result.statusCode >= 200 && result.statusCode < 300 && publicResponse.status) {
      const normalizedStatus = publicResponse.status;

      // Auto-mode fallback: Meitu rejected on content moderation → re-create
      // on Evolink transparently and short-circuit this poll with the new
      // queued response. Status guard checks 'failed'; eligibility (autoMode +
      // not-already-fallen-back + matching error code) is enforced by the
      // helper. Concurrency / billing untouched: no terminal write happens.
      if (normalizedStatus === 'failed') {
        const failedErrorCode: string | undefined = publicResponse.error?.code;
        if (isFallbackEligible(existingLog, failedErrorCode)) {
          const fallback = await attemptModerationFallback({
            log: existingLog,
            failedErrorCode,
            failedQueryRaw: result.upstreamRaw,
            parsedRequestBody: parsedCreateBody,
            userModel,
          });
          if (fallback.triggered && fallback.arkResponse) {
            const fallbackResponse: any = { ...fallback.arkResponse, id: publicTaskId };
            const fallbackRate = lookupArkPricePerMillion({
              model: userModel,
              hasVideo: existingLog.hasVideoInput ?? false,
              quality: existingLog.videoQuality || '720p',
            });
            if (fallbackRate > 0) {
              fallbackResponse.usage = {
                ...(fallbackResponse.usage ?? {}),
                rate_cny_per_million: fallbackRate,
              };
            }
            const fallbackResponseBody = JSON.stringify(fallbackResponse);
            setRecentTaskPollResponse(publicTaskId, 200, fallbackResponseBody);
            db.insert(schema.requestLogs).values({
              userId: keyRecord.userId,
              keyId: keyRecord.id,
              endpoint: '/get_result',
              method: c.req.method,
              requestBody: requestBodyStr,
              responseBody: fallbackResponseBody,
              responseStatus: 200,
              durationMs: Date.now() - startTime,
              ipAddress: clientIp,
              fallbackTriggered: true,
            }).catch(err => console.error('Request log insert error:', err));
            c.status(200);
            return c.json(fallbackResponse);
          }
        }
      }

      if (normalizedStatus === 'succeeded' || normalizedStatus === 'failed' || normalizedStatus === 'cancelled' || normalizedStatus === 'expired') {
        let cost = '0';
        if (normalizedStatus === 'succeeded') {
          const storedCredits = existingLog.creditsReserved
            ? parseFloat(existingLog.creditsReserved)
            : undefined;
          cost = calculateCost(logProvider, {
            completionTokens: result.completionTokens || 0,
            hasVideo: existingLog.hasVideoInput ?? false,
            duration: result.duration || existingLog.videoDuration || 5,
            quality: existingLog.videoQuality || '720p',
            model: userModel,
            ...(typeof storedCredits === 'number' ? { credits: storedCredits } : {}),
          });

          // Evolink/Aivideo charge per-second (credits or USD). Reverse-map
          // the actual CNY cost into an Ark-equivalent token count so the
          // client sees a uniform `cost = tokens × rate / 1e6` contract.
          // Billing is still driven by the real per-second formula; these
          // tokens are display-only.
          if (logProvider === 'evolink' || logProvider === 'aivideo') {
            const synthetic = reverseTokensFromCost({
              costYuan: parseFloat(cost),
              model: userModel,
              hasVideo: existingLog.hasVideoInput ?? false,
              quality: existingLog.videoQuality || '720p',
            });
            if (synthetic > 0) {
              result.completionTokens = synthetic;
              publicResponse.usage = {
                ...(publicResponse.usage ?? {}),
                completion_tokens: synthetic,
                total_tokens: synthetic,
              };
            }
          }
        }

        let statusUpdated = false;
        // Lifecycle mapping: succeeded/failed/cancelled/expired map 1:1 to the
        // stored enum (the DB already used 'expired' before; 'cancelled' is new
        // but stored as a plain varchar so no migration needed).
        const persistStatus = normalizedStatus;
        // Upstream-authoritative timing (seconds → Date).
        const startedSec = typeof publicResponse.created_at === 'number' ? publicResponse.created_at : undefined;
        const finishedSec = typeof publicResponse.updated_at === 'number' ? publicResponse.updated_at : undefined;
        const timingFields = {
          ...(startedSec ? { upstreamStartedAt: new Date(startedSec * 1000) } : {}),
          ...(finishedSec ? { upstreamFinishedAt: new Date(finishedSec * 1000) } : {}),
          ...(startedSec && finishedSec ? { taskDurationMs: (finishedSec - startedSec) * 1000 } : {}),
        };
        // Capture raw upstream URL + compute expiry for the terminal write.
        // publicResponse was already URL-rewritten above, so result_data will
        // match what the client sees.
        const videoFields = (normalizedStatus === 'succeeded' && rawUpstreamVideoUrl)
          ? {
              upstreamVideoUrl: rawUpstreamVideoUrl,
              upstreamVideoExpiresAt: computeVideoExpiresAt(
                logProvider,
                timingFields.upstreamFinishedAt ?? existingLog.upstreamFinishedAt ?? null,
              ),
            }
          : {};
        // Serialize AFTER rate + synthetic-token injection so the stored
        // result_data matches exactly what the client sees.
        const terminalResponseBody = JSON.stringify(publicResponse);
        await db.transaction(async (tx) => {
          const updateResult = await tx.update(schema.usageLogs)
            .set({
              status: persistStatus,
              completionTokens: result.completionTokens || 0,
              ...(result.duration ? { videoDuration: result.duration } : {}),
              costYuan: cost,
              resultData: terminalResponseBody,
              ...videoFields,
              ...(result.upstreamRaw !== undefined
                ? { upstreamQueryRaw: JSON.stringify(result.upstreamRaw) }
                : {}),
              ...timingFields,
              updatedAt: new Date(),
            })
            .where(and(
              eq(schema.usageLogs.id, existingLog.id),
              sql`${schema.usageLogs.status} IN ('pending', 'expired')`,
            ))
            .returning({ id: schema.usageLogs.id });

          statusUpdated = updateResult.length > 0;

          if (statusUpdated && persistStatus === 'succeeded' && parseFloat(cost) > 0) {
            await tx.update(schema.users)
              .set({ balance: sql`${schema.users.balance} - ${cost}` })
              .where(eq(schema.users.id, existingLog.userId));
            await tx.update(schema.keys)
              .set({ quotaUsed: sql`${schema.keys.quotaUsed}::numeric + ${cost}::numeric` })
              .where(eq(schema.keys.id, existingLog.keyId));
          }
        });

        if (statusUpdated) {
          const ucc = concurrencyCache.get(existingLog.userId);
          if (ucc && ucc.active > 0) ucc.active--;
          const kcc = keyConcurrencyCache.get(existingLog.keyId) || 0;
          if (kcc > 0) keyConcurrencyCache.set(existingLog.keyId, kcc - 1);

          // Fire-and-forget S3 offload. Internally a no-op when S3 is
          // disabled, the task isn't succeeded with a video, or another worker
          // has already claimed the upload.
          if (persistStatus === 'succeeded' && rawUpstreamVideoUrl) {
            maybeKickoffUpload({
              id: existingLog.id,
              taskId: existingLog.taskId,
              provider: logProvider,
              upstreamVideoUrl: rawUpstreamVideoUrl,
              upstreamFinishedAt: timingFields.upstreamFinishedAt ?? existingLog.upstreamFinishedAt ?? null,
            }).catch(err => logger.error({ err, taskId: existingLog.taskId }, 'maybeKickoffUpload error'));
          }
        }
      }
    }

    // Re-serialize after all response mutations (rate + evolink synthetic
    // tokens) so the request log captures what the client actually receives.
    const responseBody = JSON.stringify(publicResponse);
    setRecentTaskPollResponse(publicTaskId, result.statusCode, responseBody);
    db.insert(schema.requestLogs).values({
      userId: keyRecord.userId,
      keyId: keyRecord.id,
      endpoint: '/get_result',
      method: c.req.method,
      requestBody: requestBodyStr,
      responseBody,
      responseStatus: result.statusCode,
      durationMs,
      ipAddress: clientIp,
    }).catch(err => console.error('Request log insert error:', err));

    c.status(result.statusCode as any);
    return c.json(publicResponse);
  } catch (error) {
    console.error('Proxy Get Result Error:', error);
    db.insert(schema.requestLogs).values({
      userId: keyRecord.userId,
      keyId: keyRecord.id,
      endpoint: '/get_result',
      method: c.req.method,
      requestBody: requestBodyStr,
      responseBody: JSON.stringify({ error: 'Internal Server Error' }),
      responseStatus: 500,
      durationMs: Date.now() - startTime,
      ipAddress: clientIp,
    }).catch(err => console.error('Request log insert error:', err));
    return c.json({ error: 'Internal Server Error' }, 500);
  }
};

// DELETE /api/v3/contents/generations/tasks/:id — cancel a queued task, or
// delete a finished task record. See docs/ark/cancel.md for the state matrix.
export const cancelHandler = async (c: any) => {
  const keyRecord = c.get('keyRecord');
  const taskId = c.req.param('id');
  const startTime = Date.now();
  const clientIp = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';

  if (!taskId) return c.json({ error: 'Missing task id' }, 400);

  try {
    const existingLog = await findLogByTaskId(taskId);
    if (!existingLog) {
      return c.json({ error: { code: 'task_not_found', message: `Task ${taskId} not found`, type: 'invalid_request_error' } }, 404);
    }
    if (existingLog.userId !== keyRecord.userId) {
      return c.json({ error: { code: 'forbidden', message: 'Task does not belong to this account', type: 'permission_error' } }, 403);
    }

    const upstream = getProvider(existingLog.provider || 'meitu');
    const upstreamId = existingLog.upstreamTaskId || taskId;
    const currentStatus = existingLog.status;

    // Per Ark spec: queued → cancelled; succeeded/failed/expired → delete record.
    // running/cancelled → reject.
    if (currentStatus === 'succeeded' || currentStatus === 'failed' || currentStatus === 'expired') {
      await db.delete(schema.usageLogs).where(eq(schema.usageLogs.id, existingLog.id));
      // Best-effort: also tell upstream (ignore the result).
      await upstream.cancelTask(upstreamId).catch(() => {});
      db.insert(schema.requestLogs).values({
        userId: keyRecord.userId, keyId: keyRecord.id,
        endpoint: '/cancel', method: 'DELETE',
        requestBody: JSON.stringify({ id: taskId }), responseBody: '',
        responseStatus: 204, durationMs: Date.now() - startTime, ipAddress: clientIp,
      }).catch(err => console.error('Request log insert error:', err));
      c.status(204);
      return c.body(null);
    }

    if (currentStatus === 'cancelled') {
      return c.json({ error: { code: 'task_already_cancelled', message: 'Task already cancelled', type: 'invalid_request_error' } }, 409);
    }

    // Pending (queued or running upstream): ask upstream to cancel, then flip local status.
    const cancelRes = await upstream.cancelTask(upstreamId);

    let statusUpdated = false;
    await db.transaction(async (tx) => {
      const updateResult = await tx.update(schema.usageLogs)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(and(
          eq(schema.usageLogs.id, existingLog.id),
          sql`${schema.usageLogs.status} IN ('pending', 'expired')`,
        ))
        .returning({ id: schema.usageLogs.id });
      statusUpdated = updateResult.length > 0;
    });

    if (statusUpdated) {
      const ucc = concurrencyCache.get(existingLog.userId);
      if (ucc && ucc.active > 0) ucc.active--;
      const kcc = keyConcurrencyCache.get(existingLog.keyId) || 0;
      if (kcc > 0) keyConcurrencyCache.set(existingLog.keyId, kcc - 1);
    }

    db.insert(schema.requestLogs).values({
      userId: keyRecord.userId, keyId: keyRecord.id,
      endpoint: '/cancel', method: 'DELETE',
      requestBody: JSON.stringify({ id: taskId }),
      responseBody: JSON.stringify(cancelRes.body ?? ''),
      responseStatus: cancelRes.statusCode,
      durationMs: Date.now() - startTime, ipAddress: clientIp,
    }).catch(err => console.error('Request log insert error:', err));

    c.status(204);
    return c.body(null);
  } catch (error) {
    console.error('Proxy Cancel Error:', error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
};

proxyRoutes.post('/create', proxyAuthMiddleware, createHandler);
proxyRoutes.post('/get_result', proxyAuthMiddleware, getResultHandler);
