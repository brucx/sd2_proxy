import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SignatureV4 } from '@smithy/signature-v4';
import { HttpRequest } from '@smithy/protocol-http';
import { formatUrl } from '@aws-sdk/util-format-url';
import { Sha256 } from '@aws-crypto/sha256-js';
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

// Streams the source URL into S3 using a multipart upload. Returns once the
// upload completes; throws on any failure (network, S3 5xx, source 4xx).
export async function uploadFromUrl(sourceUrl: string, key: string): Promise<{ size: number }> {
  const res = await fetch(sourceUrl);
  if (!res.ok || !res.body) {
    throw new Error(`source fetch failed: ${res.status} ${res.statusText}`);
  }
  const contentLength = Number(res.headers.get('content-length') ?? '0') || undefined;
  const contentType = res.headers.get('content-type') || 'video/mp4';

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
  return { size: contentLength ?? 0 };
}

// Lazy SigV4 signer — only built when S3_PUBLIC_ENDPOINT is configured.
let _customDomainSigner: SignatureV4 | null = null;
function getCustomDomainSigner(): SignatureV4 {
  if (_customDomainSigner) return _customDomainSigner;
  _customDomainSigner = new SignatureV4({
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
    region: config.S3_REGION,
    service: 's3',
    sha256: Sha256,
    applyChecksum: false, // not needed for presigned GET
  });
  return _customDomainSigner;
}

// Sign a GET URL against a custom Tigris vhost-alias domain
// (https://custom.example.com/<key>). The SDK's S3Client doesn't have a
// clean way to produce bucket-less URLs against a custom endpoint, so we
// drive SigV4 directly.
async function presignAgainstCustomDomain(key: string, ttlSeconds: number): Promise<string> {
  const base = new URL(config.S3_PUBLIC_ENDPOINT);
  const req = new HttpRequest({
    method: 'GET',
    protocol: base.protocol,
    hostname: base.hostname,
    ...(base.port ? { port: Number(base.port) } : {}),
    // Encode each path segment but keep '/' separators; mirrors S3's canonical
    // URI handling for keys containing slashes.
    path: '/' + key.split('/').map(encodeURIComponent).join('/'),
    headers: { host: base.host },
  });
  const signed = await getCustomDomainSigner().presign(req, { expiresIn: ttlSeconds });
  return formatUrl(signed as any);
}

// Generates a fresh presigned GET URL. Routes through the custom-domain signer
// when S3_PUBLIC_ENDPOINT is configured, otherwise the standard SDK presigner.
export async function getPresignedUrl(key: string, ttlSeconds?: number): Promise<string> {
  const ttl = ttlSeconds ?? config.S3_PRESIGN_TTL_SECONDS;
  if (config.S3_PUBLIC_ENDPOINT) {
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
