import { fetchJson } from '../util/http.js';
import { RateLimiter, chunk } from '../util/rate.js';
import { createLogger } from '../logger.js';
import type { MarketSnapshot } from '../types.js';

const log = createLogger('dexscreener');

/**
 * DexScreener bepul, kalitsiz. Rasmiy limit ~300 so'rov/daqiqa.
 * Xavfsizlik uchun 3/s bilan chegaralaymiz va bir so'rovda 30 tagacha
 * token so'raymiz — bu limitni deyarli sarflamaydi.
 */
const limiter = new RateLimiter(3);
const BATCH = 30;

interface DsPair {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  baseToken?: { address?: string; symbol?: string };
  priceUsd?: string;
  priceNative?: string;
  liquidity?: { usd?: number };
  marketCap?: number;
  fdv?: number;
  volume?: { m5?: number; h1?: number };
  txns?: { m5?: { buys?: number; sells?: number } };
  pairCreatedAt?: number;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Bitta token uchun eng likvid juftlikni tanlaydi. */
function bestPair(pairs: DsPair[]): DsPair | null {
  if (pairs.length === 0) return null;
  return pairs.reduce((best, p) =>
    (p.liquidity?.usd ?? 0) > (best.liquidity?.usd ?? 0) ? p : best,
  );
}

function pairToSnapshot(p: DsPair | null): MarketSnapshot {
  if (!p) {
    return {
      priceUsd: null,
      priceNativeSol: null,
      liquidityUsd: null,
      marketCapUsd: null,
      volume5mUsd: null,
      volume1hUsd: null,
      txns5mBuys: null,
      txns5mSells: null,
      pairCreatedAt: null,
      dexId: null,
      pairAddress: null,
    };
  }
  return {
    priceUsd: toNum(p.priceUsd),
    priceNativeSol: toNum(p.priceNative),
    liquidityUsd: toNum(p.liquidity?.usd),
    marketCapUsd: toNum(p.marketCap) ?? toNum(p.fdv),
    volume5mUsd: toNum(p.volume?.m5),
    volume1hUsd: toNum(p.volume?.h1),
    txns5mBuys: toNum(p.txns?.m5?.buys),
    txns5mSells: toNum(p.txns?.m5?.sells),
    pairCreatedAt: p.pairCreatedAt ? new Date(p.pairCreatedAt) : null,
    dexId: p.dexId ?? null,
    pairAddress: p.pairAddress ?? null,
  };
}

/**
 * Bir necha tokenning bozor holatini bitta so'rovda oladi.
 * Javob topilmagan tokenlar uchun bo'sh snapshot qaytadi (null qiymatlar bilan) —
 * bu odatda "hali DEX'da juftlik yo'q" degani, xato emas.
 */
export async function getMarketSnapshots(
  mints: readonly string[],
): Promise<Map<string, MarketSnapshot>> {
  const out = new Map<string, MarketSnapshot>();
  if (mints.length === 0) return out;

  for (const group of chunk(mints, BATCH)) {
    await limiter.acquire();
    const url = `https://api.dexscreener.com/latest/dex/tokens/${group.join(',')}`;

    try {
      const res = await fetchJson<{ pairs: DsPair[] | null }>(url, {}, { attempts: 2 });
      const pairs = res?.pairs ?? [];

      const byMint = new Map<string, DsPair[]>();
      for (const p of pairs) {
        const addr = p.baseToken?.address;
        if (!addr) continue;
        const list = byMint.get(addr);
        if (list) list.push(p);
        else byMint.set(addr, [p]);
      }

      for (const mint of group) {
        out.set(mint, pairToSnapshot(bestPair(byMint.get(mint) ?? [])));
      }
    } catch (err) {
      log.warn('bozor so\'rovi muvaffaqiyatsiz', { count: group.length, error: String(err) });
      for (const mint of group) out.set(mint, pairToSnapshot(null));
    }
  }

  return out;
}

export async function getMarketSnapshot(mint: string): Promise<MarketSnapshot> {
  const map = await getMarketSnapshots([mint]);
  return map.get(mint) ?? pairToSnapshot(null);
}
