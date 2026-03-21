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

// Calculate cost in CNY (returns string with 6 decimal places)
export function calculateCost(completionTokens: number, hasVideo: boolean): string {
  const pricePerToken = (hasVideo ? config.PRICE_WITH_VIDEO : config.PRICE_WITHOUT_VIDEO) / 1_000_000;
  return (completionTokens * pricePerToken).toFixed(6);
}
