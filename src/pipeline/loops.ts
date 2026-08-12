import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { screen } from '../filter/screener.js';
import { analyzeBatch } from '../ai/analyst.js';
import { evaluateEntry } from '../risk/manager.js';
import { enter, manageOpenPositions } from '../trade/paper.js';
import { fetchMarkets } from '../market/prices.js';
import { notify } from '../notify.js';
import { getStore } from '../store/index.js';
import type { DevReputation, ScreenResult } from '../types.js';
import type { CheckRow } from '../store/index.js';

const log = createLogger('pipeline');

const engineName = () =>
  config.capabilities.ai === 'gemini' ? config.gemini.modelFast : 'heuristic';

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── 1) Skrining: deterministik filtr ────────────────────────────────────────

export async function screenTick(): Promise<void> {
  const expired = await getStore().expireStaleTokens(config.filter.maxAgeMinutes);
  if (expired > 0) log.debug('oynadan chiqqan tokenlar yopildi', { count: expired });

  const candidates = await getStore().fetchTokensForScreening(
    config.filter.minAgeMinutes,
    config.filter.maxAgeMinutes,
    60,
  );
  if (candidates.length === 0) return;

  const results = await screen(candidates);

  for (const r of results) {
    await getStore().recordCheck(r);
    if (r.passed) {
      await getStore().setTokenStatus(r.mint, 'watching', 'filtrdan o\'tdi');
    } else {
      // "no_market_data" — hali juftlik yo'q bo'lishi mumkin, keyin qayta ko'ramiz.
      const retryable = r.flags.length === 1 && r.flags[0] === 'no_market_data';
      if (!retryable) await getStore().setTokenStatus(r.mint, 'screened', r.flags.join(', '));
    }
  }
}

// ── 2) AI tahlili: guruh bilan, kamdan-kam ──────────────────────────────────

