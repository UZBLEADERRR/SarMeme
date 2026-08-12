import { config } from '../config.js';
import { fetchJson } from '../util/http.js';
import { RateLimiter } from '../util/rate.js';
import { createLogger } from '../logger.js';

const log = createLogger('rpc');

/**
 * Bepul RPC tarifini asrash uchun barcha so'rovlar shu cheklagichdan o'tadi.
 * RPC_MAX_RPS ni provayderingiz limitidan pastroq qo'ying.
 */
const limiter = new RateLimiter(config.rpc.maxRps);

let idCounter = 0;

export class RpcMethodUnavailable extends Error {}

export class RpcNotConfigured extends Error {}

export function hasRpc(): boolean {
  return config.rpc.url !== null;
}

export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const url = config.rpc.url;
  if (url === null) throw new RpcNotConfigured('SOLANA_RPC_URL sozlanmagan');
  await limiter.acquire();

  const body = JSON.stringify({ jsonrpc: '2.0', id: ++idCounter, method, params });
  const res = await fetchJson<{ result?: T; error?: { code: number; message: string } }>(
    url,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body },
    { attempts: 2, timeoutMs: 20_000 },
  );

  if (res.error) {
    // -32601 = method not found (masalan Helius'ga xos metodlar boshqa provayderda yo'q)
    if (res.error.code === -32601) throw new RpcMethodUnavailable(res.error.message);
    throw new Error(`RPC ${method}: ${res.error.message}`);
  }
  if (res.result === undefined) throw new Error(`RPC ${method}: bo'sh javob`);
  return res.result;
}

// ── Mint ma'lumoti ──────────────────────────────────────────────────────────

export interface MintInfo {
  mintAuthorityPresent: boolean;
  freezeAuthorityPresent: boolean;
  decimals: number;
  supply: number;
}

interface ParsedMintAccount {
  value: {
    data?: {
      parsed?: {
        info?: {
          mintAuthority?: string | null;
          freezeAuthority?: string | null;
          decimals?: number;
          supply?: string;
        };
      };
    };
  } | null;
}

/**
 * Mint hisobini o'qiydi. Ikkala authority ham `null` bo'lishi kerak —
 * aks holda dev supply chiqara oladi yoki koshelyoklarni muzlata oladi.
 */
export async function getMintInfo(mint: string): Promise<MintInfo | null> {
  if (!hasRpc()) return null;
  try {
    const res = await rpc<ParsedMintAccount>('getAccountInfo', [
      mint,
      { encoding: 'jsonParsed', commitment: 'confirmed' },
    ]);
    const info = res.value?.data?.parsed?.info;
    if (!info) return null;

    const decimals = info.decimals ?? 0;
    const rawSupply = Number(info.supply ?? '0');

    return {
      mintAuthorityPresent: info.mintAuthority !== null && info.mintAuthority !== undefined,
      freezeAuthorityPresent: info.freezeAuthority !== null && info.freezeAuthority !== undefined,
      decimals,
      supply: rawSupply / 10 ** decimals,
    };
  } catch (err) {
    log.warn('getMintInfo muvaffaqiyatsiz', { mint, error: String(err) });
    return null;
  }
}

// ── Xolder taqsimoti ────────────────────────────────────────────────────────

export interface HolderConcentration {
  /** Bassein/bonding-curve hisobi chiqarib tashlangan top-10 ulushi (%). */
  top10Pct: number | null;
  /** Hech narsa chiqarilmagan xom ko'rsatkich — solishtirish uchun. */
  top10PctRaw: number | null;
  poolLikelyExcluded: boolean;
}

interface LargestAccounts {
  value: { address: string; uiAmount: number | null }[];
}

/**
 * Top-10 xolder konsentratsiyasi.
 *
 * DIQQAT — evristika: pump.fun bonding curve va DEX bassein hisoblari ham
 * "xolder" bo'lib ko'rinadi va supply'ning katta qismini ushlaydi. Ularni
 * ajratish uchun >50% ushlagan eng yirik bitta hisobni bassein deb hisoblab
 * chiqarib tashlaymiz. Bu mukammal emas; keyinchalik hisob egasini (owner)
 * tekshirib aniqlashtirish mumkin.
 */
export async function getHolderConcentration(
  mint: string,
  supply: number,
): Promise<HolderConcentration> {
  const empty: HolderConcentration = {
    top10Pct: null,
    top10PctRaw: null,
    poolLikelyExcluded: false,
  };
  if (!hasRpc() || !Number.isFinite(supply) || supply <= 0) return empty;

  try {
    const res = await rpc<LargestAccounts>('getTokenLargestAccounts', [
      mint,
      { commitment: 'confirmed' },
    ]);
    const amounts = (res.value ?? [])
      .map((a) => a.uiAmount ?? 0)
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => b - a);

    if (amounts.length === 0) return empty;

    const pct = (list: number[]) => (list.reduce((s, n) => s + n, 0) / supply) * 100;

    const top10PctRaw = pct(amounts.slice(0, 10));

    const largest = amounts[0] ?? 0;
    const largestPct = (largest / supply) * 100;
    const poolLikelyExcluded = largestPct > 50;
    const adjusted = poolLikelyExcluded ? amounts.slice(1) : amounts;

    return {
      top10Pct: Math.min(100, pct(adjusted.slice(0, 10))),
      top10PctRaw: Math.min(100, top10PctRaw),
      poolLikelyExcluded,
    };
  } catch (err) {
    log.warn('getHolderConcentration muvaffaqiyatsiz', { mint, error: String(err) });
    return empty;
  }
}

// ── Xolderlar soni (Helius DAS — ixtiyoriy) ─────────────────────────────────

interface HeliusTokenAccounts {
  total?: number;
  token_accounts?: { amount?: string | number }[];
}

/**
 * Xolderlar sonini taxminlaydi. `getTokenAccounts` — Helius'ga xos metod;
 * boshqa provayderda bo'lmasa `null` qaytaramiz va filtr buni "noma'lum"
 * deb yumshoq belgi sifatida qabul qiladi (qattiq rad etmaydi).
 */
export async function getHolderCount(mint: string): Promise<number | null> {
  if (!hasRpc()) return null;
  try {
    const res = await rpc<HeliusTokenAccounts>('getTokenAccounts', [
      { mint, limit: 1000, options: { showZeroBalance: false } },
    ]);
    if (typeof res.total === 'number') return res.total;
    return res.token_accounts?.length ?? null;
  } catch (err) {
    if (err instanceof RpcMethodUnavailable || err instanceof RpcNotConfigured) return null;
    log.debug('getHolderCount muvaffaqiyatsiz', { mint, error: String(err) });
    return null;
  }
}
