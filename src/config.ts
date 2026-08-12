/**
 * Sozlamalar.
 *
 * Tamoyil: MAJBURIY o'zgaruvchi YO'Q. Nima berilgan bo'lsa, o'sha ishlaydi;
 * berilmagani o'rniga xavfsiz zaxira variant ishlatiladi. Shu tufayli botni
 * hech narsa sozlamasdan ishga tushirib, UI'da nima qila olishini ko'rish mumkin.
 *
 *   Supabase yo'q   → xotiradagi baza (qayta ishga tushganda tozalanadi)
 *   Gemini yo'q     → evristik ballchi (AI o'rniga formula)
 *   Telegram yo'q   → xabarlar konsolga va UI'ga chiqadi
 *   RPC yo'q        → zanjir tekshiruvi o'tkazib yuboriladi (yumshoq belgi)
 *
 * PumpPortal va DexScreener kalit talab qilmaydi, shuning uchun tokenlar
 * oqimi va narxlar demo rejimda ham HAQIQIY bo'ladi.
 */

function opt(name: string): string | null {
  const v = process.env[name];
  if (!v) return null;
  const t = v.trim();
  // .env.example dan ko'chirilgan to'ldirilmagan qiymatlarni ham bo'sh deb hisoblaymiz
  if (t === '' || t.startsWith('YOUR_') || t.includes('xxxxxxxxxxxx')) return null;
  return t;
}

function num(name: string, fallback: number): number {
  const raw = opt(name);
  if (raw === null) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

function str(name: string, fallback: string): string {
  return opt(name) ?? fallback;
}

const supabaseUrl = opt('SUPABASE_URL');
const supabaseKey = opt('SUPABASE_SERVICE_KEY');
const geminiKey = opt('GEMINI_API_KEY');
const telegramToken = opt('TELEGRAM_BOT_TOKEN');
const telegramChat = opt('TELEGRAM_CHAT_ID');
const rpcUrl = opt('SOLANA_RPC_URL');

const hasSupabase = supabaseUrl !== null && supabaseKey !== null;
const hasTelegram = telegramToken !== null && telegramChat !== null;

const rawMode = str('TRADING_MODE', 'paper');
const tradingMode: 'paper' | 'live' = rawMode === 'live' ? 'live' : 'paper';

/** Sun'iy ma'lumot bilan namoyish rejimi. */
const simulate = (opt('SIMULATE') ?? '').toLowerCase() === 'true';

export const config = {
  tradingMode,
  simulate,
  logLevel: str('LOG_LEVEL', 'info'),

  /** Nimalar mavjud — butun tizim shu bayroqlarga qarab moslashadi. */
  capabilities: {
    database: hasSupabase ? ('supabase' as const) : ('memory' as const),
    ai: geminiKey ? ('gemini' as const) : ('heuristic' as const),
    telegram: hasTelegram,
    chain: rpcUrl !== null,
  },

  /** Hech narsa sozlanmagan bo'lsa — to'liq demo. */
  get isDemo(): boolean {
    return !hasSupabase && !geminiKey && !hasTelegram;
  },

  web: {
    port: num('PORT', 3000),
    /** Bo'sh bo'lsa dashboard ochiq. Railway'da qiymat berib qo'ying. */
    token: opt('DASHBOARD_TOKEN'),
  },

  supabase: { url: supabaseUrl, serviceKey: supabaseKey },
  rpc: { url: rpcUrl, maxRps: num('RPC_MAX_RPS', 4) },
  pumpportal: { wsUrl: str('PUMPPORTAL_WS_URL', 'wss://pumpportal.fun/api/data') },

  gemini: {
    apiKey: geminiKey,
    modelFast: str('GEMINI_MODEL_FAST', 'gemini-2.5-flash'),
    modelDeep: str('GEMINI_MODEL_DEEP', 'gemini-2.5-pro'),
    batchSize: num('AI_BATCH_SIZE', 15),
  },

  telegram: { botToken: telegramToken, chatId: telegramChat },

  filter: {
    minAgeMinutes: num('MIN_AGE_MINUTES', 5),
    maxAgeMinutes: num('MAX_AGE_MINUTES', 180),
    minLiquidityUsd: num('MIN_LIQUIDITY_USD', 8000),
    minVolume5mUsd: num('MIN_VOLUME_5M_USD', 2000),
    minHolders: num('MIN_HOLDERS', 60),
    maxTop10Pct: num('MAX_TOP10_PCT', 35),
    maxDevRugs: num('MAX_DEV_RUGS', 1),
  },

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
    // Simulyatsiyada qisqa: vaqt bo'yicha chiqish qoidasi ham ko'rinsin
    maxHoldMinutes: num('MAX_HOLD_MINUTES', simulate ? 5 : 240),
  },

  minAiScore: num('MIN_AI_SCORE', 70),

  ticks: {
    screenMs: num('TICK_SCREEN_MS', simulate ? 10_000 : 60_000),
    aiMs: num('TICK_AI_MS', simulate ? 20_000 : 900_000),
    positionsMs: num('TICK_POSITIONS_MS', simulate ? 10_000 : 30_000),
  },
};

/** Ishga tushganda ko'rsatiladigan holat matni. */
export function capabilityReport(): string[] {
  const c = config.capabilities;
  return [
    `Baza:     ${c.database === 'supabase' ? 'Supabase' : 'xotira (vaqtinchalik)'}`,
    `AI:       ${c.ai === 'gemini' ? `Gemini (${config.gemini.modelFast})` : 'evristik ballchi'}`,
    `Telegram: ${c.telegram ? 'ulangan' : "yo'q (xabarlar UI'da)"}`,
    `Zanjir:   ${c.chain ? 'RPC ulangan' : "RPC yo'q (tekshiruv o'tkazib yuboriladi)"}`,
    `Rejim:    ${config.simulate ? "SIMULYATSIYA (sun'iy ma'lumot)" : 'haqiqiy oqim'}`,
  ];
}
