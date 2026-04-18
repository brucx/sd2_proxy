import { config } from '../config.js';

// Detect if request body contains video input
export function detectVideoInput(body: any): boolean {
  try {
    const contents = body?.content || [];
    return Array.isArray(contents) && contents.some((item: any) => item.type === 'video_url' || item.type === 'video');
  } catch {
    return false;
  }
}

// -- Ark billing: per completion_tokens --
export function calculateArkCost(completionTokens: number, hasVideo: boolean): string {
  const pricePerToken = (hasVideo ? config.PRICE_WITH_VIDEO : config.PRICE_WITHOUT_VIDEO) / 1_000_000;
  return (completionTokens * pricePerToken).toFixed(6);
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

// -- Unified cost calculator --
export function calculateCost(
  provider: string,
  params: {
    completionTokens?: number;
    hasVideo?: boolean;
    duration?: number;
    quality?: string;
    credits?: number;
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
  return calculateArkCost(params.completionTokens || 0, params.hasVideo || false);
}

