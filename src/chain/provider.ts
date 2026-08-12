import { getHolderConcentration, getHolderCount, getMintInfo } from './rpc.js';
import type { ChainSnapshot } from '../types.js';

/** RPC yo'q yoki tekshirib bo'lmadi — hamma narsa noma'lum. */
export const UNKNOWN_CHAIN: ChainSnapshot = {
  mintAuthorityPresent: null,
  freezeAuthorityPresent: null,
  decimals: null,
  supply: null,
  holderCount: null,
  top10Pct: null,
};

export type ChainProvider = (mint: string) => Promise<ChainSnapshot>;

/** Haqiqiy zanjir tekshiruvi — Solana RPC orqali. */
const rpcProvider: ChainProvider = async (mint) => {
  const info = await getMintInfo(mint);
  if (!info) return UNKNOWN_CHAIN;

  const conc = await getHolderConcentration(mint, info.supply);
  const holderCount = await getHolderCount(mint);

  return {
    mintAuthorityPresent: info.mintAuthorityPresent,
    freezeAuthorityPresent: info.freezeAuthorityPresent,
    decimals: info.decimals,
    supply: info.supply,
    holderCount,
    top10Pct: conc.top10Pct,
  };
};

let provider: ChainProvider = rpcProvider;

export function setChainProvider(p: ChainProvider): void {
  provider = p;
}

export function inspectChain(mint: string): Promise<ChainSnapshot> {
  return provider(mint);
}
