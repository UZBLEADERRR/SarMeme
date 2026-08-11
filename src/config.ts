/**
 * Barcha sozlamalar shu yerda o'qiladi va tekshiriladi.
 * Muhim: majburiy o'zgaruvchi yo'q bo'lsa, bot ishga tushmaydi —
 * yarim sozlangan holda savdo qilishdan ko'ra darrov to'xtagan yaxshi.
 */

function req(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Muhit o'zgaruvchisi yetishmayapti: ${name} (.env.example ga qarang)`);
  }
  return v.trim();
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v)) throw new Error(`${name} raqam bo'lishi kerak, keldi: ${raw}`);
  return v;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? fallback : raw.trim();
}

const tradingMode = str('TRADING_MODE', 'paper');
if (tradingMode !== 'paper' && tradingMode !== 'live') {
  throw new Error(`TRADING_MODE 'paper' yoki 'live' bo'lishi kerak, keldi: ${tradingMode}`);
}

export const config = {
  tradingMode: tradingMode as 'paper' | 'live',
  logLevel: str('LOG_LEVEL', 'info'),

  supabase: {
    url: req('SUPABASE_URL'),
    serviceKey: req('SUPABASE_SERVICE_KEY'),
  },

  rpc: {
    url: req('SOLANA_RPC_URL'),
    maxRps: num('RPC_MAX_RPS', 4),
  },

  pumpportal: {
    wsUrl: str('PUMPPORTAL_WS_URL', 'wss://pumpportal.fun/api/data'),
  },

  gemini: {
    apiKey: req('GEMINI_API_KEY'),
    modelFast: str('GEMINI_MODEL_FAST', 'gemini-2.5-flash'),
    modelDeep: str('GEMINI_MODEL_DEEP', 'gemini-2.5-pro'),
    batchSize: num('AI_BATCH_SIZE', 15),
  },

  telegram: {
    botToken: req('TELEGRAM_BOT_TOKEN'),
    chatId: req('TELEGRAM_CHAT_ID'),
  },

  /** Deterministik filtr chegaralari — AI bu qiymatlarga ta'sir qilmaydi. */
  filter: {
    minAgeMinutes: num('MIN_AGE_MINUTES', 5),
    maxAgeMinutes: num('MAX_AGE_MINUTES', 180),
    minLiquidityUsd: num('MIN_LIQUIDITY_USD', 8000),
    minVolume5mUsd: num('MIN_VOLUME_5M_USD', 2000),
    minHolders: num('MIN_HOLDERS', 60),
    maxTop10Pct: num('MAX_TOP10_PCT', 35),
    maxDevRugs: num('MAX_DEV_RUGS', 1),
  },

  /** Qattiq risk limitlari. Bularni AI ham, prompt ham o'zgartira olmaydi. */
  risk: {
    bankrollSol: num('BANKROLL_SOL', 2),
    maxPositionPct: num('MAX_POSITION_PCT', 4),
    dailyLossLimitPct: num('DAILY_LOSS_LIMIT_PCT', 10),
    maxOpenPositions: num('MAX_OPEN_POSITIONS', 5),
    maxTradesPerHour: num('MAX_TRADES_PER_HOUR', 10),
  },

  exit: {
    stopLossPct: num('STOP_LOSS_PCT', 25),
    takeProfitPct: num('TAKE_PROFIT_PCT', 60),
    trailingStopPct: num('TRAILING_STOP_PCT', 20),
    maxHoldMinutes: num('MAX_HOLD_MINUTES', 240),
  },

  minAiScore: num('MIN_AI_SCORE', 70),

  ticks: {
    screenMs: num('TICK_SCREEN_MS', 60_000),
    aiMs: num('TICK_AI_MS', 900_000),
    positionsMs: num('TICK_POSITIONS_MS', 30_000),
  },
} as const;

export type Config = typeof config;
