import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '../logger.js';
import type { AiAnalysis, DevReputation, NewTokenEvent, Position, ScreenResult } from '../types.js';
import type { AnalysisRow, CheckRow, JournalRow, Store, TokenRow } from './types.js';

const log = createLogger('supabase');

type Row = Record<string, unknown>;

const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const b = (v: unknown): boolean | null => (v === null || v === undefined ? null : Boolean(v));

function toPosition(r: Row): Position {
  return {
    id: r.id as string,
    mint: r.mint as string,
    symbol: (r.symbol as string | null) ?? null,
    mode: r.mode as 'paper' | 'live',
    status: r.status as 'open' | 'closed',
    entryScore: n(r.entry_score),
    solIn: Number(r.sol_in),
    entryPrice: Number(r.entry_price),
    qty: Number(r.qty),
    entryAt: new Date(r.entry_at as string),
    peakPrice: n(r.peak_price),
    exitPrice: n(r.exit_price),
    solOut: n(r.sol_out),
    exitAt: r.exit_at ? new Date(r.exit_at as string) : null,
    exitReason: (r.exit_reason as string | null) ?? null,
    pnlSol: n(r.pnl_sol),
    pnlPct: n(r.pnl_pct),
  };
}

function toCheck(r: Row): CheckRow {
  return {
    mint: r.mint as string,
    checkedAt: new Date(r.checked_at as string),
    mintAuthority: b(r.mint_authority),
    freezeAuthority: b(r.freeze_authority),
    liquidityUsd: n(r.liquidity_usd),
    marketCapUsd: n(r.market_cap_usd),
    volume5mUsd: n(r.volume_5m_usd),
    priceUsd: n(r.price_usd),
    holderCount: n(r.holder_count),
    top10Pct: n(r.top10_pct),
    ageMinutes: Number(r.age_minutes ?? 0),
    passed: Boolean(r.passed),
    flags: Array.isArray(r.flags) ? (r.flags as string[]) : [],
  };
}

