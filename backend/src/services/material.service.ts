// Material management — the isolation layer that makes per-token material
// ownership possible on top of upstream providers that don't natively support
// it (see design discussion in conversation that birthed this file).
//
// Lifecycle:
//   CreateAsset → insert row, fire-and-forget S3 upload → S3 ready callback
//     chains Meitu sync
//   cron backfills any failed/abandoned uploads and Meitu syncs
//   GetAsset / ListAssets → read local, filtered by key_id
//   resolveForProvider → called at /create time to swap asset:// refs into
//     the provider-appropriate form (upstream asset id for Meitu; S3
//     presigned URL for Evolink/Ark)

import { randomBytes } from 'node:crypto';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { and, desc, asc, eq, inArray, isNull, like, sql, lt } from 'drizzle-orm';
import { config } from '../config.js';
import { logger } from '../utils/logger.util.js';
import {
  isS3Enabled,
  uploadFromUrl,
  buildMaterialKey,
  inferExtFromUrl,
  getPresignedUrl,
} from '../utils/s3.util.js';
import type { Key, Material, MaterialProviderRef } from '../types.js';

// -------- Config --------

// Meitu sync is retried up to this many times (cron pass) before giving up.
const MEITU_SYNC_MAX_ATTEMPTS = 5;
// S3 ingest retried up to this many times by cron.
const MATERIAL_S3_MAX_ATTEMPTS = 5;
// How many times the in-line Meitu polling loop checks GetAsset.
const MEITU_POLL_MAX = 12;
const MEITU_POLL_INTERVAL_MS = 5_000;
// Presigned URL TTL used when handing the material to an upstream provider
// or to a client reading GetAsset. Long enough to outlive generation tasks.
const MATERIAL_PRESIGN_TTL_SECONDS = 12 * 60 * 60;

export type AssetType = 'Image' | 'Video' | 'Audio';
export const ASSET_TYPES: readonly AssetType[] = ['Image', 'Video', 'Audio'] as const;

class MeituApiError extends Error {
  code?: string;
  data?: any;

  constructor(message: string, opts?: { code?: string; data?: any }) {
    super(message);
    this.name = 'MeituApiError';
    if (opts?.code !== undefined) this.code = opts.code;
    if (opts?.data !== undefined) this.data = opts.data;
  }
}

// -------- ID generator (Meitu-shape) --------

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function pad(n: number, w = 2): string { return String(n).padStart(w, '0'); }

function randomSuffix(len = 5): string {
  const b = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ID_ALPHABET[b[i]! % ID_ALPHABET.length];
  return out;
}

export function generateMaterialId(): string {
  const d = new Date();
  const stamp =
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds());
  return `asset-${stamp}-${randomSuffix()}`;
}

// -------- Status aggregation --------

// Materials' stored `status` reflects the Meitu-strict worst-of aggregate:
// a material is only `Active` when both S3 ingest is ready AND Meitu has
// finished moderation. Evolink/Ark callers get a more permissive view
// computed at read-time (s3_status alone), since those providers don't
// require upstream asset registration.
function computeAggregateStatus(
  s3Status: string,
  meitu: MaterialProviderRef | undefined,
): { status: 'Processing' | 'Active' | 'Failed'; reason: string | null } {
  if (s3Status === 'failed') return { status: 'Failed', reason: 's3_upload_failed' };
  if (meitu) {
    if (meitu.upstreamStatus === 'Failed' || meitu.syncStatus === 'failed') {
      return { status: 'Failed', reason: meitu.lastError || 'meitu_sync_failed' };
    }
    if (s3Status === 'ready' && meitu.upstreamStatus === 'Active') {
      return { status: 'Active', reason: null };
    }
  }
  return { status: 'Processing', reason: null };
}

// Per-provider client-facing status. For Meitu use the aggregate (strict).
// For Evolink/Ark, S3 readiness is sufficient.
function clientStatusForProvider(
  material: Material,
  meitu: MaterialProviderRef | undefined,
  provider: string,
): 'Processing' | 'Active' | 'Failed' {
  if (provider === 'evolink' || provider === 'ark') {
    if (material.s3Status === 'failed') return 'Failed';
    if (material.s3Status === 'ready') return 'Active';
    return 'Processing';
  }
  return computeAggregateStatus(material.s3Status, meitu).status;
}

// -------- Create --------

export interface CreateMaterialInput {
  url: string;
  name?: string;
  assetType: AssetType;
}

