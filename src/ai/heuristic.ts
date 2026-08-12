import { config } from '../config.js';
import type { AiAnalysis, ScreenResult, Verdict } from '../types.js';

/**
 * Gemini kaliti bo'lmaganda ishlaydigan zaxira ballchi.
 *
 * Bu "soxta AI" emas — bu ochiq formula. Har bir ko'rsatkich uchun ball
 * qo'shiladi yoki ayiriladi, natija tushuntirish bilan qaytadi. Shu tufayli
 * botni kalitsiz ishga tushirib, butun quvurni (filtr → ball → risk →
 * virtual savdo) ishlayotgan holda ko'rish mumkin.
 *
 * Gemini'dan farqi: bu narrativni, nom taqlidini yoki kontekstni tushunmaydi.
 * Real ishlatish uchun Gemini kalitini qo'ying.
 */
export function heuristicScore(r: ScreenResult): AiAnalysis {
  let score = 50;
  const reasons: string[] = [];
  const redFlags: string[] = [];

  const liq = r.market.liquidityUsd ?? 0;
  const mcap = r.market.marketCapUsd ?? 0;
  const vol5m = r.market.volume5mUsd ?? 0;
  const buys = r.market.txns5mBuys ?? 0;
  const sells = r.market.txns5mSells ?? 0;

  // Likvidlik — chiqa olish imkoniyati
  if (liq >= config.filter.minLiquidityUsd * 4) {
    score += 12;
    reasons.push('likvidlik kuchli');
  } else if (liq >= config.filter.minLiquidityUsd * 2) {
    score += 6;
    reasons.push('likvidlik yetarli');
  }

  // Likvidlik/mcap nisbati — juda past bo'lsa chiqish qiyin
  if (mcap > 0) {
    const ratio = (liq / mcap) * 100;
    if (ratio < 3) {
      score -= 15;
      redFlags.push('likvidlik kapitalizatsiyaga nisbatan juda kichik');
    } else if (ratio > 12) {
      score += 8;
      reasons.push('likvidlik/mcap nisbati sog\'lom');
    }
  }

  // Savdo faolligi
  if (vol5m >= config.filter.minVolume5mUsd * 5) {
    score += 12;
    reasons.push('savdo hajmi yuqori');
  } else if (vol5m >= config.filter.minVolume5mUsd * 2) {
    score += 5;
  }

  // Xarid/sotuv balansi
  const total = buys + sells;
  if (total >= 20) {
    const buyShare = buys / total;
    if (buyShare >= 0.6) {
      score += 10;
      reasons.push('xaridlar sotuvlardan ustun');
    } else if (buyShare <= 0.35) {
      score -= 18;
      redFlags.push('chiqish bosimi: sotuvlar ustun');
    }
  }

  // Xolder konsentratsiyasi — eng muhim risk
  if (r.chain.top10Pct !== null) {
    if (r.chain.top10Pct <= 15) {
      score += 15;
      reasons.push('xolderlar yaxshi taqsimlangan');
    } else if (r.chain.top10Pct <= 25) {
      score += 5;
    } else {
      score -= 12;
      redFlags.push(`top-10 ulushi yuqori (${r.chain.top10Pct.toFixed(1)}%)`);
    }
  } else {
    score -= 8;
    redFlags.push('xolder taqsimoti noma\'lum');
  }

  // Xolderlar soni
  if (r.chain.holderCount !== null) {
    if (r.chain.holderCount >= config.filter.minHolders * 4) {
      score += 10;
      reasons.push('xolderlar bazasi keng');
    } else if (r.chain.holderCount >= config.filter.minHolders * 2) {
      score += 4;
    }
  } else {
    score -= 5;
    redFlags.push('xolderlar soni noma\'lum');
  }

  // Dev tarixi
  if (r.dev) {
    if (r.dev.rugs > 0) {
      score -= 25 * r.dev.rugs;
      redFlags.push(`dev oldin ${r.dev.rugs} marta rug qilgan`);
    }
    if (r.dev.survivors > 0) {
      score += 10;
      reasons.push(`dev ${r.dev.survivors} ta omon qolgan token chiqargan`);
    }
  } else {
    score -= 5;
    redFlags.push('dev tarixi noma\'lum');
  }

  // Zanjir belgilari
  if (r.chain.mintAuthorityPresent === true) {
    score -= 40;
    redFlags.push('mint authority faol');
  }
  if (r.chain.freezeAuthorityPresent === true) {
    score -= 40;
    redFlags.push('freeze authority faol');
  }
  if (r.chain.mintAuthorityPresent === null) {
    score -= 10;
    redFlags.push('zanjir tekshirilmadi (RPC yo\'q)');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  const verdict: Verdict = score >= 70 ? 'enter' : score >= 40 ? 'watch' : 'avoid';

  const reasoning =
    (reasons.length > 0 ? `Ijobiy: ${reasons.join(', ')}. ` : '') +
    (redFlags.length > 0 ? `Xavf: ${redFlags.join(', ')}.` : 'Sezilarli xavf topilmadi.');

  return {
    mint: r.mint,
    score,
    verdict,
    narrative: 'evristik baholash (Gemini kaliti yo\'q)',
    reasoning: reasoning.trim(),
    redFlags,
  };
}
