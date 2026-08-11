import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { fetchJson } from '../util/http.js';
import { sleep } from '../util/rate.js';
import { isKillSwitchOn, setKillSwitch, snapshot } from '../risk/manager.js';
import { latestCheck, listOpenPositions, pnlSince } from '../db/repo.js';
import { getMarketSnapshots } from '../market/dexscreener.js';

const log = createLogger('telegram');

const API = `https://api.telegram.org/bot${config.telegram.botToken}`;

/** HTML parse_mode uchun matnni xavfsizlantirish. */
function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Xabar yuboradi. Telegram tushib qolsa botni to'xtatmaymiz — faqat log. */
export async function notify(html: string): Promise<void> {
  try {
    await fetchJson(
      `${API}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.telegram.chatId,
          text: html.slice(0, 4000),
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      },
      { attempts: 2, timeoutMs: 10_000 },
    );
  } catch (err) {
    log.warn('xabar yuborilmadi', { error: String(err) });
  }
}

interface Update {
  update_id: number;
  message?: { chat?: { id?: number | string }; text?: string };
}

/**
 * Long polling bilan buyruqlarni qabul qiladi.
 * Faqat .env dagi TELEGRAM_CHAT_ID dan kelgan buyruqlar bajariladi.
 */
export class TelegramBot {
  private offset = 0;
  private running = false;

  start(): void {
    this.running = true;
    void this.loop();
    log.info('bot ishga tushdi');
  }

  stop(): void {
    this.running = false;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const res = await fetchJson<{ result?: Update[] }>(
          `${API}/getUpdates?timeout=25&offset=${this.offset}`,
          {},
          { attempts: 1, timeoutMs: 35_000 },
        );
        for (const u of res.result ?? []) {
          this.offset = u.update_id + 1;
          await this.handle(u);
        }
      } catch (err) {
        log.debug('getUpdates', { error: String(err) });
        await sleep(3000);
      }
    }
  }

  private async handle(u: Update): Promise<void> {
    const text = u.message?.text?.trim();
    const chatId = String(u.message?.chat?.id ?? '');
    if (!text) return;

    if (chatId !== String(config.telegram.chatId)) {
      log.warn('begona chatdan buyruq, e\'tiborsiz qoldirildi', { chatId });
      return;
    }

    const [cmdRaw, ...args] = text.split(/\s+/);
    const cmd = (cmdRaw ?? '').split('@')[0]?.toLowerCase() ?? '';

    try {
      switch (cmd) {
        case '/start':
        case '/help':
          await notify(HELP);
          break;
        case '/status':
          await notify(await statusText());
          break;
        case '/positions':
          await notify(await positionsText());
          break;
        case '/pnl':
          await notify(await pnlText());
          break;
        case '/kill':
          await setKillSwitch(true, 'Telegram buyrug\'i');
          await notify('🛑 <b>Kill switch YOQILDI</b>\nYangi pozitsiya ochilmaydi.\nQayta yoqish: /resume');
          break;
        case '/resume':
          await setKillSwitch(false, 'Telegram buyrug\'i');
          await notify('✅ <b>Kill switch o\'chirildi</b>\nBot yana signal qabul qiladi.');
          break;
        case '/token':
          await notify(await tokenText(args[0]));
          break;
        default:
          break;
      }
    } catch (err) {
      log.error('buyruq bajarilmadi', { cmd, error: String(err) });
      await notify(`⚠️ Buyruq bajarilmadi: ${esc(String(err))}`);
    }
  }
}

const HELP = `<b>SarMeme</b> — buyruqlar

/status — rejim, risk holati, limitlar
/positions — ochiq pozitsiyalar
/pnl — bugungi va umumiy natija
/token &lt;mint&gt; — token bo'yicha oxirgi ma'lumot
/kill — darhol to'xtatish (yangi kirish yo'q)
/resume — kill switch'ni o'chirish`;

async function statusText(): Promise<string> {
  const s = await snapshot();
  const mode = config.tradingMode === 'paper' ? '📝 PAPER (virtual)' : '💸 LIVE';

  return [
    `<b>Holat</b>`,
    `Rejim: ${mode}`,
    `Kill switch: ${s.killSwitch ? '🛑 YOQILGAN' : '✅ o\'chiq'}`,
    ``,
    `Ochiq pozitsiya: ${s.openPositions}/${config.risk.maxOpenPositions}`,
    `Band kapital: ${s.exposureSol.toFixed(4)} / ${config.risk.bankrollSol} SOL`,
    `Oxirgi soatda savdo: ${s.tradesLastHour}/${config.risk.maxTradesPerHour}`,
    ``,
    `Bugungi PnL: ${s.dailyPnlSol >= 0 ? '+' : ''}${s.dailyPnlSol.toFixed(4)} SOL`,
    `Kunlik zarar limiti: ${s.dailyLossLimitSol.toFixed(4)} SOL`,
    `Minimal AI ball: ${config.minAiScore}`,
  ].join('\n');
}

async function positionsText(): Promise<string> {
  const open = await listOpenPositions();
  if (open.length === 0) return '<b>Ochiq pozitsiya yo\'q.</b>';

  const markets = await getMarketSnapshots(open.map((p) => p.mint));
  const lines = ['<b>Ochiq pozitsiyalar</b>', ''];

  for (const p of open) {
    const price = markets.get(p.mint)?.priceNativeSol ?? null;
    const pct = price === null ? null : ((price - p.entryPrice) / p.entryPrice) * 100;
    const held = ((Date.now() - p.entryAt.getTime()) / 60_000).toFixed(0);
    const pctText =
      pct === null ? 'narx yo\'q' : `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
    const icon = pct === null ? '❓' : pct >= 0 ? '🟢' : '🔴';

    lines.push(
      `${icon} <b>${esc(p.symbol ?? p.mint.slice(0, 8))}</b> ${pctText}`,
      `   ${p.solIn.toFixed(4)} SOL · ball ${p.entryScore ?? '?'} · ${held} daq`,
      `   <code>${esc(p.mint)}</code>`,
      '',
    );
  }
  return lines.join('\n');
}

