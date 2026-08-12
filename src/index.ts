import './env.js'; // config'dan OLDIN turishi shart — .env ni yuklaydi
import { capabilityReport, config } from './config.js';
import { createLogger } from './logger.js';
import { startWebServer } from './web/server.js';
import { PumpPortalStream } from './ingest/pumpportal.js';
import { TelegramBot } from './telegram/bot.js';
import { notify } from './notify.js';
import { getStore, initStore } from './store/index.js';
import { aiTick, outcomeTick, positionsTick, screenTick } from './pipeline/loops.js';
import { isKillSwitchOn } from './risk/manager.js';
import { assertLiveTradingNotEnabled } from './trade/live.js';
import { startSimulator } from './demo/simulator.js';

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

async function main(): Promise<void> {
  log.info('SarMeme ishga tushmoqda');
  for (const line of capabilityReport()) log.info('  ' + line);
  if (config.isDemo) {
    log.warn('DEMO REJIM — hech narsa sozlanmagan. Dashboard ishlaydi, ma\'lumot vaqtinchalik.');
  }

  // Live rejim ataylab bloklangan — src/trade/live.ts ga qarang.
  if (config.tradingMode === 'live') assertLiveTradingNotEnabled();

  await initStore();

  // Dashboard birinchi ishga tushadi: qolgan qismi yiqilsa ham
  // brauzerda holatni ko'rish imkoni qoladi.
  startWebServer();

  const bot = new TelegramBot();
  bot.start();

  // Simulyatsiya yoqilgan bo'lsa haqiqiy oqimga ulanmaymiz — sun'iy tokenlar
  // haqiqiylari bilan aralashib ketmasligi kerak.
  let simTimer: NodeJS.Timeout | null = null;
  if (config.simulate) {
    simTimer = startSimulator();
  } else if (config.isDemo) {
    log.info("Namoyish uchun sun'iy ma'lumot bilan ko'rmoqchi bo'lsangiz: SIMULATE=true");
  }

  const stream = new PumpPortalStream({
    onNewToken: async (ev) => {
      await getStore().insertToken(ev);
      log.debug('yangi token', { mint: ev.mint, symbol: ev.symbol });
    },
    onMigration: async (mint) => {
      // Raydium'ga o'tish = bonding curve tugadi. Kuchli omon qolish signali.
      log.info('migratsiya', { mint });
      await getStore().setTokenStatus(mint, 'watching', 'raydium migratsiyasi');
    },
  });
  if (!config.simulate) stream.start();

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
      `AI: ${config.capabilities.ai === 'gemini' ? config.gemini.modelFast : 'evristik ballchi'}`,
      `Baza: ${config.capabilities.database === 'supabase' ? 'Supabase' : 'xotira (vaqtinchalik)'}`,
      killed ? '\n🛑 <b>Kill switch YOQILGAN</b>' : '',
      '',
      `Dashboard: <code>:${config.web.port}</code>`,
    ]
      .filter(Boolean)
      .join('\n'),
  );

  const shutdown = (signal: string) => {
    log.info('to\'xtatilmoqda', { signal });
    for (const t of timers) clearInterval(t);
    if (simTimer) clearInterval(simTimer);
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
