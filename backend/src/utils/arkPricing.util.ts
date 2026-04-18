// Ark pricing helpers. All providers settle in CNY-per-million-tokens terms
// (see docs/ark/pricing.md). For non-Ark providers we reverse-map their real
// cost into an Ark-equivalent token count so the client sees a uniform
// `usage.completion_tokens` + `usage.rate_cny_per_million` contract.

import { config } from '../config.js';

export type ModelFamily = '2.0' | '2.0-fast';
export type Quality = '480p' | '720p' | '1080p';

export function normalizeModelFamily(userModel?: string): ModelFamily | null {
  if (!userModel) return null;
  const s = userModel.toLowerCase();
  if (s.includes('fast')) return '2.0-fast';
  if (s.includes('2-0') || s.includes('2.0')) return '2.0';
  return null;
}

export function isFastModel(userModel?: string): boolean {
  return normalizeModelFamily(userModel) === '2.0-fast';
}

export function normalizeQuality(quality?: string): Quality | null {
  const q = (quality || '').toLowerCase();
  if (q === '480p' || q === '720p' || q === '1080p') return q;
  return null;
}

// Ark's published CNY-per-million-token rate for a given task spec. Returns 0
// when the (family, hasVideo, quality) triple isn't in the price table, which
// currently only happens for 1080p on seedance-2.0-fast (unsupported upstream).
export function lookupArkPricePerMillion(input: {
  model?: string | undefined;
  hasVideo: boolean;
  quality?: string | undefined;
}): number {
  const family = normalizeModelFamily(input.model);
  const quality = normalizeQuality(input.quality) || '720p';
  if (!family) return 0;
  const key = `${family}:${input.hasVideo}:${quality}`;
  return config.ARK_PRICE_PER_MILLION[key] ?? 0;
}

// Reverse-map an actual CNY cost to an Ark-equivalent token count. Used for
// Evolink (which charges in credits) so clients see a consistent
// `cost = tokens × rate / 1e6` contract across providers. Returns 0 when the
// rate is unknown or the cost is non-positive.
export function reverseTokensFromCost(input: {
  costYuan: number;
  model?: string | undefined;
  hasVideo: boolean;
  quality?: string | undefined;
}): number {
  if (!Number.isFinite(input.costYuan) || input.costYuan <= 0) return 0;
  const rate = lookupArkPricePerMillion({
    model: input.model,
    hasVideo: input.hasVideo,
    quality: input.quality,
  });
  if (rate <= 0) return 0;
  return Math.round((input.costYuan / rate) * 1_000_000);
}
