import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { screen } from '../filter/screener.js';
import { analyzeBatch } from '../ai/analyst.js';
import { evaluateEntry } from '../risk/manager.js';
import { enter, manageOpenPositions } from '../trade/paper.js';
import { getMarketSnapshots } from '../market/dexscreener.js';
import { notify } from '../telegram/bot.js';
import {
  expireStaleTokens,
  fetchTokensForAi,
  fetchTokensForOutcome,
  fetchTokensForScreening,
  journal,
  latestCheck,
  recordAnalysis,
  recordCheck,
  recordDevOutcome,
  setTokenStatus,
} from '../db/repo.js';
import type { ScreenResult } from '../types.js';

const log = createLogger('pipeline');

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── 1) Skrining: deterministik filtr ────────────────────────────────────────

export async function screenTick(): Promise<void> {
  const expired = await expireStaleTokens(config.filter.maxAgeMinutes);
  if (expired > 0) log.debug('oynadan chiqqan tokenlar yopildi', { count: expired });

  const candidates = await fetchTokensForScreening(
    config.filter.minAgeMinutes,
    config.filter.maxAgeMinutes,
    60,
  );
  if (candidates.length === 0) return;

  const results = await screen(candidates);

  for (const r of results) {
    await recordCheck(r);
    if (r.passed) {
      await setTokenStatus(r.mint, 'watching', 'filtrdan o\'tdi');
    } else {
      // "no_market_data" — hali juftlik yo'q bo'lishi mumkin, keyin qayta ko'ramiz.
      const retryable = r.flags.length === 1 && r.flags[0] === 'no_market_data';
      if (!retryable) await setTokenStatus(r.mint, 'screened', r.flags.join(', '));
    }
  }
}

// ── 2) AI tahlili: guruh bilan, kamdan-kam ──────────────────────────────────

export async function aiTick(): Promise<void> {
  const tokens = await fetchTokensForAi(config.gemini.batchSize);
  if (tokens.length === 0) return;

  // AI'ga tekshiruv natijalarini uzatish uchun ularni bazadan qayta yig'amiz.
  const items: { screen: ScreenResult; symbol: string | null; name: string | null }[] = [];

  for (const t of tokens) {
    const check = await latestCheck(t.mint);
    if (!check) continue;
    items.push({
      symbol: t.symbol,
      name: null,
      screen: checkRowToScreenResult(t.mint, check),
    });
  }

  if (items.length === 0) return;

  let analyses;
  try {
    const out = await analyzeBatch(items);
    analyses = out.analyses;
    for (const a of analyses) await recordAnalysis(a, config.gemini.modelFast, out.raw);
  } catch (err) {
    log.error('AI tahlili muvaffaqiyatsiz', { error: String(err) });
    return; // tokenlar 'watching' da qoladi, keyingi siklda qayta uriniladi
  }

  for (const a of analyses) {
    if (a.verdict !== 'enter' || a.score < config.minAiScore) {
      await setTokenStatus(a.mint, 'screened', `AI: ${a.verdict} (${a.score})`);
      continue;
    }

    const decision = await evaluateEntry(a.mint, a.score);
    if (!decision.allowed) {
      log.info('risk rad etdi', { mint: a.mint, reason: decision.reason });
      await journal({
        mint: a.mint,
        note: `Kirish rad etildi: ${decision.reason} (AI ball ${a.score})`,
      });
      await setTokenStatus(a.mint, 'screened', `risk: ${decision.reason}`);
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

function checkRowToScreenResult(mint: string, row: Record<string, unknown>): ScreenResult {
  const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  return {
    mint,
    passed: Boolean(row.passed),
    flags: Array.isArray(row.flags) ? (row.flags as string[]) : [],
    ageMinutes: Number(row.age_minutes ?? 0),
    market: {
      priceUsd: n(row.price_usd),
      priceNativeSol: null,
      liquidityUsd: n(row.liquidity_usd),
      marketCapUsd: n(row.market_cap_usd),
      volume5mUsd: n(row.volume_5m_usd),
      volume1hUsd: null,
      txns5mBuys: null,
      txns5mSells: null,
      pairCreatedAt: null,
      dexId: null,
      pairAddress: null,
    },
    chain: {
      mintAuthorityPresent: row.mint_authority === null ? null : Boolean(row.mint_authority),
      freezeAuthorityPresent: row.freeze_authority === null ? null : Boolean(row.freeze_authority),
      decimals: null,
      supply: null,
      holderCount: n(row.holder_count),
      top10Pct: n(row.top10_pct),
    },
    dev: null,
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
  const tokens = await fetchTokensForOutcome(6, 40);
  if (tokens.length === 0) return;

  const markets = await getMarketSnapshots(tokens.map((t) => t.mint));
  const rugThreshold = config.filter.minLiquidityUsd / 4;

  let rugs = 0;
  let survivors = 0;

  for (const t of tokens) {
    const liq = markets.get(t.mint)?.liquidityUsd ?? null;
    const isRug = liq === null || liq < rugThreshold;

    if (isRug) {
      await setTokenStatus(t.mint, 'dead', `likvidlik ${liq === null ? 'yo\'q' : liq.toFixed(0)}`);
      if (t.creator) await recordDevOutcome(t.creator, 'rug', liq ?? 0);
      rugs++;
    } else {
      await setTokenStatus(t.mint, 'survived', `likvidlik ${liq.toFixed(0)}`);
      if (t.creator) await recordDevOutcome(t.creator, 'survivor', liq);
      survivors++;
    }
  }

  log.info('natijalar qayd etildi', { rugs, survivors });
}
