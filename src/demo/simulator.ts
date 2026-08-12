import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { setMarketProvider } from '../market/prices.js';
import { setChainProvider } from '../chain/provider.js';
import { getStore } from '../store/index.js';
import type { ChainSnapshot, MarketSnapshot } from '../types.js';

const log = createLogger('simulyator');

/**
 * SIMULYATOR — sun'iy ma'lumot, haqiqiy quvur.
 *
 * Nima uchun kerak: haqiqiy tokenlar oqimi sekin va oldindan aytib bo'lmaydi.
 * Tizim nima qilishini ko'rish uchun soatlab kutish o'rniga, bu modul
 * ishonchli taqsimotdagi sun'iy tokenlar yaratadi va ularni QUVURNING
 * O'ZIDAN o'tkazadi:
 *
 *     haqiqiy filtr → haqiqiy ballchi → haqiqiy risk menejeri
 *     → haqiqiy virtual savdo → haqiqiy chiqish qoidalari
 *
 * Ya'ni siz ko'rayotgan xatti-harakat — bu haqiqiy kodning xatti-harakati.
 * Faqat kirish ma'lumoti o'ylab topilgan.
 *
 * DIQQAT: bu ma'lumot HAQIQIY EMAS. Undan strategiya samaradorligi haqida
 * xulosa chiqarib bo'lmaydi — buning uchun haqiqiy oqimda shadow mode kerak.
 */

type Trajectory = 'rug' | 'chop' | 'pump';

interface SimToken {
  mint: string;
  symbol: string;
  creator: string;
  bornAt: number;
  trajectory: Trajectory;
  priceSol: number;
  liquidityUsd: number;
  marketCapUsd: number;
  holders: number;
  top10Pct: number;
  mintAuthority: boolean;
  freezeAuthority: boolean;
  lastTickAt: number;
  dead: boolean;
}

const sims = new Map<string, SimToken>();

const rnd = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)] as T;

/** Solana manzillariga o'xshash base58 satr. */
function fakeAddress(): string {
  const abc = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const bytes = randomBytes(44);
  let out = '';
  for (const byte of bytes) out += abc[byte % abc.length];
  return out;
}

const WORDS = [
  'DOGE', 'PEPE', 'WIF', 'BONK', 'MOON', 'CHAD', 'WOJAK', 'FROG', 'CAT', 'SHIB',
  'TURBO', 'MEME', 'BASED', 'GIGA', 'NYAN', 'SOLAR', 'PUMP', 'APE', 'BULL', 'DEGEN',
];

/**
 * Yangi sun'iy token. Taqsimot ataylab hayotdagidek shafqatsiz:
 * ko'pchiligi yomon, ozchiligi yaxshi.
 */
function makeToken(): SimToken {
  // Devlarni qayta ishlatamiz — shunda reputatsiya bazasi to'lib boradi
  const reuseDev = Math.random() < 0.35 && knownDevs.length > 0;
  const creator = reuseDev ? pick(knownDevs) : fakeAddress();
  if (!reuseDev) knownDevs.push(creator);
  if (knownDevs.length > 60) knownDevs.shift();

  const roll = Math.random();
  const trajectory: Trajectory = roll < 0.45 ? 'rug' : roll < 0.85 ? 'chop' : 'pump';

  // Sifat darajasi — filtr shuni ajratishi kerak
  const quality = trajectory === 'pump' ? rnd(0.6, 1) : trajectory === 'chop' ? rnd(0.3, 0.8) : rnd(0, 0.5);

  return {
    mint: fakeAddress(),
    symbol: pick(WORDS) + (Math.random() < 0.4 ? pick(['2', 'INU', 'AI', 'X', '']) : ''),
    creator,
    bornAt: Date.now() - rnd(6, 90) * 60_000, // filtr oynasiga tushishi uchun orqaga suramiz
    trajectory,
    priceSol: rnd(0.0000001, 0.000005),
    liquidityUsd: quality * rnd(4000, 90_000),
    marketCapUsd: quality * rnd(30_000, 900_000),
    holders: Math.round(quality * rnd(20, 900)),
    top10Pct: 60 - quality * rnd(20, 50),
    // Yomon tokenlarda authority ba'zan bekor qilinmagan bo'ladi
    mintAuthority: Math.random() < (1 - quality) * 0.35,
    freezeAuthority: Math.random() < (1 - quality) * 0.2,
    lastTickAt: Date.now(),
    dead: false,
  };
}

const knownDevs: string[] = [];