export async function createMaterial(keyRecord: Key, input: CreateMaterialInput): Promise<Material> {
  if (!isS3Enabled()) {
    throw new Error('S3 not configured; material storage unavailable');
  }
  const id = generateMaterialId();
  const ext = inferExtFromUrl(input.url, input.assetType);
  const s3Key = buildMaterialKey({
    userId: keyRecord.userId,
    keyId: keyRecord.id,
    materialId: id,
    ext,
  });

  const [inserted] = await db.insert(schema.materials).values({
    id,
    keyId: keyRecord.id,
    userId: keyRecord.userId,
    name: (input.name || '').slice(0, 64),
    assetType: input.assetType,
    s3Key,
    sourceUrl: input.url,
    s3Status: 'pending',
    status: 'Processing',
  }).returning();

  const material = inserted!;

  // Fire-and-forget — Meitu sync is chained by the S3 success path.
  kickoffS3Upload(material).catch(err =>
    logger.error({ err, materialId: id }, '[material] S3 kickoff failed'),
  );

  return material;
}

async function kickoffS3Upload(material: Material): Promise<void> {
  if (!material.s3Key || !material.sourceUrl) return;
  try {
    const { size, mime } = await uploadFromUrl(
      material.sourceUrl,
      material.s3Key,
      material.assetType === 'Video' ? 'video/mp4'
        : material.assetType === 'Audio' ? 'audio/mpeg'
        : 'image/png',
    );
    await db.update(schema.materials)
      .set({ s3Status: 'ready', size: size || null, mime, s3Error: null, updatedAt: new Date() })
      .where(eq(schema.materials.id, material.id));
    await recomputeAggregateStatus(material.id);
    kickoffMeituSync(material.id).catch(err =>
      logger.error({ err, materialId: material.id }, '[material] Meitu sync kickoff failed'),
    );
    logger.info(`[material] S3 ingest ready: ${material.id}`);
  } catch (err: any) {
    await db.update(schema.materials)
      .set({
        s3Status: 'failed',
        s3Attempts: sql`${schema.materials.s3Attempts} + 1`,
        s3Error: String(err?.message || err).slice(0, 1000),
        updatedAt: new Date(),
      })
      .where(eq(schema.materials.id, material.id));
    await recomputeAggregateStatus(material.id);
    logger.error({ err, materialId: material.id }, '[material] S3 ingest failed');
  }
}

// -------- Meitu sync --------

