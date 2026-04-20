import { config } from '../config.js';

// Detect if request body contains video input.
// Accepts both Ark-shape (`content[]` with video_url items) and flat-array
// shape (`body.video_urls`) since aivideoapi / evolink clients can use either.
export function detectVideoInput(body: any): boolean {
  try {
    const contents = body?.content || [];
    const fromContent = Array.isArray(contents)
      && contents.some((item: any) => item.type === 'video_url' || item.type === 'video');
    if (fromContent) return true;
    return Array.isArray(body?.video_urls) && body.video_urls.length > 0;
  } catch {
    return false;
  }
}

// -- Meitu billing: per completion_tokens --
export function calculateMeituCost(completionTokens: number, hasVideo: boolean): string {
  const pricePerToken = (hasVideo ? config.PRICE_WITH_VIDEO : config.PRICE_WITHOUT_VIDEO) / 1_000_000;
  return (completionTokens * pricePerToken).toFixed(6);
}

// -- Ark billing: per completion_tokens, varies by model variant, hasVideo, quality --
// See docs/ark/pricing.md.
export function calculateArkCost(
  completionTokens: number,
  hasVideo: boolean,
  quality: string,
  model: string,
): string {
  const variant = /fast/i.test(model) ? '2.0-fast' : '2.0';
  const q = ['480p', '720p', '1080p'].includes(quality) ? quality : '720p';
  const key = `${variant}:${hasVideo}:${q}`;
  const table = config.ARK_PRICE_PER_MILLION;
  const rate = table[key] ?? table[`${variant}:${hasVideo}:720p`] ?? (hasVideo ? 28 : 46);
  return (completionTokens * rate! / 1_000_000).toFixed(6);
}

// -- Evolink billing: prefer credits from upstream, fallback to per-second table --
const EVOLINK_PRICE_PER_SECOND_USD: Record<string, number> = {
  '480p': 0.092,
  '720p': 0.199,
  '1080p': 0.449,
};

// Convert Evolink credits → CNY using configured exchange rate.
// $100 = 6800 Credits ⇒ 68 credits/USD (configurable via EVOLINK_CREDITS_PER_USD).
export function creditsToCny(credits: number): string {
  const usd = credits / config.EVOLINK_CREDITS_PER_USD;
  return (usd * config.USD_TO_CNY_RATE).toFixed(6);
}

export function calculateEvolinkCost(duration: number, quality: string): string {
  const pricePerSecond = EVOLINK_PRICE_PER_SECOND_USD[quality] || EVOLINK_PRICE_PER_SECOND_USD['720p']!;
  const usdCost = duration * pricePerSecond;
  const cnyCost = usdCost * config.USD_TO_CNY_RATE;
  return cnyCost.toFixed(6);
}

// -- Aivideoapi.ai billing: per-second, split by hasVideo × resolution --
// Source: docs/aivideo/aivideo.md pricing table. For with-video calls the
// upstream bills `(input_video_duration + output_duration) × rate`; since we
// don't surface the input video duration anywhere, we approximate with
// output-only — this undercounts by a few seconds on video-reference calls.
export function calculateAivideoCost(duration: number, quality: string, hasVideo: boolean): string {
  const q = ['480p', '720p', '1080p'].includes(quality) ? quality : '720p';
  const key = `${hasVideo}:${q}`;
  const table = config.AIVIDEO_PRICE_PER_SECOND_USD;
  const rate = table[key] ?? table[`${hasVideo}:720p`] ?? (hasVideo ? 0.125 : 0.21);
  const cnyCost = duration * rate! * config.USD_TO_CNY_RATE;
  return cnyCost.toFixed(6);
}

// -- Unified cost calculator --
export function calculateCost(
  provider: string,
  params: {
    completionTokens?: number | undefined;
    hasVideo?: boolean | undefined;
    duration?: number | undefined;
    quality?: string | undefined;
    credits?: number | undefined;
    model?: string | undefined;
  }
): string {
  if (provider === 'evolink') {
    // Prefer authoritative credits from upstream — handles fast/standard,
    // web_search surcharge, and quality automatically.
    if (typeof params.credits === 'number' && params.credits > 0) {
      return creditsToCny(params.credits);
    }
    return calculateEvolinkCost(params.duration || 5, params.quality || '720p');
  }
  if (provider === 'ark') {
    return calculateArkCost(
      params.completionTokens || 0,
      params.hasVideo || false,
      params.quality || '720p',
      params.model || '',
    );
  }
  if (provider === 'aivideo') {
    return calculateAivideoCost(
      params.duration || 5,
      params.quality || '720p',
      params.hasVideo || false,
    );
  }
  return calculateMeituCost(params.completionTokens || 0, params.hasVideo || false);
}

