/** Butun tizim bo'ylab umumiy tiplar. */

export interface NewTokenEvent {
  mint: string;
  symbol: string | null;
  name: string | null;
  creator: string | null;
  uri: string | null;
  pool: string | null;
  launchedAt: Date;
}

export interface DevReputation {
  address: string;
  tokensCreated: number;
  rugs: number;
  survivors: number;
  bestLiquidityUsd: number;
  avgLifetimeMin: number | null;
}

/** DexScreener'dan olingan bozor holati. */
export interface MarketSnapshot {
  priceUsd: number | null;
  priceNativeSol: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  volume5mUsd: number | null;
  volume1hUsd: number | null;
  txns5mBuys: number | null;
  txns5mSells: number | null;
  pairCreatedAt: Date | null;
  dexId: string | null;
  pairAddress: string | null;
}

/** RPC'dan olingan zanjir holati. */
export interface ChainSnapshot {
  mintAuthorityPresent: boolean | null;
  freezeAuthorityPresent: boolean | null;
  decimals: number | null;
  supply: number | null;
  holderCount: number | null;
  top10Pct: number | null;
}

export interface ScreenResult {
  mint: string;
  passed: boolean;
  flags: string[];
  ageMinutes: number;
  market: MarketSnapshot;
  chain: ChainSnapshot;
  dev: DevReputation | null;
}

export type Verdict = 'avoid' | 'watch' | 'enter';

export interface AiAnalysis {
  mint: string;
  score: number;
  verdict: Verdict;
  narrative: string;
  reasoning: string;
  redFlags: string[];
}

export interface Position {
  id: string;
  mint: string;
  symbol: string | null;
  mode: 'paper' | 'live';
  status: 'open' | 'closed';
  entryScore: number | null;
  solIn: number;
  entryPrice: number;
  qty: number;
  entryAt: Date;
  peakPrice: number | null;
  exitPrice: number | null;
  solOut: number | null;
  exitAt: Date | null;
  exitReason: string | null;
  pnlSol: number | null;
  pnlPct: number | null;
}
