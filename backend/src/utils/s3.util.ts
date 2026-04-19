import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';
import { logger } from './logger.util.js';

// Lazy singleton — avoids constructing the client (and its credential chain)
// when S3 is disabled or during tests.
let _client: S3Client | null = null;
function getClient(): S3Client {
  if (_client) return _client;
  _client = new S3Client({
    region: config.S3_REGION,
    ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
    ...(config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: config.S3_ACCESS_KEY_ID,
            secretAccessKey: config.S3_SECRET_ACCESS_KEY,
          },
        }
      : {}),
    // Tigris and most S3-compatible providers require path-style addressing
    // when the bucket name contains characters virtual-hosted style can't
    // accept; safe default for non-AWS endpoints.
    forcePathStyle: !!config.S3_ENDPOINT,
  });
  return _client;
}

export function isS3Enabled(): boolean {
  return !!config.S3_BUCKET;
}

// Object key shape: videos/YYYY/MM/DD/{task_id}.mp4
// Date partition follows the upstream finished timestamp (falls back to now)
// so listing/deletion by lifecycle policy is straightforward.
export function buildObjectKey(taskId: string, anchor: Date | null | undefined): string {
  const d = anchor ?? new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `videos/${yyyy}/${mm}/${dd}/${taskId}.mp4`;
}

// Material object key. Key-scoped prefix lets us audit/clean by token in one
// shot and makes accidental cross-token access visible in S3 access logs.
export function buildMaterialKey(args: {
  userId: number;
  keyId: number;
  materialId: string;
  ext: string; // 'png' | 'jpg' | 'mp4' | 'mp3' | ...  no leading dot
}): string {
  const ext = args.ext.replace(/^\.+/, '').toLowerCase();
  return `materials/${args.userId}/${args.keyId}/${args.materialId}.${ext}`;
}

// Best-effort extension inference from a URL's path. Falls back to a type-
// appropriate default (png/mp4/mp3) when the URL is opaque. Query strings are
// stripped before inspection.
export function inferExtFromUrl(url: string, assetType: 'Image' | 'Video' | 'Audio'): string {
  try {
    const u = new URL(url);
    const m = /\.([a-zA-Z0-9]{2,5})$/.exec(u.pathname);
    if (m) return m[1]!.toLowerCase();
  } catch { /* bad URL → fall through */ }
  return assetType === 'Video' ? 'mp4' : assetType === 'Audio' ? 'mp3' : 'png';
}

// Streams the source URL into S3 using a multipart upload. Returns once the
// upload completes; throws on any failure (network, S3 5xx, source 4xx).
// Optional `defaultContentType` overrides the video-oriented default for
// non-video uploads (e.g. materials) when the source omits a Content-Type.
export async function uploadFromUrl(
  sourceUrl: string,
  key: string,
  defaultContentType = 'video/mp4',
): Promise<{ size: number; mime: string }> {
  const res = await fetch(sourceUrl);
  if (!res.ok || !res.body) {
    throw new Error(`source fetch failed: ${res.status} ${res.statusText}`);
  }
  const contentLength = Number(res.headers.get('content-length') ?? '0') || undefined;
  const contentType = res.headers.get('content-type') || defaultContentType;

  const upload = new Upload({
    client: getClient(),
    params: {
      Bucket: config.S3_BUCKET,
      Key: key,
      Body: res.body as any, // ReadableStream → lib-storage handles streaming
      ContentType: contentType,
      ...(contentLength ? { ContentLength: contentLength } : {}),
    },
    queueSize: 4,         // parallel parts in flight
    partSize: 8 * 1024 * 1024, // 8 MB; videos are typically < 50 MB so this is plenty
  });

  await upload.done();
  return { size: contentLength ?? 0, mime: contentType };
}

// Dedicated presign client for custom-domain downloads. Uses virtual-hosted
// bucket style against the canonical S3 endpoint, then we swap only the URL
// origin to the vanity domain. Tigris accepts this form for CNAME-backed
// aliases; signing directly against the vanity host has proven unreliable.
let _customDomainPresignClient: S3Client | null = null;
function getCustomDomainPresignClient(): S3Client {
  if (_customDomainPresignClient) return _customDomainPresignClient;
  _customDomainPresignClient = new S3Client({
    region: config.S3_REGION,
    ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
    ...(config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: config.S3_ACCESS_KEY_ID,
            secretAccessKey: config.S3_SECRET_ACCESS_KEY,
          },
        }
      : {}),
    forcePathStyle: false,
  });
  return _customDomainPresignClient;
}

async function presignAgainstCustomDomain(key: string, ttlSeconds: number): Promise<string> {
  const presigned = await getSignedUrl(
    getCustomDomainPresignClient(),
    new GetObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: key,
    }),
    { expiresIn: ttlSeconds },
  );

  const url = new URL(presigned);
  const base = new URL(config.S3_PUBLIC_ENDPOINT);
  url.protocol = base.protocol;
  url.host = base.host;
  return url.toString();
}

// Generates a fresh presigned GET URL. Routes through the custom-domain signer
// when S3_PUBLIC_ENDPOINT is configured, otherwise the standard SDK presigner.
//
// `opts.forceStandardEndpoint` bypasses the custom-domain path unconditionally.
// Use this when the signed URL must be consumed by an *external* service
// (e.g. Meitu's asset ingest) — the custom-domain alias path is currently
// unreliable for third-party callers; see /Users/xiongtengyan probing notes.
export async function getPresignedUrl(
  key: string,
  ttlSeconds?: number,
  opts?: { forceStandardEndpoint?: boolean },
): Promise<string> {
  const ttl = ttlSeconds ?? config.S3_PRESIGN_TTL_SECONDS;
  if (config.S3_PUBLIC_ENDPOINT && !opts?.forceStandardEndpoint) {
    return presignAgainstCustomDomain(key, ttl);
  }
  const cmd = new GetObjectCommand({
    Bucket: config.S3_BUCKET,
    Key: key,
  });
  return getSignedUrl(getClient(), cmd, { expiresIn: ttl });
}

// In-memory single-flight guard. Keys = task_id. Prevents two concurrent
// /v hits or cron + proxy from launching duplicate uploads for the same task.
// Cleared on success or failure; safe across restart since DB status is the
// source of truth.
const inFlight = new Set<string>();

export function tryAcquireUpload(taskId: string): boolean {
  if (inFlight.has(taskId)) return false;
  inFlight.add(taskId);
  return true;
}

export function releaseUpload(taskId: string): void {
  inFlight.delete(taskId);
}

// Convenience: log+swallow wrapper for fire-and-forget upload kickoffs.
// `onSuccess` / `onFailure` let the caller persist DB state. Returns
// immediately if another worker already holds the in-flight lock.
export function kickoffUpload(args: {
  taskId: string;
  sourceUrl: string;
  key: string;
  onSuccess: (key: string) => Promise<void> | void;
  onFailure: (err: Error) => Promise<void> | void;
}): void {
  if (!isS3Enabled()) return;
  if (!tryAcquireUpload(args.taskId)) return;

  // Detach from the request lifecycle.
  void (async () => {
    try {
      await uploadFromUrl(args.sourceUrl, args.key);
      await args.onSuccess(args.key);
      logger.info(`[s3] Uploaded ${args.taskId} → ${args.key}`);
    } catch (err: any) {
      logger.error({ err, taskId: args.taskId }, `[s3] Upload failed for ${args.taskId}`);
      try { await args.onFailure(err); } catch { /* swallow secondary failure */ }
    } finally {
      releaseUpload(args.taskId);
    }
  })();
}
