import './env.js'; // config'dan OLDIN turishi shart — .env ni yuklaydi
import { config } from './config.js';
import { createLogger } from './logger.js';
import { PumpPortalStream } from './ingest/pumpportal.js';
import { TelegramBot, notify } from './telegram/bot.js';
import { insertToken, setTokenStatus } from './db/repo.js';
import { db } from './db/client.js';
import { aiTick, outcomeTick, positionsTick, screenTick } from './pipeline/loops.js';
import { isKillSwitchOn } from './risk/manager.js';
import { assertLiveTradingNotEnabled } from './trade/live.js';

const log = createLogger('main');

/**
 * Sikllarni bir-birining ustiga chiqmasdan ishlatadi.
 * Agar oldingi ish tugamagan bo'lsa, yangisini boshlamaymiz — bepul
 * tariflarda navbat to'planib ketishi limitlarni portlatadi.
 */
function everyMs(name: string, ms: number, fn: () => Promise<void>): NodeJS.Timeout {
  let running = false;

  const run = async () => {
    if (running) {
      log.debug('sikl hali ishlayapti, o\'tkazib yuborildi', { name });
      return;
    }
    running = true;
    const t0 = Date.now();
    try {
      await fn();
    } catch (err) {
      log.error('sikl xatosi', { name, error: String(err) });
    } finally {
      running = false;
      log.debug('sikl tugadi', { name, ms: Date.now() - t0 });
    }
  };

  void run();
  return setInterval(() => void run(), ms);
}

async function checkDatabase(): Promise<void> {
  const res = await db.from('bot_state').select('key').limit(1);
  if (res.error) {
    throw new Error(
      `Supabase'ga ulanib bo'lmadi yoki sxema yo'q: ${res.error.message}\n` +
        'supabase/schema.sql ni SQL Editor da ishga tushirganingizni tekshiring.',
    );
  }
}

async function main(): Promise<void> {
  log.info('SarMeme ishga tushmoqda', {
    mode: config.tradingMode,
    bankrollSol: config.risk.bankrollSol,
  });

  // Live rejim ataylab bloklangan — src/trade/live.ts ga qarang.
  if (config.tradingMode === 'live') assertLiveTradingNotEnabled();

  await checkDatabase();
  log.info('baza ulandi');

  const bot = new TelegramBot();
  bot.start();

  const stream = new PumpPortalStream({
    onNewToken: async (ev) => {
      await insertToken(ev);
      log.debug('yangi token', { mint: ev.mint, symbol: ev.symbol });
    },
    onMigration: async (mint) => {
      // Raydium'ga o'tish = bonding curve tugadi. Kuchli omon qolish signali.
      log.info('migratsiya', { mint });
      await setTokenStatus(mint, 'watching', 'raydium migratsiyasi');
    },
  });
  stream.start();

  const timers = [
    everyMs('screen', config.ticks.screenMs, screenTick),
    everyMs('ai', config.ticks.aiMs, aiTick),
    everyMs('positions', config.ticks.positionsMs, positionsTick),
    everyMs('outcome', 3_600_000, outcomeTick),
  ];

  const killed = await isKillSwitchOn();
  await notify(
    [
      '🚀 <b>SarMeme ishga tushdi</b>',
      '',
      `Rejim: ${config.tradingMode === 'paper' ? '📝 PAPER (virtual savdo)' : '💸 LIVE'}`,
      `Bankroll: ${config.risk.bankrollSol} SOL`,
      `Pozitsiya hajmi: ${config.risk.maxPositionPct}% (${((config.risk.bankrollSol * config.risk.maxPositionPct) / 100).toFixed(4)} SOL)`,
      `Minimal AI ball: ${config.minAiScore}`,
      killed ? '\n🛑 <b>Kill switch YOQILGAN</b> — /resume bilan o\'chiring' : '',
      '',
      '/help — buyruqlar',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  const shutdown = (signal: string) => {
    log.info('to\'xtatilmoqda', { signal });
    for (const t of timers) clearInterval(t);
    stream.stop();
    bot.stop();
    setTimeout(() => process.exit(0), 1500);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    log.error('ushlanmagan rejection', { reason: String(reason) });
  });
}

main().catch((err) => {
  log.error('ishga tushmadi', { error: String(err) });
  console.error(err);
  process.exit(1);
});
