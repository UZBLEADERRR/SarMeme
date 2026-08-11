import WebSocket from 'ws';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import type { NewTokenEvent } from '../types.js';

const log = createLogger('pumpportal');

type Handlers = {
  onNewToken: (ev: NewTokenEvent) => void | Promise<void>;
  onMigration?: (mint: string) => void | Promise<void>;
};

/**
 * PumpPortal'ning bepul WebSocket oqimi.
 * Kalit talab qilmaydi, real vaqtda yangi tokenlarni beradi.
 *
 * Ulanish uzilishi normal hodisa — eksponensial kutish bilan qayta ulanamiz
 * va o'lik ulanishni aniqlash uchun heartbeat ushlab turamiz.
 */
export class PumpPortalStream {
  private ws: WebSocket | null = null;
  private reconnectAttempt = 0;
  private heartbeat: NodeJS.Timeout | null = null;
  private lastMessageAt = Date.now();
  private closed = false;
  private seen = new Set<string>();

  constructor(private readonly handlers: Handlers) {}

  start(): void {
    this.closed = false;
    this.connect();
  }

  stop(): void {
    this.closed = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.ws?.close();
    this.ws = null;
  }

  private connect(): void {
    if (this.closed) return;
    log.info('ulanmoqda', { url: config.pumpportal.wsUrl });

    const ws = new WebSocket(config.pumpportal.wsUrl);
    this.ws = ws;

    ws.on('open', () => {
      this.reconnectAttempt = 0;
      this.lastMessageAt = Date.now();
      log.info('ulandi, obuna yuborilmoqda');
      ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
      if (this.handlers.onMigration) {
        ws.send(JSON.stringify({ method: 'subscribeMigration' }));
      }
      this.startHeartbeat();
    });

    ws.on('message', (raw) => {
      this.lastMessageAt = Date.now();
      void this.handleMessage(raw.toString());
    });

    ws.on('error', (err) => log.warn('soket xatosi', { error: String(err) }));

    ws.on('close', (code) => {
      log.warn('ulanish yopildi', { code });
      this.scheduleReconnect();
    });
  }

  private startHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    // 90 soniya jim tursa — ulanish o'lik deb hisoblaymiz.
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastMessageAt > 90_000) {
        log.warn('90s jim turdi, qayta ulanamiz');
        this.ws?.terminate();
      }
    }, 30_000);
  }

  private scheduleReconnect(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.closed) return;

    this.reconnectAttempt += 1;
    const delay = Math.min(60_000, 1000 * 2 ** Math.min(this.reconnectAttempt, 6));
    log.info('qayta ulanish rejalashtirildi', { delayMs: delay, attempt: this.reconnectAttempt });
    setTimeout(() => this.connect(), delay);
  }

  private async handleMessage(text: string): Promise<void> {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }

    // Obuna tasdiqlari va xizmat xabarlari
    if (typeof msg.message === 'string' && !msg.mint) {
      log.debug('xizmat xabari', msg.message);
      return;
    }

    const mint = typeof msg.mint === 'string' ? msg.mint : null;
    if (!mint) return;

    const txType = typeof msg.txType === 'string' ? msg.txType : null;

    if (txType === 'migrate' || msg.pool === 'raydium') {
      await this.handlers.onMigration?.(mint);
      return;
    }

    if (txType !== null && txType !== 'create') return;

    // Bir xil mint takror kelishi mumkin — xotirada oddiy dedup.
    if (this.seen.has(mint)) return;
    this.seen.add(mint);
    if (this.seen.size > 20_000) {
      // Xotira o'smasligi uchun eng eskilarini tashlaymiz.
      this.seen = new Set([...this.seen].slice(-10_000));
    }

    const ev: NewTokenEvent = {
      mint,
      symbol: typeof msg.symbol === 'string' ? msg.symbol : null,
      name: typeof msg.name === 'string' ? msg.name : null,
      creator:
        typeof msg.traderPublicKey === 'string'
          ? msg.traderPublicKey
          : typeof msg.creator === 'string'
            ? msg.creator
            : null,
      uri: typeof msg.uri === 'string' ? msg.uri : null,
      pool: typeof msg.pool === 'string' ? msg.pool : null,
      launchedAt: new Date(),
    };

    try {
      await this.handlers.onNewToken(ev);
    } catch (err) {
      log.error('yangi token qayta ishlanmadi', { mint, error: String(err) });
    }
  }
}