/**
 * Narxni vaqt o'tishi bilan yo'nalishiga qarab siljitadi.
 *
 * Tezlik ATAYLAB oshirilgan: haqiqiy hayotda pozitsiya soatlab ochiq turadi,
 * bu yerda esa butun sikl (kirish → stop-loss / take-profit / rug) bir necha
 * daqiqada tugaydi. Aks holda namoyishda hech narsa ko'rinmaydi.
 * Chiqish qoidalarining O'ZI haqiqiy — faqat vaqt siqilgan.
 */
function advance(t: SimToken): void {
  const now = Date.now();
  const minutes = (now - t.lastTickAt) / 60_000;
  if (minutes <= 0) return;
  t.lastTickAt = now;

  if (t.dead) return;

  const drift = t.trajectory === 'rug' ? -0.5 : t.trajectory === 'pump' ? 0.35 : 0.02;
  const noise = (Math.random() - 0.5) * 1.2;
  const change = (drift + noise) * minutes;

  t.priceSol = Math.max(1e-12, t.priceSol * (1 + change));
  t.marketCapUsd = Math.max(0, t.marketCapUsd * (1 + change));
  // Rug'da likvidlik narxdan ham tezroq quriydi — dev basseynni bo'shatadi
  const liqChange = t.trajectory === 'rug' ? change * 2 : change * 0.75;
  t.liquidityUsd = Math.max(0, t.liquidityUsd * (1 + liqChange));

  if (t.trajectory === 'pump') t.holders += Math.round(rnd(0, 25) * minutes);

  // Rug: likvidlik butunlay quriydi — chiqish qoidasi shuni ushlashi kerak
  if (t.trajectory === 'rug' && t.liquidityUsd < 400) {
    t.dead = true;
    t.liquidityUsd = 0;
    t.priceSol = 0;
  }
}

function toMarket(t: SimToken): MarketSnapshot {
  const buyBias = t.trajectory === 'pump' ? 0.68 : t.trajectory === 'rug' ? 0.28 : 0.5;
  const txns = Math.round(rnd(8, 120));
  const buys = Math.round(txns * buyBias);

  return {
    priceUsd: t.priceSol * 150, // SOL ~ $150 deb faraz qilamiz
    priceNativeSol: t.dead ? null : t.priceSol,
    liquidityUsd: t.dead ? null : t.liquidityUsd,
    marketCapUsd: t.marketCapUsd,
    volume5mUsd: t.liquidityUsd * rnd(0.05, 0.9),
    volume1hUsd: t.liquidityUsd * rnd(0.4, 4),
    txns5mBuys: buys,
    txns5mSells: txns - buys,
    pairCreatedAt: new Date(t.bornAt),
    dexId: 'pumpswap',
    pairAddress: t.mint,
  };
}

function toChain(t: SimToken): ChainSnapshot {
  return {
    mintAuthorityPresent: t.mintAuthority,
    freezeAuthorityPresent: t.freezeAuthority,
    decimals: 6,
    supply: 1_000_000_000,
    holderCount: t.holders,
    top10Pct: t.top10Pct,
  };
}

/**
 * Simulyatorni yoqadi: bozor va zanjir manbalarini almashtiradi va
 * muntazam yangi sun'iy tokenlar yaratadi.
 */
export function startSimulator(): NodeJS.Timeout {
  log.warn('SIMULYATOR YOQILDI — ma\'lumot sun\'iy, faqat namoyish uchun');

  setMarketProvider(async (mints) => {
    const out = new Map<string, MarketSnapshot>();
    for (const mint of mints) {
      const t = sims.get(mint);
      if (!t) continue;
      advance(t);
      out.set(mint, toMarket(t));
    }
    return out;
  });

  setChainProvider(async (mint) => {
    const t = sims.get(mint);
    if (!t) {
      return {
        mintAuthorityPresent: null,
        freezeAuthorityPresent: null,
        decimals: null,
        supply: null,
        holderCount: null,
        top10Pct: null,
      };
    }
    return toChain(t);
  });

  const spawn = async (n: number) => {
    for (let i = 0; i < n; i++) {
      const t = makeToken();
      sims.set(t.mint, t);
      await getStore().insertToken({
        mint: t.mint,
        symbol: t.symbol,
        name: `${t.symbol} (sun'iy)`,
        creator: t.creator,
        uri: null,
        pool: 'pumpswap',
        launchedAt: new Date(t.bornAt),
      });
    }
    // Xotira cheksiz o'smasin
    if (sims.size > 800) {
      const oldest = [...sims.values()].sort((a, b) => a.bornAt - b.bornAt).slice(0, 200);
      for (const t of oldest) sims.delete(t.mint);
    }
  };

  // Boshida darrov bir necha token — dashboard bo'sh turmasin
  void spawn(12);

  return setInterval(() => void spawn(3), 8000);
}

export function simulatorActive(): boolean {
  return sims.size > 0;
}
