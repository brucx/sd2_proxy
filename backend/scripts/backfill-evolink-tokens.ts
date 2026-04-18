// One-off backfill: populate completion_tokens and patch result_data.usage for
// historical Evolink succeeded rows that predate the synthetic-token logic.
//
// Usage:  npx tsx scripts/backfill-evolink-tokens.ts [--dry-run]
//
// Idempotent: only touches rows where status='succeeded' AND provider='evolink'
// AND (completion_tokens IS NULL OR completion_tokens = 0).

import 'dotenv/config';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { db, client } from '../src/db/index.js';
import * as schema from '../src/db/schema.js';
import {
  lookupArkPricePerMillion,
  reverseTokensFromCost,
} from '../src/utils/arkPricing.util.js';

const DRY_RUN = process.argv.includes('--dry-run');

function extractUserModel(requestBody: string | null): string | undefined {
  if (!requestBody) return undefined;
  try {
    const parsed = JSON.parse(requestBody);
    return typeof parsed?.model === 'string' ? parsed.model : undefined;
  } catch {
    return undefined;
  }
}

function patchResultData(raw: string | null, tokens: number, rate: number): string | null {
  if (!raw) return raw;
  try {
    const obj = JSON.parse(raw);
    obj.usage = {
      ...(obj.usage ?? {}),
      completion_tokens: tokens,
      total_tokens: tokens,
      ...(rate > 0 ? { rate_cny_per_million: rate } : {}),
    };
    return JSON.stringify(obj);
  } catch {
    // Don't blow up on malformed historical rows; leave them untouched.
    return raw;
  }
}

async function main() {
  const rows = await db.select().from(schema.usageLogs).where(
    and(
      eq(schema.usageLogs.provider, 'evolink'),
      eq(schema.usageLogs.status, 'succeeded'),
      or(isNull(schema.usageLogs.completionTokens), eq(schema.usageLogs.completionTokens, 0)),
    ),
  );

  console.log(`[backfill] found ${rows.length} evolink rows to process (dry-run=${DRY_RUN})`);

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const model = extractUserModel(row.requestBody);
    const costNum = parseFloat(row.costYuan || '0');
    const quality = row.videoQuality || '720p';
    const hasVideo = row.hasVideoInput ?? false;

    const rate = lookupArkPricePerMillion({ model, hasVideo, quality });
    const tokens = reverseTokensFromCost({ costYuan: costNum, model, hasVideo, quality });

    if (tokens <= 0 || rate <= 0) {
      console.log(
        `[backfill] skip id=${row.id} task=${row.taskId} — cannot price`,
        { model, hasVideo, quality, costNum, rate, tokens },
      );
      skipped++;
      continue;
    }

    const patchedResultData = patchResultData(row.resultData ?? null, tokens, rate);

    console.log(
      `[backfill] id=${row.id} task=${row.taskId} model=${model} quality=${quality} hasVideo=${hasVideo} cost=${costNum} → rate=${rate} tokens=${tokens}`,
    );

    if (!DRY_RUN) {
      await db.update(schema.usageLogs)
        .set({
          completionTokens: tokens,
          ...(patchedResultData !== row.resultData ? { resultData: patchedResultData } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.usageLogs.id, row.id));
    }
    updated++;
  }

  console.log(`[backfill] done. updated=${updated} skipped=${skipped} dry-run=${DRY_RUN}`);
  await client.end();
}

main().catch(async (err) => {
  console.error('[backfill] error:', err);
  await client.end().catch(() => {});
  process.exit(1);
});
