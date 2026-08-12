import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { fetchMarkets } from '../market/prices.js';
import { getStore } from '../store/index.js';
import type { Position } from '../types.js';

const log = createLogger('paper');

/**
 * Virtual savdo qog'ozda haqiqiydan chiroyliroq ko'rinmasligi uchun
 * har kirish va chiqishga jarima qo'llaymiz.
 *
 * Memcoin savdosida bu real xarajatlar:
 *   - DEX komissiyasi ~1%
 *   - past likvidlikda slippage 1-5% (2% — ehtiyotkor o'rtacha)
 *   - Jito tip / gaz — kichik, lekin nolga teng emas
 *
 * Bu raqamlarni ataylab pessimistik qo'ydik. Shadow mode natijasi
 * shu jarima bilan ham plyusda bo'lsa — signal haqiqatan ham kuchli.
 */
export const SIM_FEE_PCT = 1;
export const SIM_SLIPPAGE_PCT = 2;
const ROUNDTRIP_COST = (SIM_FEE_PCT + SIM_SLIPPAGE_PCT) / 100;

export interface EntryRequest {
  mint: string;
  symbol: string | null;
  score: number;
  sizeSol: number;
}

export interface ExitEvent {
  position: Position;
  exitPrice: number;
  pnlSol: number;
  pnlPct: number;
  reason: string;
}

/**
 * Virtual kirish. Narx DexScreener'dan SOL'da olinadi.
 * Narx yo'q bo'lsa kirmaymiz — noma'lum narxda pozitsiya ochish xato.
 */
export async function enter(req: EntryRequest): Promise<Position | null> {
  const markets = await fetchMarkets([req.mint]);
  const price = markets.get(req.mint)?.priceNativeSol ?? null;

  if (price === null || price <= 0) {
    log.warn('narx yo\'q, kirish bekor qilindi', { mint: req.mint });
    return null;
  }

  // Slippage: real hayotda kutilganidan qimmatroq sotib olamiz.
  const effectivePrice = price * (1 + ROUNDTRIP_COST / 2);
  const qty = req.sizeSol / effectivePrice;

  const pos = await getStore().openPosition({
    mint: req.mint,
    symbol: req.symbol,
    mode: 'paper',
    entryScore: req.score,
    solIn: req.sizeSol,
    entryPrice: effectivePrice,
    qty,
  });

  await getStore().setTokenStatus(req.mint, 'traded', `paper kirish, ball ${req.score}`);
  await getStore().journal({
    positionId: pos.id,
    mint: req.mint,
    note: `KIRISH ${req.symbol ?? req.mint.slice(0, 8)} — ${req.sizeSol.toFixed(4)} SOL, ball ${req.score}`,
    data: { entryPrice: effectivePrice, qty, rawPrice: price },
  });

  log.info('pozitsiya ochildi', {
    mint: req.mint,
    sol: req.sizeSol,
    price: effectivePrice,
    score: req.score,
  });

  return pos;
}

/** Chiqish sababini aniqlaydi. Qoidalar qat'iy — AI aralashmaydi. */
function decideExit(
  pos: Position,
  price: number,
  peak: number,
): { exit: boolean; reason: string } {
  const changePct = ((price - pos.entryPrice) / pos.entryPrice) * 100;
  const heldMinutes = (Date.now() - pos.entryAt.getTime()) / 60_000;

  if (changePct <= -config.exit.stopLossPct) {
    return { exit: true, reason: `stop-loss ${changePct.toFixed(1)}%` };
  }
  if (changePct >= config.exit.takeProfitPct) {
    return { exit: true, reason: `take-profit ${changePct.toFixed(1)}%` };
  }

  // Trailing stop faqat foyda cho'qqisidan keyin ishlaydi.
  if (peak > pos.entryPrice) {
    const dropFromPeak = ((peak - price) / peak) * 100;
    if (dropFromPeak >= config.exit.trailingStopPct) {
      return { exit: true, reason: `trailing-stop cho'qqidan -${dropFromPeak.toFixed(1)}%` };
    }
  }

  if (heldMinutes >= config.exit.maxHoldMinutes) {
    return { exit: true, reason: `vaqt tugadi (${heldMinutes.toFixed(0)} daq)` };
  }

  return { exit: false, reason: '' };
}

/**
 * Ochiq pozitsiyalarni ko'rib chiqadi va chiqish qoidalarini qo'llaydi.
 * Yopilgan pozitsiyalar ro'yxatini qaytaradi (Telegram xabari uchun).
 */
export async function manageOpenPositions(): Promise<ExitEvent[]> {
  const open = await getStore().listOpenPositions();
  if (open.length === 0) return [];

  const markets = await fetchMarkets(open.map((p) => p.mint));
  const exits: ExitEvent[] = [];

  for (const pos of open) {
    const price = markets.get(pos.mint)?.priceNativeSol ?? null;

    // Narx yo'qolgan = juftlik quritilgan. Bu rug — to'liq zarar deb yozamiz.
    if (price === null || price <= 0) {
      const heldMinutes = (Date.now() - pos.entryAt.getTime()) / 60_000;
      if (heldMinutes < 5) continue; // vaqtinchalik API uzilishi bo'lishi mumkin

      const pnlSol = -pos.solIn;
      await getStore().closePosition(pos.id, 0, 0, 'likvidlik yo\'qoldi (rug)', pnlSol, -100);
      await getStore().journal({
        positionId: pos.id,
        mint: pos.mint,
        note: `CHIQISH ${pos.symbol ?? pos.mint.slice(0, 8)} — likvidlik yo'qoldi, -${pos.solIn.toFixed(4)} SOL`,
      });
      exits.push({
        position: pos,
        exitPrice: 0,
        pnlSol,
        pnlPct: -100,
        reason: 'likvidlik yo\'qoldi (rug)',
      });
      continue;
    }

    const peak = Math.max(pos.peakPrice ?? pos.entryPrice, price);
    if (peak > (pos.peakPrice ?? 0)) await getStore().updatePeak(pos.id, peak);

    const { exit, reason } = decideExit(pos, price, peak);
    if (!exit) continue;

    // Chiqishda ham slippage: kutilganidan arzonroq sotamiz.
    const effectivePrice = price * (1 - ROUNDTRIP_COST / 2);
    const solOut = pos.qty * effectivePrice;
    const pnlSol = solOut - pos.solIn;
    const pnlPct = (pnlSol / pos.solIn) * 100;

    await getStore().closePosition(pos.id, effectivePrice, solOut, reason, pnlSol, pnlPct);
    await getStore().journal({
      positionId: pos.id,
      mint: pos.mint,
      note: `CHIQISH ${pos.symbol ?? pos.mint.slice(0, 8)} — ${reason}, ${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL (${pnlPct.toFixed(1)}%)`,
      data: { exitPrice: effectivePrice, rawPrice: price, peak },
    });

    log.info('pozitsiya yopildi', { mint: pos.mint, reason, pnlSol, pnlPct });
    exits.push({ position: pos, exitPrice: effectivePrice, pnlSol, pnlPct, reason });
  }

  return exits;
}