async function pnlText(): Promise<string> {
  const now = new Date();
  const day = await pnlSince(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
  );
  const week = await pnlSince(new Date(Date.now() - 7 * 86_400_000));
  const all = await pnlSince(new Date(0));

  const fmt = (v: { realizedSol: number; trades: number }) =>
    `${v.realizedSol >= 0 ? '+' : ''}${v.realizedSol.toFixed(4)} SOL (${v.trades} savdo)`;

  const avg = all.trades > 0 ? all.realizedSol / all.trades : 0;

  return [
    '<b>Natija</b> (yopilgan pozitsiyalar)',
    '',
    `Bugun: ${fmt(day)}`,
    `7 kun: ${fmt(week)}`,
    `Umumiy: ${fmt(all)}`,
    '',
    `O'rtacha savdo: ${avg >= 0 ? '+' : ''}${avg.toFixed(5)} SOL`,
    `Bankroll: ${config.risk.bankrollSol} SOL`,
  ].join('\n');
}

async function tokenText(mint: string | undefined): Promise<string> {
  if (!mint) return 'Foydalanish: <code>/token &lt;mint&gt;</code>';

  const check = await latestCheck(mint);
  if (!check) return `Bu mint bo'yicha tekshiruv topilmadi:\n<code>${esc(mint)}</code>`;

  const market = (await getMarketSnapshots([mint])).get(mint);
  const flags = Array.isArray(check.flags) ? (check.flags as string[]) : [];

  return [
    `<b>${esc(mint.slice(0, 12))}…</b>`,
    '',
    `Filtr: ${check.passed ? '✅ o\'tdi' : '❌ o\'tmadi'}`,
    flags.length > 0 ? `Belgilar: ${esc(flags.join(', '))}` : 'Belgilar: yo\'q',
    '',
    `Likvidlik: $${Number(check.liquidity_usd ?? 0).toFixed(0)}`,
    `Kapitalizatsiya: $${Number(check.market_cap_usd ?? 0).toFixed(0)}`,
    `Top-10 ulush: ${check.top10_pct === null ? 'noma\'lum' : `${Number(check.top10_pct).toFixed(1)}%`}`,
    `Xolderlar: ${check.holder_count ?? 'noma\'lum'}`,
    '',
    `Hozirgi narx (SOL): ${market?.priceNativeSol ?? 'noma\'lum'}`,
    `<a href="https://dexscreener.com/solana/${esc(mint)}">DexScreener</a>`,
  ].join('\n');
}
