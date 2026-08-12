import { createLogger } from './logger.js';

const log = createLogger('notify');

export interface Notification {
  id: number;
  at: Date;
  /** HTML teglari olib tashlangan sof matn — UI uchun. */
  text: string;
  html: string;
}

type Sink = (html: string) => Promise<void>;

const buffer: Notification[] = [];
const sinks: Sink[] = [];
let counter = 0;
const MAX = 200;

/** Telegram (yoki boshqa kanal) o'zini shu yerga ulaydi. */
export function addSink(sink: Sink): void {
  sinks.push(sink);
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Bildirishnoma yuboradi.
 *
 * Har doim xotiraga yoziladi (dashboard shu yerdan o'qiydi) va logga chiqadi.
 * Telegram ulangan bo'lsa — unga ham. Telegram yo'qligi xato emas: bot
 * baribir ishlaydi, xabarlarni brauzerda ko'rasiz.
 */
export async function notify(html: string): Promise<void> {
  const item: Notification = {
    id: ++counter,
    at: new Date(),
    html,
    text: stripHtml(html),
  };

  buffer.push(item);
  if (buffer.length > MAX) buffer.splice(0, buffer.length - MAX);

  log.info(item.text.split('\n')[0] ?? '');

  for (const sink of sinks) {
    try {
      await sink(html);
    } catch (err) {
      log.warn('kanal xatosi', { error: String(err) });
    }
  }
}

export function recentNotifications(limit = 50): Notification[] {
  return buffer.slice(-limit).reverse();
}
