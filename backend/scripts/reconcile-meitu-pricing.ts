// One-off reconciliation: reprice historical meitu succeeded rows that used
// the old flat 46/28 CNY-per-million rates instead of Ark's full
// (quality × hasVideo × fast-family) matrix.
//
// For each affected row:
//   1. Parse the original request_body to recover resolution + model variant
//   2. Recompute cost_yuan via calculateArkCost (the correct Ark matrix)
//   3. Patch result_data.usage.rate_cny_per_million to the correct value
//   4. Store videoQuality (was null on meitu rows)
//   5. Apply Σ delta to users.balance (subtract) and keys.quota_used (add)
//   6. Write a balance_audit entry per affected user
//
// Usage:  npx tsx scripts/reconcile-meitu-pricing.ts [--dry-run]
//
// Idempotent: only touches rows where |new_cost - current_cost| > 0.000001.

import 'dotenv/config';
import { and, eq, sql } from 'drizzle-orm';
import { db, client } from '../src/db/index.js';
import * as schema from '../src/db/schema.js';
import { calculateArkCost } from '../src/utils/cost.util.js';
import { lookupArkPricePerMillion } from '../src/utils/arkPricing.util.js';

const DRY_RUN = process.argv.includes('--dry-run');

// epsilon: treat |Δ| below this as "already reconciled / noise"
const EPSILON = 1e-6;

function parseRequestBody(raw: string | null): { model?: string; quality?: string } {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    const quality =
      typeof parsed?.resolution === 'string' ? parsed.resolution
      : typeof parsed?.quality === 'string' ? parsed.quality
      : undefined;
    const model = typeof parsed?.model === 'string' ? parsed.model : undefined;
    return { model, quality };
  } catch {
    return {};
  }
}

function patchResultDataRate(raw: string | null, rate: number): string | null {
  if (!raw) return raw;
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') {
      obj.usage = {
        ...(obj.usage ?? {}),
        ...(rate > 0 ? { rate_cny_per_million: rate } : {}),
      };
      return JSON.stringify(obj);
    }
    return raw;
  } catch {
    return raw;
  }
}

