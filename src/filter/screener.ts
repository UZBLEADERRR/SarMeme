import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { UNKNOWN_CHAIN, inspectChain } from '../chain/provider.js';
import { fetchMarkets } from '../market/prices.js';
import { getStore } from '../store/index.js';
import type { ChainSnapshot, ScreenResult } from '../types.js';

const log = createLogger('screener');

export interface Candidate {
  mint: string;
  symbol: string | null;
  creator: string | null;
  launchedAt: Date;
}

/**
 * Deterministik filtr — tizimning eng muhim qismi.
 *
 * Bu yerda AI yo'q va bo'lmasligi ham kerak: bu qoidalar takrorlanuvchi,
 * tekshiriladigan va tez. Ular kunlik tokenlarning ~99% ini rad etadi,
 * shundan keyingina qolganlari AI tahliliga boradi.
 */
export async function screen(candidates: readonly Candidate[]): Promise<ScreenResult[]> {
  if (candidates.length === 0) return [];

  // Bozor ma'lumotini guruh bilan olamiz — bitta so'rovda 30 tagacha token.
  const markets = await fetchMarkets(candidates.map((c) => c.mint));
  const results: ScreenResult[] = [];

  for (const c of candidates) {
    const market = markets.get(c.mint) ?? null;
    const ageMinutes = (Date.now() - c.launchedAt.getTime()) / 60_000;
    const flags: string[] = [];

    // 1) DEX'da juftlik yo'q — hali savdo boshlanmagan yoki o'lgan.
    //    RPC sarflamaymiz, darrov chiqamiz.
    if (!market || market.liquidityUsd === null) {
      results.push({
        mint: c.mint,
        passed: false,
        flags: ['no_market_data'],
        ageMinutes,
        market: market ?? emptyMarket(),
        chain: UNKNOWN_CHAIN,
        dev: null,
      });
      continue;
    }

    // 2) Arzon bozor tekshiruvlari — RPC'gacha.
    if (market.liquidityUsd < config.filter.minLiquidityUsd) flags.push('low_liquidity');
    if ((market.volume5mUsd ?? 0) < config.filter.minVolume5mUsd) flags.push('low_volume');

    if (flags.length > 0) {
      results.push({
        mint: c.mint,
        passed: false,
        flags,
        ageMinutes,
        market,
        chain: UNKNOWN_CHAIN,
        dev: null,
      });
      continue;
    }

    // 3) Dev reputatsiyasi — bepul, o'z bazamizdan.
    const dev = c.creator ? await getStore().getDev(c.creator) : null;
    if (dev && dev.rugs > config.filter.maxDevRugs) {
      results.push({
        mint: c.mint,
        passed: false,
        flags: [`dev_rugs_${dev.rugs}`],
        ageMinutes,
        market,
        chain: UNKNOWN_CHAIN,
        dev,
      });
      continue;
    }
    if (!dev) flags.push('dev_unknown');

    // 4) Zanjir tekshiruvi — eng qimmat qism, faqat shu yergacha yetganlar uchun.
    const chain = await inspectChain(c.mint);

    if (chain.mintAuthorityPresent === true) flags.push('mint_authority_active');
    if (chain.freezeAuthorityPresent === true) flags.push('freeze_authority_active');
    if (chain.mintAuthorityPresent === null) flags.push('mint_info_unavailable');

    if (chain.top10Pct !== null && chain.top10Pct > config.filter.maxTop10Pct) {
      flags.push(`top10_${chain.top10Pct.toFixed(1)}pct`);
    }
    if (chain.holderCount !== null && chain.holderCount < config.filter.minHolders) {
      flags.push(`few_holders_${chain.holderCount}`);
    }
    if (chain.holderCount === null) flags.push('holder_count_unknown');

    // Sotuvlar xaridlardan 2 barobar ko'p bo'lsa — chiqish bosimi.
    const buys = market.txns5mBuys ?? 0;
    const sells = market.txns5mSells ?? 0;
    if (sells > buys * 2 && sells > 10) flags.push('sell_pressure');

    // Yumshoq belgilar rad etmaydi — ular AI'ga kontekst sifatida uzatiladi.
    const soft = new Set([
      'dev_unknown',
      'holder_count_unknown',
      'mint_info_unavailable',
      'sell_pressure',
    ]);
    const hardFails = flags.filter((f) => !soft.has(f));

    results.push({
      mint: c.mint,
      passed: hardFails.length === 0,
      flags,
      ageMinutes,
      market,
      chain,
      dev,
    });
  }

  const passed = results.filter((r) => r.passed).length;
  log.info('skrining tugadi', { tekshirildi: results.length, otdi: passed });
  return results;
}

function emptyMarket() {
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
