import { db } from './client.js';
import { createLogger } from '../logger.js';
import type {
  AiAnalysis,
  DevReputation,
  NewTokenEvent,
  Position,
  ScreenResult,
} from '../types.js';

const log = createLogger('db');

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  if (res.data === null) throw new Error(`${what}: ma'lumot qaytmadi`);
  return res.data;
}

// ── Tokenlar ────────────────────────────────────────────────────────────────

/** Yangi tokenni yozadi. Takror kelsa e'tiborsiz qoldiradi. */
export async function insertToken(ev: NewTokenEvent): Promise<void> {
  if (ev.creator) await touchDev(ev.creator);

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
}

/** Skrining oynasiga tushgan, hali ko'rilmagan tokenlar. */
export async function fetchTokensForScreening(
  minAgeMinutes: number,
  maxAgeMinutes: number,
  limit: number,
): Promise<{ mint: string; symbol: string | null; creator: string | null; launchedAt: Date }[]> {
  const now = Date.now();
  const newest = new Date(now - minAgeMinutes * 60_000).toISOString();
  const oldest = new Date(now - maxAgeMinutes * 60_000).toISOString();

  const res = await db
    .from('tokens')
    .select('mint, symbol, creator, launched_at')
    .eq('status', 'new')
    .gte('launched_at', oldest)
    .lte('launched_at', newest)
    .order('launched_at', { ascending: false })
    .limit(limit);

  const rows = must(res, 'fetchTokensForScreening');
  return rows.map((r) => ({
    mint: r.mint as string,
    symbol: r.symbol as string | null,
    creator: r.creator as string | null,
    launchedAt: new Date(r.launched_at as string),
  }));
}

export async function setTokenStatus(
  mint: string,
  status: string,
  reason?: string,
): Promise<void> {
  const { error } = await db
    .from('tokens')
    .update({ status, status_reason: reason ?? null, updated_at: new Date().toISOString() })
    .eq('mint', mint);
  if (error) log.warn('status yangilanmadi', { mint, error: error.message });
}

/** Oynadan chiqib ketgan, hech qachon skrining qilinmagan tokenlarni yopadi. */
export async function expireStaleTokens(maxAgeMinutes: number): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000).toISOString();
  const res = await db
    .from('tokens')
    .update({ status: 'dead', status_reason: 'oyna yopildi', updated_at: new Date().toISOString() })
    .eq('status', 'new')
    .lt('launched_at', cutoff)
    .select('mint');
  if (res.error) {
    log.warn('expireStaleTokens', { error: res.error.message });
    return 0;
  }
  return res.data?.length ?? 0;
}

// ── Tekshiruvlar ────────────────────────────────────────────────────────────

export async function recordCheck(r: ScreenResult): Promise<void> {
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
}

/** Filtrdan o'tgan, hali AI ko'rmagan tokenlar. */
export async function fetchTokensForAi(limit: number): Promise<
  { mint: string; symbol: string | null; creator: string | null }[]
> {
  const res = await db
    .from('tokens')
    .select('mint, symbol, creator')
    .eq('status', 'watching')
    .order('updated_at', { ascending: true })
    .limit(limit);
  const rows = must(res, 'fetchTokensForAi');
  return rows.map((r) => ({
    mint: r.mint as string,
    symbol: r.symbol as string | null,
    creator: r.creator as string | null,
  }));
}

/**
 * Natijasi hali qayd etilmagan, yetarlicha eskirgan tokenlar.
 * Dev reputatsiya bazasini bepul to'ldirish uchun ishlatiladi.
 */
export async function fetchTokensForOutcome(
  olderThanHours: number,
  limit: number,
): Promise<{ mint: string; creator: string | null }[]> {
  const cutoff = new Date(Date.now() - olderThanHours * 3_600_000).toISOString();
  const res = await db
    .from('tokens')
    .select('mint, creator')
    .in('status', ['watching', 'traded'])
    .lt('launched_at', cutoff)
    .limit(limit);
  const rows = must(res, 'fetchTokensForOutcome');
  return rows.map((r) => ({ mint: r.mint as string, creator: r.creator as string | null }));
}

export async function latestCheck(mint: string): Promise<Record<string, unknown> | null> {
  const res = await db
    .from('token_checks')
    .select('*')
    .eq('mint', mint)
    .order('checked_at', { ascending: false })
    .limit(1);
  if (res.error) return null;
  return (res.data?.[0] as Record<string, unknown>) ?? null;
}

// ── Devlar ──────────────────────────────────────────────────────────────────

async function touchDev(address: string): Promise<void> {
  const existing = await db.from('devs').select('tokens_created').eq('address', address).limit(1);
  if (existing.error) return;

  if (existing.data && existing.data.length > 0) {
    const current = (existing.data[0]?.tokens_created as number) ?? 0;
    await db
      .from('devs')
      .update({ tokens_created: current + 1, last_seen_at: new Date().toISOString() })
      .eq('address', address);
  } else {
    await db.from('devs').insert({ address, tokens_created: 1 });
  }
}

export async function getDev(address: string): Promise<DevReputation | null> {
  const res = await db.from('devs').select('*').eq('address', address).limit(1);
  if (res.error || !res.data || res.data.length === 0) return null;
  const r = res.data[0] as Record<string, unknown>;
  return {
    address: r.address as string,
    tokensCreated: (r.tokens_created as number) ?? 0,
    rugs: (r.rugs as number) ?? 0,
    survivors: (r.survivors as number) ?? 0,
    bestLiquidityUsd: Number(r.best_liquidity_usd ?? 0),
    avgLifetimeMin: r.avg_lifetime_min === null ? null : Number(r.avg_lifetime_min),
  };
}