async function meituPost(path: string, body: any): Promise<any> {
  const res = await fetch(`${config.UPSTREAM_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.MEITU_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok) {
    const code = data?.ResponseMetadata?.Error?.Code || data?.Result?.Error?.Code;
    const msg = data?.ResponseMetadata?.Error?.Message || data?.Result?.Error?.Message || `HTTP ${res.status}`;
    throw new MeituApiError(`meitu ${path} failed: ${msg}`, { code, data });
  }
  return data;
}

async function kickoffMeituSync(materialId: string): Promise<void> {
  const [material] = await db.select().from(schema.materials)
    .where(eq(schema.materials.id, materialId))
    .limit(1);
  if (!material || material.s3Status !== 'ready' || !material.s3Key) return;

  const [existingRef] = await db.select().from(schema.materialProviderRefs)
    .where(and(
      eq(schema.materialProviderRefs.materialId, materialId),
      eq(schema.materialProviderRefs.provider, 'meitu'),
    ))
    .limit(1);

  if (existingRef?.upstreamAssetId) {
    if (existingRef.syncStatus === 'done' && existingRef.upstreamStatus === 'Active') {
      await recomputeAggregateStatus(materialId);
      return;
    }
    await db.update(schema.materialProviderRefs)
      .set({
        syncStatus: 'pending',
        syncAttempts: sql`${schema.materialProviderRefs.syncAttempts} + 1`,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.materialProviderRefs.materialId, materialId),
        eq(schema.materialProviderRefs.provider, 'meitu'),
      ));
    await pollMeituAsset(material, existingRef.upstreamAssetId);
    return;
  }

  try {
    await db.insert(schema.materialProviderRefs).values({
      materialId,
      provider: 'meitu',
      syncStatus: 'pending',
      syncAttempts: 0,
    }).onConflictDoNothing();
  } catch (err) {
    logger.error({ err, materialId }, '[meitu-sync] claim insert failed');
    return;
  }

  const claimed = await db.update(schema.materialProviderRefs)
    .set({
      syncStatus: 'claiming',
      syncAttempts: sql`${schema.materialProviderRefs.syncAttempts} + 1`,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(schema.materialProviderRefs.materialId, materialId),
      eq(schema.materialProviderRefs.provider, 'meitu'),
      inArray(schema.materialProviderRefs.syncStatus, ['pending', 'failed']),
      isNull(schema.materialProviderRefs.upstreamAssetId),
    ))
    .returning({ materialId: schema.materialProviderRefs.materialId });
  if (claimed.length === 0) return;

  await createAndPollMeituAsset(material);
}

async function createAndPollMeituAsset(material: Material): Promise<void> {
  try {
    // External callers (Meitu's ingest service) must go through the standard
    // endpoint — the custom-domain alias presign is currently returning
    // SignatureDoesNotMatch from Tigris for third-party fetches.
    if (!material.s3Key) throw new Error('s3 key missing');
    const presigned = await getPresignedUrl(material.s3Key, MATERIAL_PRESIGN_TTL_SECONDS, { forceStandardEndpoint: true });
    const created = await meituPost('/api/v1/open/CreateAsset', {
      URL: presigned,
      Name: material.name || material.id,
      AssetType: material.assetType,
    });
    let upstreamId = created?.Result?.Id;
    if (!upstreamId) throw new Error('CreateAsset returned no Id');

    await db.update(schema.materialProviderRefs)
      .set({
        upstreamAssetId: upstreamId,
        upstreamStatus: 'Processing',
        syncStatus: 'pending',
        lastError: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.materialProviderRefs.materialId, material.id),
        eq(schema.materialProviderRefs.provider, 'meitu'),
      ));

    await pollMeituAsset(material, upstreamId);
  } catch (err: any) {
    const duplicateId = extractMeituDuplicateAssetId(err);
    if (duplicateId) {
      await db.update(schema.materialProviderRefs)
        .set({
          upstreamAssetId: duplicateId,
          upstreamStatus: 'Processing',
          syncStatus: 'pending',
          lastError: null,
          updatedAt: new Date(),
        })
        .where(and(
          eq(schema.materialProviderRefs.materialId, material.id),
          eq(schema.materialProviderRefs.provider, 'meitu'),
        ));
      await pollMeituAsset(material, duplicateId);
      return;
    }

    await db.update(schema.materialProviderRefs)
      .set({
        syncStatus: 'failed',
        lastError: String(err?.message || err).slice(0, 1000),
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.materialProviderRefs.materialId, material.id),
        eq(schema.materialProviderRefs.provider, 'meitu'),
      ));
    await recomputeAggregateStatus(material.id);
    logger.error({ err, materialId: material.id }, '[meitu-sync] failed');
  }
}

async function pollMeituAsset(material: Material, upstreamId: string): Promise<void> {
  try {
    for (let i = 0; i < MEITU_POLL_MAX; i++) {
      const got = await meituPost('/api/v1/open/GetAsset', { Id: upstreamId });
      const r = got?.Result;
      if (!r) {
        if (i < MEITU_POLL_MAX - 1) await sleep(MEITU_POLL_INTERVAL_MS);
        continue;
      }
      const upstreamStatus: string = r.Status || 'Processing';
      const upstreamUrl: string = r.URL || '';
      const groupId: string = r.GroupId || '';

      if (upstreamStatus === 'Active' || upstreamStatus === 'Failed') {
        await db.update(schema.materialProviderRefs)
          .set({
            upstreamStatus,
            upstreamUrl: upstreamUrl || null,
            syncStatus: upstreamStatus === 'Active' ? 'done' : 'failed',
            lastError: upstreamStatus === 'Failed'
              ? (r.Error?.Message || r.Error?.Code || 'rejected by meitu')
              : null,
            syncedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(
            eq(schema.materialProviderRefs.materialId, material.id),
            eq(schema.materialProviderRefs.provider, 'meitu'),
          ));
        if (groupId) {
          await db.update(schema.materials)
            .set({ groupId, updatedAt: new Date() })
            .where(and(
              eq(schema.materials.id, material.id),
              eq(schema.materials.groupId, ''),
            ));
        }
        await recomputeAggregateStatus(material.id);
        logger.info(`[meitu-sync] ${material.id} → ${upstreamStatus}`);
        return;
      }
      if (i < MEITU_POLL_MAX - 1) await sleep(MEITU_POLL_INTERVAL_MS);
    }
    logger.info(`[meitu-sync] ${material.id} still Processing after poll budget, deferring to cron`);
  } catch (err: any) {
    await db.update(schema.materialProviderRefs)
      .set({
        syncStatus: 'failed',
        lastError: String(err?.message || err).slice(0, 1000),
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.materialProviderRefs.materialId, material.id),
        eq(schema.materialProviderRefs.provider, 'meitu'),
      ));
    await recomputeAggregateStatus(material.id);
    logger.error({ err, materialId: material.id }, '[meitu-sync] failed');
  }
}

function extractMeituDuplicateAssetId(err: unknown): string | null {
  if (!(err instanceof MeituApiError)) return null;
  const message = `${err.code || ''} ${err.message || ''}`;
  if (!/已存在相同资源|already exists|duplicate/i.test(message)) return null;

  const candidates = [
    err.data?.Result?.Id,
    err.data?.Result?.AssetId,
    err.data?.ResponseMetadata?.Error?.AssetId,
    typeof err.data?.ResponseMetadata?.Error?.Message === 'string'
      ? err.data.ResponseMetadata.Error.Message
      : null,
    err.message,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const match = /(asset-\d{14}-[a-z0-9]+)/i.exec(candidate);
    if (match) return match[1]!.toLowerCase();
  }
  return null;
}

async function recomputeAggregateStatus(materialId: string): Promise<void> {
  const [m] = await db.select().from(schema.materials)
    .where(eq(schema.materials.id, materialId))
    .limit(1);
  if (!m) return;
  const [meitu] = await db.select().from(schema.materialProviderRefs)
    .where(and(
      eq(schema.materialProviderRefs.materialId, materialId),
      eq(schema.materialProviderRefs.provider, 'meitu'),
    ))
    .limit(1);
  const agg = computeAggregateStatus(m.s3Status, meitu);
  await db.update(schema.materials)
    .set({ status: agg.status, rejectReason: agg.reason, updatedAt: new Date() })
    .where(eq(schema.materials.id, materialId));
}

// -------- Read --------

export async function getMaterialForToken(
  keyRecord: Key,
  id: string,
): Promise<{ material: Material; meitu?: MaterialProviderRef | undefined } | null> {
  const [m] = await db.select().from(schema.materials)
    .where(and(
      eq(schema.materials.id, id),
      eq(schema.materials.keyId, keyRecord.id),
      isNull(schema.materials.deletedAt),
    ))
    .limit(1);
  if (!m) return null;
  const [meitu] = await db.select().from(schema.materialProviderRefs)
    .where(and(
      eq(schema.materialProviderRefs.materialId, id),
      eq(schema.materialProviderRefs.provider, 'meitu'),
    ))
    .limit(1);
  return { material: m, meitu };
}

export interface ListMaterialsInput {
  groupType?: string;                // reserved; Meitu only defines 'AIGC' here
  statuses?: string[];               // 'Processing' | 'Active' | 'Failed' (client-facing)
  name?: string;                     // substring match
  pageNumber: number;                // 1-based
  pageSize: number;                  // capped to 100
  sortBy?: 'CreateTime' | 'UpdateTime' | 'GroupId';
  sortOrder?: 'Asc' | 'Desc';
}

export async function listMaterialsForToken(
  keyRecord: Key,
  input: ListMaterialsInput,
): Promise<{ items: Array<{ material: Material; meitu?: MaterialProviderRef | undefined }>; totalCount: number }> {
  const pageSize = Math.min(Math.max(input.pageSize || 20, 1), 100);
  const pageNumber = Math.max(input.pageNumber || 1, 1);

  const conditions = [
    eq(schema.materials.keyId, keyRecord.id),
    isNull(schema.materials.deletedAt),
  ];
  if (input.name) conditions.push(like(schema.materials.name, `%${input.name}%`));
  if (input.statuses && input.statuses.length > 0) {
    conditions.push(inArray(schema.materials.status, input.statuses));
  }

  const sortCol = input.sortBy === 'UpdateTime'
    ? schema.materials.updatedAt
    : input.sortBy === 'GroupId'
    ? schema.materials.groupId
    : schema.materials.createdAt;
  const sortFn = input.sortOrder === 'Asc' ? asc : desc;

  const offset = (pageNumber - 1) * pageSize;

  const [rows, countRows] = await Promise.all([
    db.select().from(schema.materials)
      .where(and(...conditions))
      .orderBy(sortFn(sortCol))
      .limit(pageSize)
      .offset(offset),
    db.select({ c: sql<number>`count(*)::int` }).from(schema.materials)
      .where(and(...conditions)),
  ]);

  if (rows.length === 0) {
    return { items: [], totalCount: countRows[0]?.c ?? 0 };
  }
  const ids = rows.map(r => r.id);
  const refs = await db.select().from(schema.materialProviderRefs)
    .where(and(
      inArray(schema.materialProviderRefs.materialId, ids),
      eq(schema.materialProviderRefs.provider, 'meitu'),
    ));
  const refByMaterial = new Map(refs.map(r => [r.materialId, r]));

  return {
    items: rows.map(m => ({ material: m, meitu: refByMaterial.get(m.id) })),
    totalCount: countRows[0]?.c ?? 0,
  };
}

// -------- Client-facing serialization (Meitu/Volcengine shape) --------

// Build a fresh presigned GET URL for a material. Returns '' when the material
// is not yet ready (UX-parity with Meitu's GetAsset, which returns "" while
// Processing).
export async function presignMaterial(material: Material): Promise<string> {
  if (!material.s3Key || material.s3Status !== 'ready') return '';
  try {
    // GetAsset.URL is typically consumed by clients via browser/http — same
    // Tigris custom-domain unreliability applies, so prefer standard endpoint.
    return await getPresignedUrl(material.s3Key, MATERIAL_PRESIGN_TTL_SECONDS, { forceStandardEndpoint: true });
  } catch (err) {
    logger.error({ err, materialId: material.id }, '[material] presign failed');
    return '';
  }
}

// Serialize to the same shape Meitu's GetAsset.Result returns. Uses per-
// provider status computation so Evolink/Ark callers see Active as soon as
// S3 is ready instead of waiting on Meitu moderation.
export async function serializeForClient(
  entry: { material: Material; meitu?: MaterialProviderRef | undefined },
  providerForStatus: string,
): Promise<Record<string, any>> {
  const { material, meitu } = entry;
  const url = await presignMaterial(material);
  const status = clientStatusForProvider(material, meitu, providerForStatus);
  const error = status === 'Failed' && material.rejectReason
    ? { Code: 'processing_failed', Message: material.rejectReason }
    : undefined;
  return {
    Id: material.id,
    Name: material.name,
    URL: url,
    AssetType: material.assetType,
    GroupId: material.groupId,
    Status: status,
    ...(error ? { Error: error } : {}),
    CreateTime: material.createdAt.toISOString().replace(/\.\d+Z$/, 'Z'),
    UpdateTime: material.updatedAt.toISOString().replace(/\.\d+Z$/, 'Z'),
    ProjectName: material.projectName,
  };
}

// -------- Provider resolution (for createHandler) --------

export type ResolvedMaterialRef =
  | { kind: 'asset_id'; value: string }  // raw upstream asset id (no asset:// prefix)
  | { kind: 'url'; value: string }       // directly-usable URL for the provider
  | { kind: 'not_ready'; reason: string }
  | { kind: 'not_found' };

export async function resolveForProvider(
  keyRecord: Key,
  materialId: string,
  provider: string,
): Promise<ResolvedMaterialRef> {
  const entry = await getMaterialForToken(keyRecord, materialId);

  if (!entry) {
    // Asset not found in this token's local library. It might be a public /
    // upstream asset (e.g. from the virtual-human library). Try resolving via
    // Meitu's GetAsset with the global API key.
    return resolveUpstreamPublicAsset(materialId, provider);
  }

  const { material, meitu } = entry;

  if (material.s3Status === 'failed') return { kind: 'not_ready', reason: material.s3Error || 's3_failed' };
  if (material.s3Status !== 'ready') return { kind: 'not_ready', reason: 'ingest_in_progress' };

  if (provider === 'meitu') {
    if (!meitu || meitu.syncStatus === 'failed') {
      return { kind: 'not_ready', reason: meitu?.lastError || 'meitu_sync_failed' };
    }
    if (meitu.upstreamStatus !== 'Active' || !meitu.upstreamAssetId) {
      return { kind: 'not_ready', reason: 'meitu_moderation_pending' };
    }
    return { kind: 'asset_id', value: meitu.upstreamAssetId };
  }

  // evolink, ark (until asset API opens), or any unknown provider → S3 URL.
  // Force standard endpoint: the signed URL is consumed by an external
  // upstream crawler, and the custom-domain alias presign is currently
  // unreliable for third-party fetches.
  if (!material.s3Key) return { kind: 'not_ready', reason: 's3_missing' };
  const url = await getPresignedUrl(material.s3Key, MATERIAL_PRESIGN_TTL_SECONDS, { forceStandardEndpoint: true });
  return { kind: 'url', value: url };
}

// Resolve a public / upstream asset that isn't in any token's local library.
// For Meitu: pass through the asset ID as-is (Meitu upstream recognises its
// own public asset IDs natively).
// For Evolink/Ark: call Meitu's GetAsset to obtain the asset URL, then hand
// the URL to the provider.
async function resolveUpstreamPublicAsset(
  materialId: string,
  provider: string,
): Promise<ResolvedMaterialRef> {
  // For Meitu, just pass through — upstream knows all its own asset IDs
  // (both user-uploaded and public library assets).
  if (provider === 'meitu') {
    return { kind: 'asset_id', value: materialId };
  }

  // For Evolink / Ark, we need a URL. Ask Meitu's upstream GetAsset for it.
  try {
    const data = await meituPost('/api/v1/open/GetAsset', { Id: materialId });
    const result = data?.Result || data;
    if (result?.Status === 'Active' && result?.URL) {
      return { kind: 'url', value: result.URL };
    }
    if (result?.Status === 'Processing') {
      return { kind: 'not_ready', reason: 'public_asset_processing' };
    }
    if (result?.Status === 'Failed') {
      return { kind: 'not_ready', reason: result?.Error?.Message || 'public_asset_failed' };
    }
    // If we got a response but no URL, treat as not_found
    return { kind: 'not_found' };
  } catch {
    // GetAsset failed — the ID is genuinely unknown
    return { kind: 'not_found' };
  }
}

// -------- Cron hooks --------

export async function retryMaterialS3Uploads(batchSize = 10): Promise<number> {
  if (!isS3Enabled()) return 0;
  const candidates = await db.select().from(schema.materials)
    .where(and(
      eq(schema.materials.s3Status, 'failed'),
      lt(schema.materials.s3Attempts, MATERIAL_S3_MAX_ATTEMPTS),
      isNull(schema.materials.deletedAt),
    ))
    .limit(batchSize);
  for (const m of candidates) {
    // Reset to pending so kickoffS3Upload can proceed; attempts counter
    // preserved. If kickoff fails again it'll bump the attempt count.
    await db.update(schema.materials)
      .set({ s3Status: 'pending', updatedAt: new Date() })
      .where(eq(schema.materials.id, m.id));
    kickoffS3Upload(m).catch(err =>
      logger.error({ err, materialId: m.id }, '[material] S3 retry kickoff failed'),
    );
  }
  return candidates.length;
}

export async function retryMeituSyncs(batchSize = 10): Promise<number> {
  const pending = await db.select().from(schema.materialProviderRefs)
    .where(and(
      eq(schema.materialProviderRefs.provider, 'meitu'),
      inArray(schema.materialProviderRefs.syncStatus, ['pending', 'failed']),
      lt(schema.materialProviderRefs.syncAttempts, MEITU_SYNC_MAX_ATTEMPTS),
    ))
    .limit(batchSize);
  for (const ref of pending) {
    kickoffMeituSync(ref.materialId).catch(err =>
      logger.error({ err, materialId: ref.materialId }, '[meitu-sync] retry kickoff failed'),
    );
  }
  return pending.length;
}

export async function kickoffReadyMaterialsWithoutMeituRef(batchSize = 10): Promise<number> {
  const rows = await db.select({ id: schema.materials.id })
    .from(schema.materials)
    .leftJoin(
      schema.materialProviderRefs,
      and(
        eq(schema.materialProviderRefs.materialId, schema.materials.id),
        eq(schema.materialProviderRefs.provider, 'meitu'),
      ),
    )
    .where(and(
      eq(schema.materials.s3Status, 'ready'),
      isNull(schema.materials.deletedAt),
      isNull(schema.materialProviderRefs.materialId),
    ))
    .limit(batchSize);

  for (const row of rows) {
    kickoffMeituSync(row.id).catch(err =>
      logger.error({ err, materialId: row.id }, '[meitu-sync] missing-ref kickoff failed'),
    );
  }
  return rows.length;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
