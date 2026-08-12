import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { getStore } from '../store/index.js';

const log = createLogger('risk');

export interface RiskDecision {
  allowed: boolean;
  reason: string;
  /** Ruxsat berilganda kiritiladigan miqdor (SOL). */
  sizeSol: number;
}

function startOfUtcDay(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function isKillSwitchOn(): Promise<boolean> {
  const s = await getStore().getState<{ enabled: boolean; reason?: string }>('kill_switch', {
    enabled: false,
  });
  return s.enabled === true;
}

export async function setKillSwitch(enabled: boolean, reason: string): Promise<void> {
  await getStore().setState('kill_switch', { enabled, reason, at: new Date().toISOString() });
  log.warn(enabled ? 'KILL SWITCH YOQILDI' : 'kill switch o\'chirildi', { reason });
  await getStore().journal({ note: enabled ? `Kill switch yoqildi: ${reason}` : `Kill switch o'chirildi: ${reason}` });
}

export interface RiskSnapshot {
  killSwitch: boolean;
  openPositions: number;
  tradesLastHour: number;
  dailyPnlSol: number;
  dailyLossLimitSol: number;
  exposureSol: number;
}

export async function snapshot(): Promise<RiskSnapshot> {
  const open = await getStore().listOpenPositions();
  const day = await getStore().pnlSince(startOfUtcDay());
  const hour = await getStore().tradesOpenedSince(new Date(Date.now() - 3_600_000));

  return {
    killSwitch: await isKillSwitchOn(),
    openPositions: open.length,
    tradesLastHour: hour,
    dailyPnlSol: day.realizedSol,
    dailyLossLimitSol: (config.risk.bankrollSol * config.risk.dailyLossLimitPct) / 100,
    exposureSol: open.reduce((s, p) => s + p.solIn, 0),
  };
}

/**
 * Yangi pozitsiya ochishga ruxsat beradi yoki rad etadi.
 *
 * Bu funksiyaning barcha qoidalari qattiq kodda. AI ballari faqat
 * "qaysi tokenga qarash kerak" degan savolga javob beradi — "qancha pul
 * qo'yish" va "umuman ruxsatmi" degan savollarga emas.
 */
export async function evaluateEntry(mint: string, aiScore: number): Promise<RiskDecision> {
  const deny = (reason: string): RiskDecision => ({ allowed: false, reason, sizeSol: 0 });

  if (config.tradingMode === 'live') {
    return deny('live rejim hali yoqilmagan — src/trade/live.ts ga qarang');
  }

  const snap = await snapshot();

  if (snap.killSwitch) return deny('kill switch yoqilgan');

  if (aiScore < config.minAiScore) {
    return deny(`AI bali past (${aiScore} < ${config.minAiScore})`);
  }

  if (snap.openPositions >= config.risk.maxOpenPositions) {
    return deny(`ochiq pozitsiyalar limiti (${snap.openPositions}/${config.risk.maxOpenPositions})`);
  }

  if (snap.tradesLastHour >= config.risk.maxTradesPerHour) {
    return deny(`soatlik savdo limiti (${snap.tradesLastHour}/${config.risk.maxTradesPerHour})`);
  }

  // Kunlik zarar chegarasi — tegilsa kill switch avtomatik yoqiladi.
  if (snap.dailyPnlSol <= -snap.dailyLossLimitSol) {
    await setKillSwitch(
      true,
      `kunlik zarar limiti: ${snap.dailyPnlSol.toFixed(4)} SOL (limit ${snap.dailyLossLimitSol.toFixed(4)})`,
    );
    return deny('kunlik zarar limitiga yetildi');
  }

  if (await getStore().hasPositionFor(mint)) {
    return deny('bu tokenda allaqachon pozitsiya bo\'lgan');
  }

  const sizeSol = (config.risk.bankrollSol * config.risk.maxPositionPct) / 100;
  const free = config.risk.bankrollSol - snap.exposureSol;
  if (sizeSol > free) {
    return deny(`bo'sh kapital yetarli emas (kerak ${sizeSol.toFixed(3)}, bor ${free.toFixed(3)})`);
  }

  return { allowed: true, reason: 'ok', sizeSol };
}