/**
 * Dev natijasini qayd etadi. Bu bepul reputatsiya bazamizning yuragi:
 * har bir token o'lgani yoki omon qolgani shu yerda to'planadi.
 */
export async function recordDevOutcome(
  address: string,
  outcome: 'rug' | 'survivor',
  liquidityUsd: number,
): Promise<void> {
  const dev = await getDev(address);
  if (!dev) return;
  const patch: Record<string, unknown> = { last_seen_at: new Date().toISOString() };
  if (outcome === 'rug') patch.rugs = dev.rugs + 1;
  else patch.survivors = dev.survivors + 1;
  if (liquidityUsd > dev.bestLiquidityUsd) patch.best_liquidity_usd = liquidityUsd;
  await db.from('devs').update(patch).eq('address', address);
}

// ── AI tahlillari ───────────────────────────────────────────────────────────

export async function recordAnalysis(
  a: AiAnalysis,
  model: string,
  raw: unknown,
): Promise<void> {
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
}

// ── Pozitsiyalar ────────────────────────────────────────────────────────────

function rowToPosition(r: Record<string, unknown>): Position {
  return {
    id: r.id as string,
    mint: r.mint as string,
    symbol: (r.symbol as string | null) ?? null,
    mode: r.mode as 'paper' | 'live',
    status: r.status as 'open' | 'closed',
    entryScore: r.entry_score === null ? null : Number(r.entry_score),
    solIn: Number(r.sol_in),
    entryPrice: Number(r.entry_price),
    qty: Number(r.qty),
    entryAt: new Date(r.entry_at as string),
    peakPrice: r.peak_price === null ? null : Number(r.peak_price),
    exitPrice: r.exit_price === null ? null : Number(r.exit_price),
    solOut: r.sol_out === null ? null : Number(r.sol_out),
    exitAt: r.exit_at === null ? null : new Date(r.exit_at as string),
    exitReason: (r.exit_reason as string | null) ?? null,
    pnlSol: r.pnl_sol === null ? null : Number(r.pnl_sol),
    pnlPct: r.pnl_pct === null ? null : Number(r.pnl_pct),
  };
}

export async function openPosition(p: {
  mint: string;
  symbol: string | null;
  mode: 'paper' | 'live';
  entryScore: number;
  solIn: number;
  entryPrice: number;
  qty: number;
}): Promise<Position> {
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
  const rows = must(res, 'openPosition');
  return rowToPosition(rows[0] as Record<string, unknown>);
}

export async function listOpenPositions(): Promise<Position[]> {
  const res = await db
    .from('positions')
    .select('*')
    .eq('status', 'open')
    .order('entry_at', { ascending: true });
  const rows = must(res, 'listOpenPositions');
  return rows.map((r) => rowToPosition(r as Record<string, unknown>));
}

export async function updatePeak(id: string, peak: number): Promise<void> {
  await db.from('positions').update({ peak_price: peak }).eq('id', id);
}

export async function closePosition(
  id: string,
  exitPrice: number,
  solOut: number,
  reason: string,
  pnlSol: number,
  pnlPct: number,
): Promise<void> {
  const { error } = await db
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
  if (error) log.warn('pozitsiya yopilmadi', { id, error: error.message });
}

export async function pnlSince(since: Date): Promise<{ realizedSol: number; trades: number }> {
  const res = await db
    .from('positions')
    .select('pnl_sol')
    .eq('status', 'closed')
    .gte('exit_at', since.toISOString());
  if (res.error || !res.data) return { realizedSol: 0, trades: 0 };
  const realizedSol = res.data.reduce((s, r) => s + Number(r.pnl_sol ?? 0), 0);
  return { realizedSol, trades: res.data.length };
}

export async function tradesOpenedSince(since: Date): Promise<number> {
  const res = await db
    .from('positions')
    .select('id')
    .gte('entry_at', since.toISOString());
  if (res.error || !res.data) return 0;
  return res.data.length;
}

export async function hasPositionFor(mint: string): Promise<boolean> {
  const res = await db.from('positions').select('id').eq('mint', mint).limit(1);
  return !res.error && (res.data?.length ?? 0) > 0;
}

// ── Jurnal ──────────────────────────────────────────────────────────────────

export async function journal(entry: {
  positionId?: string;
  mint?: string;
  author?: 'system' | 'ai' | 'user';
  note: string;
  data?: unknown;
}): Promise<void> {
  await db.from('journal').insert({
    position_id: entry.positionId ?? null,
    mint: entry.mint ?? null,
    author: entry.author ?? 'system',
    note: entry.note,
    data: (entry.data ?? null) as never,
  });
}

// ── Bot holati ──────────────────────────────────────────────────────────────

export async function getState<T>(key: string, fallback: T): Promise<T> {
  const res = await db.from('bot_state').select('value').eq('key', key).limit(1);
  if (res.error || !res.data || res.data.length === 0) return fallback;
  return (res.data[0]?.value as T) ?? fallback;
}

export async function setState(key: string, value: unknown): Promise<void> {
  await db
    .from('bot_state')
    .upsert(
      { key, value: value as never, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    );
}
