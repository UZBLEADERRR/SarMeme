import { randomUUID } from 'node:crypto';
import type { AiAnalysis, DevReputation, NewTokenEvent, Position, ScreenResult } from '../types.js';
import type { AnalysisRow, CheckRow, JournalRow, Store, TokenRow } from './types.js';

/**
 * Xotiradagi baza — Supabase sozlanmagan bo'lsa ishlatiladi.
 *
 * Ma'lumot jarayon qayta ishga tushganda yo'qoladi. Bu demo va sinov uchun
 * ataylab shunday: kalitsiz ishga tushirib, tizim nima qilishini ko'rish
 * mumkin. Uzoq muddatli ishlash uchun Supabase kerak — dev reputatsiya
 * bazasi vaqt o'tishi bilan to'planib qiymat hosil qiladi.
 *
 * Xotira cheksiz o'smasligi uchun eski yozuvlar kesib turiladi.
 */

const MAX_TOKENS = 5000;
const MAX_ROWS = 2000;

export function createMemoryStore(): Store {
  const tokens = new Map<string, TokenRow>();
  const checks: CheckRow[] = [];
  const analyses: AnalysisRow[] = [];
  const journalRows: JournalRow[] = [];
  const positions = new Map<string, Position>();
  const devs = new Map<string, DevReputation>();
  const state = new Map<string, unknown>();
  let journalId = 0;

  const trim = <T>(arr: T[]) => {
    if (arr.length > MAX_ROWS) arr.splice(0, arr.length - MAX_ROWS);
  };

  const trimTokens = () => {
    if (tokens.size <= MAX_TOKENS) return;
    const sorted = [...tokens.values()].sort(
      (a, b) => a.launchedAt.getTime() - b.launchedAt.getTime(),
    );
    for (const t of sorted.slice(0, tokens.size - MAX_TOKENS)) tokens.delete(t.mint);
  };

  return {
    kind: 'memory',

    async insertToken(ev: NewTokenEvent) {
      if (tokens.has(ev.mint)) return;

      if (ev.creator) {
        const dev = devs.get(ev.creator);
        if (dev) dev.tokensCreated += 1;
        else
          devs.set(ev.creator, {
            address: ev.creator,
            tokensCreated: 1,
            rugs: 0,
            survivors: 0,
            bestLiquidityUsd: 0,
            avgLifetimeMin: null,
          });
      }

      tokens.set(ev.mint, {
        mint: ev.mint,
        symbol: ev.symbol,
        name: ev.name,
        creator: ev.creator,
        status: 'new',
        statusReason: null,
        launchedAt: ev.launchedAt,
        updatedAt: new Date(),
      });
      trimTokens();
    },

    async fetchTokensForScreening(minAgeMinutes, maxAgeMinutes, limit) {
      const now = Date.now();
      return [...tokens.values()]
        .filter((t) => {
          if (t.status !== 'new') return false;
          const age = (now - t.launchedAt.getTime()) / 60_000;
          return age >= minAgeMinutes && age <= maxAgeMinutes;
        })
        .sort((a, b) => b.launchedAt.getTime() - a.launchedAt.getTime())
        .slice(0, limit)
        .map((t) => ({
          mint: t.mint,
          symbol: t.symbol,
          creator: t.creator,
          launchedAt: t.launchedAt,
        }));
    },

    async setTokenStatus(mint, status, reason) {
      const t = tokens.get(mint);
      if (!t) return;
      t.status = status;
      t.statusReason = reason ?? null;
      t.updatedAt = new Date();
    },

    async expireStaleTokens(maxAgeMinutes) {
      const cutoff = Date.now() - maxAgeMinutes * 60_000;
      let n = 0;
      for (const t of tokens.values()) {
        if (t.status === 'new' && t.launchedAt.getTime() < cutoff) {
          t.status = 'dead';
          t.statusReason = 'oyna yopildi';
          n++;
        }
      }
      return n;
    },

    async fetchTokensForAi(limit) {
      return [...tokens.values()]
        .filter((t) => t.status === 'watching')
        .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
        .slice(0, limit)
        .map((t) => ({ mint: t.mint, symbol: t.symbol, creator: t.creator }));
    },

    async fetchTokensForOutcome(olderThanHours, limit) {
      const cutoff = Date.now() - olderThanHours * 3_600_000;
      return [...tokens.values()]
        .filter(
          (t) =>
            (t.status === 'watching' || t.status === 'traded') &&
            t.launchedAt.getTime() < cutoff,
        )
        .slice(0, limit)
        .map((t) => ({ mint: t.mint, creator: t.creator }));
    },

    async recordCheck(r: ScreenResult) {
      checks.push({
        mint: r.mint,
        checkedAt: new Date(),
        mintAuthority: r.chain.mintAuthorityPresent,
        freezeAuthority: r.chain.freezeAuthorityPresent,
        liquidityUsd: r.market.liquidityUsd,
        marketCapUsd: r.market.marketCapUsd,
        volume5mUsd: r.market.volume5mUsd,
        priceUsd: r.market.priceUsd,
        holderCount: r.chain.holderCount,
        top10Pct: r.chain.top10Pct,
        ageMinutes: r.ageMinutes,
        passed: r.passed,
        flags: r.flags,
      });
      trim(checks);
    },

    async latestCheck(mint) {
      for (let i = checks.length - 1; i >= 0; i--) {
        const c = checks[i];
        if (c && c.mint === mint) return c;
      }
      return null;
    },

    async getDev(address) {
      return devs.get(address) ?? null;
    },

    async recordDevOutcome(address, outcome, liquidityUsd) {
      const dev = devs.get(address);
      if (!dev) return;
      if (outcome === 'rug') dev.rugs += 1;
      else dev.survivors += 1;
      if (liquidityUsd > dev.bestLiquidityUsd) dev.bestLiquidityUsd = liquidityUsd;
    },

    async recordAnalysis(a: AiAnalysis, model: string) {
      analyses.push({ ...a, model, createdAt: new Date() });
      trim(analyses);
    },

    async openPosition(p) {
      const pos: Position = {
        id: randomUUID(),
        mint: p.mint,
        symbol: p.symbol,
        mode: p.mode,
        status: 'open',
        entryScore: p.entryScore,
        solIn: p.solIn,
        entryPrice: p.entryPrice,
        qty: p.qty,
        entryAt: new Date(),
        peakPrice: p.entryPrice,
        exitPrice: null,
        solOut: null,
        exitAt: null,
        exitReason: null,
        pnlSol: null,
        pnlPct: null,
      };
      positions.set(pos.id, pos);
      return pos;
    },

    async listOpenPositions() {
      return [...positions.values()]
        .filter((p) => p.status === 'open')
        .sort((a, b) => a.entryAt.getTime() - b.entryAt.getTime());
    },

    async updatePeak(id, peak) {
      const p = positions.get(id);
      if (p) p.peakPrice = peak;
    },

    async closePosition(id, exitPrice, solOut, reason, pnlSol, pnlPct) {
      const p = positions.get(id);
      if (!p) return;
      p.status = 'closed';
      p.exitPrice = exitPrice;
      p.solOut = solOut;
      p.exitAt = new Date();
      p.exitReason = reason;
      p.pnlSol = pnlSol;
      p.pnlPct = pnlPct;
    },

    async pnlSince(since) {
      const closed = [...positions.values()].filter(
        (p) => p.status === 'closed' && p.exitAt && p.exitAt >= since,
      );
      return {
        realizedSol: closed.reduce((s, p) => s + (p.pnlSol ?? 0), 0),
        trades: closed.length,
        wins: closed.filter((p) => (p.pnlSol ?? 0) > 0).length,
      };
    },

    async tradesOpenedSince(since) {
      return [...positions.values()].filter((p) => p.entryAt >= since).length;
    },

    async hasPositionFor(mint) {
      return [...positions.values()].some((p) => p.mint === mint);
    },

    async journal(entry) {
      journalRows.push({
        id: ++journalId,
        positionId: entry.positionId ?? null,
        mint: entry.mint ?? null,
        author: entry.author ?? 'system',
        note: entry.note,
        createdAt: new Date(),
      });
      trim(journalRows);
    },

    async getState<T>(key: string, fallback: T): Promise<T> {
      return (state.get(key) as T) ?? fallback;
    },

    async setState(key, value) {
      state.set(key, value);
    },

    // ── Dashboard ────────────────────────────────────────────────────────
    async recentTokens(limit) {
      return [...tokens.values()]
        .sort((a, b) => b.launchedAt.getTime() - a.launchedAt.getTime())
        .slice(0, limit);
    },

    async recentChecks(limit) {
      return checks.slice(-limit).reverse();
    },

    async recentAnalyses(limit) {
      return analyses.slice(-limit).reverse();
    },

    async recentJournal(limit) {
      return journalRows.slice(-limit).reverse();
    },

    async recentClosedPositions(limit) {
      return [...positions.values()]
        .filter((p) => p.status === 'closed')
        .sort((a, b) => (b.exitAt?.getTime() ?? 0) - (a.exitAt?.getTime() ?? 0))
        .slice(0, limit);
    },

    async statusCounts() {
      const out: Record<string, number> = {};
      for (const t of tokens.values()) out[t.status] = (out[t.status] ?? 0) + 1;
      return out;
    },

    async topDevs(limit) {
      return [...devs.values()]
        .filter((d) => d.tokensCreated > 1 || d.rugs > 0)
        .sort((a, b) => b.tokensCreated - a.tokensCreated)
        .slice(0, limit);
    },
  };
}
