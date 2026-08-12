import { getMarketSnapshots } from './dexscreener.js';
import type { MarketSnapshot } from '../types.js';

/**
 * Bozor ma'lumoti manbai.
 *
 * Odatda DexScreener. Simulyator rejimida sun'iy manba bilan almashtiriladi —
 * shu tufayli filtr, ballchi, risk menejeri va chiqish qoidalari HAQIQIY kod
 * bo'lib qoladi, faqat kirish ma'lumoti o'zgaradi.
 */
export type MarketProvider = (mints: readonly string[]) => Promise<Map<string, MarketSnapshot>>;

let provider: MarketProvider = getMarketSnapshots;

export function setMarketProvider(p: MarketProvider): void {
  provider = p;
}

export function fetchMarkets(mints: readonly string[]): Promise<Map<string, MarketSnapshot>> {
  return provider(mints);
}
