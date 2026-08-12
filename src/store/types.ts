import type { AiAnalysis, DevReputation, NewTokenEvent, Position, ScreenResult } from '../types.js';

export interface TokenRow {
  mint: string;
  symbol: string | null;
  name: string | null;
  creator: string | null;
  status: string;
  statusReason: string | null;
  launchedAt: Date;
  updatedAt: Date;
}

export interface CheckRow {
  mint: string;
  checkedAt: Date;
  mintAuthority: boolean | null;
  freezeAuthority: boolean | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  volume5mUsd: number | null;
  priceUsd: number | null;
  holderCount: number | null;
  top10Pct: number | null;
  ageMinutes: number;
  passed: boolean;
  flags: string[];
}

export interface AnalysisRow extends AiAnalysis {
  model: string;
  createdAt: Date;
}

export interface JournalRow {
  id: number;
  positionId: string | null;
  mint: string | null;
  author: string;
  note: string;
  createdAt: Date;
}

/**
 * Barcha ma'lumot amallari. Ikkita amalga oshirish bor:
 * Supabase (doimiy) va xotira (demo). Chaqiruvchi kod farqni bilmaydi.
 */
export interface Store {
  readonly kind: 'supabase' | 'memory';

  // Tokenlar
  insertToken(ev: NewTokenEvent): Promise<void>;
  fetchTokensForScreening(
    minAgeMinutes: number,
    maxAgeMinutes: number,
    limit: number,
  ): Promise<{ mint: string; symbol: string | null; creator: string | null; launchedAt: Date }[]>;
  setTokenStatus(mint: string, status: string, reason?: string): Promise<void>;
  expireStaleTokens(maxAgeMinutes: number): Promise<number>;
  fetchTokensForAi(limit: number): Promise<{ mint: string; symbol: string | null; creator: string | null }[]>;
  fetchTokensForOutcome(
    olderThanHours: number,
    limit: number,
  ): Promise<{ mint: string; creator: string | null }[]>;

  // Tekshiruvlar
  recordCheck(r: ScreenResult): Promise<void>;
  latestCheck(mint: string): Promise<CheckRow | null>;

  // Devlar
  getDev(address: string): Promise<DevReputation | null>;
  recordDevOutcome(address: string, outcome: 'rug' | 'survivor', liquidityUsd: number): Promise<void>;

  // Tahlillar
  recordAnalysis(a: AiAnalysis, model: string, raw: unknown): Promise<void>;

  // Pozitsiyalar
  openPosition(p: {
    mint: string;
    symbol: string | null;
    mode: 'paper' | 'live';
    entryScore: number;
    solIn: number;
    entryPrice: number;
    qty: number;
  }): Promise<Position>;
  listOpenPositions(): Promise<Position[]>;
  updatePeak(id: string, peak: number): Promise<void>;
  closePosition(
    id: string,
    exitPrice: number,
    solOut: number,
    reason: string,
    pnlSol: number,
    pnlPct: number,
  ): Promise<void>;
  pnlSince(since: Date): Promise<{ realizedSol: number; trades: number; wins: number }>;
  tradesOpenedSince(since: Date): Promise<number>;
  hasPositionFor(mint: string): Promise<boolean>;

  // Jurnal
  journal(entry: {
    positionId?: string;
    mint?: string;
    author?: 'system' | 'ai' | 'user';
    note: string;
    data?: unknown;
  }): Promise<void>;

  // Holat
  getState<T>(key: string, fallback: T): Promise<T>;
  setState(key: string, value: unknown): Promise<void>;

  // ── Dashboard uchun o'qish amallari ──────────────────────────────────────
  recentTokens(limit: number): Promise<TokenRow[]>;
  recentChecks(limit: number): Promise<CheckRow[]>;
  recentAnalyses(limit: number): Promise<AnalysisRow[]>;
  recentJournal(limit: number): Promise<JournalRow[]>;
  recentClosedPositions(limit: number): Promise<Position[]>;
  statusCounts(): Promise<Record<string, number>>;
  topDevs(limit: number): Promise<DevReputation[]>;
}