export function createSupabaseStore(url: string, serviceKey: string): Store {
  const db: SupabaseClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  /** So'rov xatosini logga yozib, bo'sh natija qaytaradi — bot to'xtamasin. */
  const rows = async (
    label: string,
    q: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  ): Promise<Row[]> => {
    const res = await q;
    if (res.error) {
      log.warn(`${label}: ${res.error.message}`);
      return [];
    }
    return (res.data as Row[]) ?? [];
  };

  const store: Store = {
    kind: 'supabase',

    async insertToken(ev: NewTokenEvent) {
      if (ev.creator) {
        const existing = await rows(
          'touchDev',
          db.from('devs').select('tokens_created').eq('address', ev.creator).limit(1),
        );
        if (existing.length > 0) {
          await db
            .from('devs')
            .update({
              tokens_created: Number(existing[0]?.tokens_created ?? 0) + 1,
              last_seen_at: new Date().toISOString(),
            })
            .eq('address', ev.creator);
        } else {
          await db.from('devs').insert({ address: ev.creator, tokens_created: 1 });
        }
      }

      const { error } = await db.from('tokens').upsert(
        {
          mint: ev.mint,
          symbol: ev.symbol,
          name: ev.name,
          creator: ev.creator,
          uri: ev.uri,
          pool: ev.pool,
          launched_at: ev.launchedAt.toISOString(),
          status: 'new',
        },
        { onConflict: 'mint', ignoreDuplicates: true },
      );
      if (error) log.warn('token yozilmadi', { mint: ev.mint, error: error.message });
    },

    async fetchTokensForScreening(minAgeMinutes, maxAgeMinutes, limit) {
      const now = Date.now();
      const data = await rows(
        'fetchTokensForScreening',
        db
          .from('tokens')
          .select('mint, symbol, creator, launched_at')
          .eq('status', 'new')
          .gte('launched_at', new Date(now - maxAgeMinutes * 60_000).toISOString())
          .lte('launched_at', new Date(now - minAgeMinutes * 60_000).toISOString())
          .order('launched_at', { ascending: false })
          .limit(limit),
      );
      return data.map((r) => ({
        mint: r.mint as string,
        symbol: (r.symbol as string | null) ?? null,
        creator: (r.creator as string | null) ?? null,
        launchedAt: new Date(r.launched_at as string),
      }));
    },

    async setTokenStatus(mint, status, reason) {
      await db
        .from('tokens')
        .update({ status, status_reason: reason ?? null, updated_at: new Date().toISOString() })
        .eq('mint', mint);
    },

    async expireStaleTokens(maxAgeMinutes) {
      const data = await rows(
        'expireStaleTokens',
        db
          .from('tokens')
          .update({
            status: 'dead',
            status_reason: 'oyna yopildi',
            updated_at: new Date().toISOString(),
          })
          .eq('status', 'new')
          .lt('launched_at', new Date(Date.now() - maxAgeMinutes * 60_000).toISOString())
          .select('mint'),
      );
      return data.length;
    },

    async fetchTokensForAi(limit) {
      const data = await rows(
        'fetchTokensForAi',
        db
          .from('tokens')
          .select('mint, symbol, creator')
          .eq('status', 'watching')
          .order('updated_at', { ascending: true })
          .limit(limit),
      );
      return data.map((r) => ({
        mint: r.mint as string,
        symbol: (r.symbol as string | null) ?? null,
        creator: (r.creator as string | null) ?? null,
      }));
    },

    async fetchTokensForOutcome(olderThanHours, limit) {
      const data = await rows(
        'fetchTokensForOutcome',
        db
          .from('tokens')
          .select('mint, creator')
          .in('status', ['watching', 'traded'])
          .lt('launched_at', new Date(Date.now() - olderThanHours * 3_600_000).toISOString())
          .limit(limit),
      );
      return data.map((r) => ({
        mint: r.mint as string,
        creator: (r.creator as string | null) ?? null,
      }));
    },

    async recordCheck(r: ScreenResult) {
      const { error } = await db.from('token_checks').insert({
        mint: r.mint,
        mint_authority: r.chain.mintAuthorityPresent,
        freeze_authority: r.chain.freezeAuthorityPresent,
        liquidity_usd: r.market.liquidityUsd,
        market_cap_usd: r.market.marketCapUsd,
        volume_5m_usd: r.market.volume5mUsd,
        price_usd: r.market.priceUsd,
        holder_count: r.chain.holderCount,
        top10_pct: r.chain.top10Pct,
        age_minutes: r.ageMinutes,
        passed: r.passed,
        flags: r.flags,
      });
      if (error) log.warn('tekshiruv yozilmadi', { mint: r.mint, error: error.message });
    },

    async latestCheck(mint) {
      const data = await rows(
        'latestCheck',
        db
          .from('token_checks')
          .select('*')
          .eq('mint', mint)
          .order('checked_at', { ascending: false })
          .limit(1),
      );
      return data[0] ? toCheck(data[0]) : null;
    },

    async getDev(address) {
      const data = await rows('getDev', db.from('devs').select('*').eq('address', address).limit(1));
      const r = data[0];
      if (!r) return null;
      return {
        address: r.address as string,
        tokensCreated: Number(r.tokens_created ?? 0),
        rugs: Number(r.rugs ?? 0),
        survivors: Number(r.survivors ?? 0),
        bestLiquidityUsd: Number(r.best_liquidity_usd ?? 0),
        avgLifetimeMin: n(r.avg_lifetime_min),
      };
    },

    async recordDevOutcome(address, outcome, liquidityUsd) {
      const dev = await store.getDev(address);
      if (!dev) return;
      const patch: Row = { last_seen_at: new Date().toISOString() };
      if (outcome === 'rug') patch.rugs = dev.rugs + 1;
      else patch.survivors = dev.survivors + 1;
      if (liquidityUsd > dev.bestLiquidityUsd) patch.best_liquidity_usd = liquidityUsd;
      await db.from('devs').update(patch).eq('address', address);
    },

    async recordAnalysis(a: AiAnalysis, model: string, raw: unknown) {
      const { error } = await db.from('analyses').insert({
        mint: a.mint,
        model,
        score: a.score,
        verdict: a.verdict,
        narrative: a.narrative,
        reasoning: a.reasoning,
        red_flags: a.redFlags,
        raw: raw as never,
      });
      if (error) log.warn('tahlil yozilmadi', { mint: a.mint, error: error.message });
    },

    async openPosition(p) {
      const res = await db
        .from('positions')
        .insert({
          mint: p.mint,
          symbol: p.symbol,
          mode: p.mode,
          entry_score: p.entryScore,
          sol_in: p.solIn,
          entry_price: p.entryPrice,
          qty: p.qty,
          peak_price: p.entryPrice,
        })
        .select('*')
        .limit(1);
      if (res.error || !res.data?.[0]) {
        throw new Error(`openPosition: ${res.error?.message ?? 'javob bo\'sh'}`);
      }
      return toPosition(res.data[0] as Row);
    },

    async listOpenPositions() {
      const data = await rows(
        'listOpenPositions',
        db.from('positions').select('*').eq('status', 'open').order('entry_at', { ascending: true }),
      );
      return data.map(toPosition);
    },

    async updatePeak(id, peak) {
      await db.from('positions').update({ peak_price: peak }).eq('id', id);
    },

    async closePosition(id, exitPrice, solOut, reason, pnlSol, pnlPct) {
      await db
        .from('positions')
        .update({
          status: 'closed',
          exit_price: exitPrice,
          sol_out: solOut,
          exit_at: new Date().toISOString(),
          exit_reason: reason,
          pnl_sol: pnlSol,
          pnl_pct: pnlPct,
        })
        .eq('id', id);
    },

    async pnlSince(since) {
      const data = await rows(
        'pnlSince',
        db
          .from('positions')
          .select('pnl_sol')
          .eq('status', 'closed')
          .gte('exit_at', since.toISOString()),
      );
      return {
        realizedSol: data.reduce((s, r) => s + Number(r.pnl_sol ?? 0), 0),
        trades: data.length,
        wins: data.filter((r) => Number(r.pnl_sol ?? 0) > 0).length,
      };
    },

    async tradesOpenedSince(since) {
      const data = await rows(
        'tradesOpenedSince',
        db.from('positions').select('id').gte('entry_at', since.toISOString()),
      );
      return data.length;
    },

    async hasPositionFor(mint) {
      const data = await rows(
        'hasPositionFor',
        db.from('positions').select('id').eq('mint', mint).limit(1),
      );
      return data.length > 0;
    },

    async journal(entry) {
      await db.from('journal').insert({
        position_id: entry.positionId ?? null,
        mint: entry.mint ?? null,
        author: entry.author ?? 'system',
        note: entry.note,
        data: (entry.data ?? null) as never,
      });
    },

    async getState<T>(key: string, fallback: T): Promise<T> {
      const data = await rows(
        'getState',
        db.from('bot_state').select('value').eq('key', key).limit(1),
      );
      return (data[0]?.value as T) ?? fallback;
    },

    async setState(key, value) {
      await db
        .from('bot_state')
        .upsert(
          { key, value: value as never, updated_at: new Date().toISOString() },
          { onConflict: 'key' },
        );
    },

    // ── Dashboard ────────────────────────────────────────────────────────
    async recentTokens(limit) {
      const data = await rows(
        'recentTokens',
        db
          .from('tokens')
          .select('mint, symbol, name, creator, status, status_reason, launched_at, updated_at')
          .order('launched_at', { ascending: false })
          .limit(limit),
      );
      return data.map(
        (r): TokenRow => ({
          mint: r.mint as string,
          symbol: (r.symbol as string | null) ?? null,
          name: (r.name as string | null) ?? null,
          creator: (r.creator as string | null) ?? null,
          status: r.status as string,
          statusReason: (r.status_reason as string | null) ?? null,
          launchedAt: new Date(r.launched_at as string),
          updatedAt: new Date(r.updated_at as string),
        }),
      );
    },

    async recentChecks(limit) {
      const data = await rows(
        'recentChecks',
        db.from('token_checks').select('*').order('checked_at', { ascending: false }).limit(limit),
      );
      return data.map(toCheck);
    },

    async recentAnalyses(limit) {
      const data = await rows(
        'recentAnalyses',
        db.from('analyses').select('*').order('created_at', { ascending: false }).limit(limit),
      );
      return data.map(
        (r): AnalysisRow => ({
          mint: r.mint as string,
          score: Number(r.score ?? 0),
          verdict: r.verdict as AnalysisRow['verdict'],
          narrative: (r.narrative as string) ?? '',
          reasoning: (r.reasoning as string) ?? '',
          redFlags: Array.isArray(r.red_flags) ? (r.red_flags as string[]) : [],
          model: r.model as string,
          createdAt: new Date(r.created_at as string),
        }),
      );
    },

    async recentJournal(limit) {
      const data = await rows(
        'recentJournal',
        db.from('journal').select('*').order('created_at', { ascending: false }).limit(limit),
      );
      return data.map(
        (r): JournalRow => ({
          id: Number(r.id),
          positionId: (r.position_id as string | null) ?? null,
          mint: (r.mint as string | null) ?? null,
          author: r.author as string,
          note: r.note as string,
          createdAt: new Date(r.created_at as string),
        }),
      );
    },

    async recentClosedPositions(limit) {
      const data = await rows(
        'recentClosedPositions',
        db
          .from('positions')
          .select('*')
          .eq('status', 'closed')
          .order('exit_at', { ascending: false })
          .limit(limit),
      );
      return data.map(toPosition);
    },

    async statusCounts() {
      const data = await rows('statusCounts', db.from('tokens').select('status').limit(10_000));
      const out: Record<string, number> = {};
      for (const r of data) {
        const s = r.status as string;
        out[s] = (out[s] ?? 0) + 1;
      }
      return out;
    },

    async topDevs(limit) {
      const data = await rows(
        'topDevs',
        db
          .from('devs')
          .select('*')
          .order('tokens_created', { ascending: false })
          .limit(limit),
      );
      return data.map(
        (r): DevReputation => ({
          address: r.address as string,
          tokensCreated: Number(r.tokens_created ?? 0),
          rugs: Number(r.rugs ?? 0),
          survivors: Number(r.survivors ?? 0),
          bestLiquidityUsd: Number(r.best_liquidity_usd ?? 0),
          avgLifetimeMin: n(r.avg_lifetime_min),
        }),
      );
    },
  };

  return store;
}

/** Ulanish va sxema borligini tekshiradi. */
export async function verifySupabase(url: string, serviceKey: string): Promise<void> {
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const res = await db.from('bot_state').select('key').limit(1);
  if (res.error) {
    throw new Error(
      `Supabase'ga ulanib bo'lmadi yoki sxema yo'q: ${res.error.message}. ` +
        'supabase/schema.sql ni SQL Editor da ishga tushiring.',
    );
  }
}