async function main() {
  const rows = await db.select().from(schema.usageLogs).where(
    and(
      eq(schema.usageLogs.provider, 'meitu'),
      eq(schema.usageLogs.status, 'succeeded'),
    ),
  );

  console.log(`[reconcile] found ${rows.length} meitu succeeded rows (dry-run=${DRY_RUN})`);

  // Per-row plan
  type Plan = {
    id: number;
    taskId: string | null;
    userId: number;
    keyId: number;
    oldCost: number;
    newCost: number;
    delta: number;  // new - old, positive = user owes more, negative = refund
    rate: number;
    quality: string;
    model: string | undefined;
    hasVideo: boolean;
    tokens: number;
  };
  const plans: Plan[] = [];
  let skippedNoprice = 0;
  let skippedNoDelta = 0;

  for (const row of rows) {
    const { model, quality: reqQuality } = parseRequestBody(row.requestBody);
    // Prefer request_body resolution. If we can't find one (truncated / malformed),
    // fall back to whatever is on the row, then '720p' — both yield 46/M so the
    // fix is a no-op for those rows anyway.
    const quality = reqQuality || row.videoQuality || '720p';
    const hasVideo = row.hasVideoInput ?? false;
    const tokens = row.completionTokens ?? 0;

    if (tokens <= 0) { skippedNoprice++; continue; }

    const rate = lookupArkPricePerMillion({ model, hasVideo, quality });
    if (rate <= 0) { skippedNoprice++; continue; }

    const newCost = parseFloat(calculateArkCost(tokens, hasVideo, quality, model || ''));
    const oldCost = parseFloat(row.costYuan || '0');
    const delta = newCost - oldCost;

    if (Math.abs(delta) < EPSILON) {
      skippedNoDelta++;
      continue;
    }

    plans.push({
      id: row.id,
      taskId: row.taskId,
      userId: row.userId,
      keyId: row.keyId,
      oldCost,
      newCost,
      delta,
      rate,
      quality,
      model,
      hasVideo,
      tokens,
    });
  }

  console.log(`[reconcile] plans=${plans.length} skipped_noprice=${skippedNoprice} skipped_nodelta=${skippedNoDelta}`);

  if (plans.length === 0) {
    console.log('[reconcile] nothing to do.');
    await client.end();
    return;
  }

  // Per-user + per-key aggregates
  const userDelta = new Map<number, number>();
  const keyDelta = new Map<number, number>();
  let totalDelta = 0;
  for (const p of plans) {
    userDelta.set(p.userId, (userDelta.get(p.userId) || 0) + p.delta);
    keyDelta.set(p.keyId, (keyDelta.get(p.keyId) || 0) + p.delta);
    totalDelta += p.delta;
  }

  console.log('\n[reconcile] per-row detail:');
  for (const p of plans) {
    const sign = p.delta > 0 ? '+' : '';
    console.log(
      `  id=${p.id} task=${p.taskId} model=${p.model} ${p.quality} hasVideo=${p.hasVideo} tokens=${p.tokens} old=${p.oldCost.toFixed(6)} new=${p.newCost.toFixed(6)} Δ=${sign}${p.delta.toFixed(6)} rate=${p.rate}`,
    );
  }

  console.log('\n[reconcile] per-user totals:');
  for (const [uid, d] of userDelta) {
    const sign = d > 0 ? '+ (用户多扣费)' : '- (退还给用户)';
    console.log(`  user_id=${uid}  Δ=${d.toFixed(6)}  ${sign}`);
  }
  console.log(`[reconcile] grand total Δ = ${totalDelta.toFixed(6)} CNY`);

  if (DRY_RUN) {
    console.log('\n[reconcile] dry-run — no writes.');
    await client.end();
    return;
  }

  // Apply in a single transaction
  await db.transaction(async (tx) => {
    // Row-level updates
    for (const p of plans) {
      const row = rows.find(r => r.id === p.id)!;
      const patched = patchResultDataRate(row.resultData, p.rate);
      await tx.update(schema.usageLogs)
        .set({
          costYuan: p.newCost.toFixed(6),
          videoQuality: p.quality,
          ...(patched !== row.resultData ? { resultData: patched } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.usageLogs.id, p.id));
    }

    // Per-user balance adjustment + audit entry
    for (const [uid, d] of userDelta) {
      // delta > 0: we under-billed, need to deduct more from user
      // delta < 0: we over-billed, refund
      const deltaStr = d.toFixed(6);
      await tx.update(schema.users)
        .set({ balance: sql`${schema.users.balance} - ${deltaStr}::numeric` })
        .where(eq(schema.users.id, uid));

      // Audit row: amount is what we APPLIED to the balance (negative for a deduction).
      await tx.insert(schema.balanceAudit).values({
        userId: uid,
        amount: (-d).toFixed(6),   // balance changed by (-d), mirror that sign
        description: `meitu 历史计费回补 (Ark pricing 矩阵修正): Δcost=${d.toFixed(4)}`,
        operatorId: uid, // self-audit: no admin operator for this automated job
      });
    }

    // Per-key quota_used adjustment (keys can have a quota cap; underbilled keys
    // need their quota_used bumped up too).
    for (const [kid, d] of keyDelta) {
      const deltaStr = d.toFixed(6);
      await tx.update(schema.keys)
        .set({ quotaUsed: sql`${schema.keys.quotaUsed} + ${deltaStr}::numeric` })
        .where(eq(schema.keys.id, kid));
    }
  });

  console.log(`\n[reconcile] applied. rows_updated=${plans.length}  users_affected=${userDelta.size}  keys_affected=${keyDelta.size}  total_delta=${totalDelta.toFixed(6)} CNY`);
  await client.end();
}

main().catch(async (err) => {
  console.error('[reconcile] error:', err);
  await client.end().catch(() => {});
  process.exit(1);
});