export async function aiTick(): Promise<void> {
  const tokens = await getStore().fetchTokensForAi(config.gemini.batchSize);
  if (tokens.length === 0) return;

  // AI'ga tekshiruv natijalarini uzatish uchun ularni bazadan qayta yig'amiz.
  const items: { screen: ScreenResult; symbol: string | null; name: string | null }[] = [];

  for (const t of tokens) {
    const check = await getStore().latestCheck(t.mint);
    if (!check) continue;
    const dev = t.creator ? await getStore().getDev(t.creator) : null;
    items.push({
      symbol: t.symbol,
      name: null,
      screen: checkToScreenResult(check, dev),
    });
  }

  if (items.length === 0) return;

  let analyses;
  try {
    const out = await analyzeBatch(items);
    analyses = out.analyses;
    for (const a of analyses) await getStore().recordAnalysis(a, engineName(), out.raw);
  } catch (err) {
    log.error('AI tahlili muvaffaqiyatsiz', { error: String(err) });
    return; // tokenlar 'watching' da qoladi, keyingi siklda qayta uriniladi
  }

  for (const a of analyses) {
    if (a.verdict !== 'enter' || a.score < config.minAiScore) {
      await getStore().setTokenStatus(a.mint, 'screened', `AI: ${a.verdict} (${a.score})`);
      continue;
    }

    const decision = await evaluateEntry(a.mint, a.score);
    if (!decision.allowed) {
      log.info('risk rad etdi', { mint: a.mint, reason: decision.reason });
      await getStore().journal({
        mint: a.mint,
        note: `Kirish rad etildi: ${decision.reason} (AI ball ${a.score})`,
      });
      await getStore().setTokenStatus(a.mint, 'screened', `risk: ${decision.reason}`);
      continue;
    }

    const item = items.find((i) => i.screen.mint === a.mint);
    const pos = await enter({
      mint: a.mint,
      symbol: item?.symbol ?? null,
      score: a.score,
      sizeSol: decision.sizeSol,
    });

    if (pos) {
      await notify(
        [
          `🟢 <b>KIRISH</b> (paper)`,
          `<b>${esc(item?.symbol ?? a.mint.slice(0, 8))}</b> · ball <b>${a.score}</b>`,
          `Miqdor: ${decision.sizeSol.toFixed(4)} SOL`,
          '',
          `<i>${esc(a.reasoning)}</i>`,
          a.redFlags.length > 0 ? `⚠️ ${esc(a.redFlags.join(', '))}` : '',
          '',
          `<code>${esc(a.mint)}</code>`,
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }
  }
}

/** Bazadagi tekshiruv yozuvini AI/evristika kutadigan shaklga qaytaradi. */
function checkToScreenResult(c: CheckRow, dev: DevReputation | null): ScreenResult {
  return {
    mint: c.mint,
    passed: c.passed,
    flags: c.flags,
    ageMinutes: c.ageMinutes,
    market: {
      priceUsd: c.priceUsd,
      priceNativeSol: null,
      liquidityUsd: c.liquidityUsd,
      marketCapUsd: c.marketCapUsd,
      volume5mUsd: c.volume5mUsd,
      volume1hUsd: null,
      txns5mBuys: null,
      txns5mSells: null,
      pairCreatedAt: null,
      dexId: null,
      pairAddress: null,
    },
    chain: {
      mintAuthorityPresent: c.mintAuthority,
      freezeAuthorityPresent: c.freezeAuthority,
      decimals: null,
      supply: null,
      holderCount: c.holderCount,
      top10Pct: c.top10Pct,
    },
    dev,
  };
}

// ── 3) Pozitsiyalarni boshqarish ────────────────────────────────────────────

export async function positionsTick(): Promise<void> {
  const exits = await manageOpenPositions();

  for (const e of exits) {
    const icon = e.pnlSol >= 0 ? '✅' : '🔴';
    await notify(
      [
        `${icon} <b>CHIQISH</b> (paper)`,
        `<b>${esc(e.position.symbol ?? e.position.mint.slice(0, 8))}</b>`,
        `Sabab: ${esc(e.reason)}`,
        `Natija: ${e.pnlSol >= 0 ? '+' : ''}${e.pnlSol.toFixed(4)} SOL (${e.pnlPct.toFixed(1)}%)`,
        '',
        `<code>${esc(e.position.mint)}</code>`,
      ].join('\n'),
    );
  }
}

// ── 4) Dev reputatsiyasini to'ldirish (bepul, RPC'siz) ──────────────────────

/**
 * Eskirgan tokenlarni ko'rib chiqib, dev natijasini qayd etadi.
 * Bu bizning "insider graf" bazamizning poydevori: har kuni bepul o'sib boradi,
 * va bir marta rug qilgan dev keyingi safar filtrda darrov to'siladi.
 */
export async function outcomeTick(): Promise<void> {
  const tokens = await getStore().fetchTokensForOutcome(6, 40);
  if (tokens.length === 0) return;

  const markets = await fetchMarkets(tokens.map((t) => t.mint));
  const rugThreshold = config.filter.minLiquidityUsd / 4;

  let rugs = 0;
  let survivors = 0;

  for (const t of tokens) {
    const liq = markets.get(t.mint)?.liquidityUsd ?? null;
    const isRug = liq === null || liq < rugThreshold;

    if (isRug) {
      await getStore().setTokenStatus(t.mint, 'dead', `likvidlik ${liq === null ? 'yo\'q' : liq.toFixed(0)}`);
      if (t.creator) await getStore().recordDevOutcome(t.creator, 'rug', liq ?? 0);
      rugs++;
    } else {
      await getStore().setTokenStatus(t.mint, 'survived', `likvidlik ${liq.toFixed(0)}`);
      if (t.creator) await getStore().recordDevOutcome(t.creator, 'survivor', liq);
      survivors++;
    }
  }

  log.info('natijalar qayd etildi', { rugs, survivors });
}
