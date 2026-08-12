import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { createMemoryStore } from './memory.js';
import { createSupabaseStore, verifySupabase } from './supabase.js';
import type { Store } from './types.js';

const log = createLogger('store');

/**
 * Faol baza. Boshlang'ich qiymat — xotira, shuning uchun `initStore()`
 * chaqirilmasa ham (masalan testda) kod ishlaydi.
 */
let active: Store = createMemoryStore();

export function getStore(): Store {
  return active;
}

/**
 * Bazani tanlaydi va ulanishni tekshiradi.
 *
 * Supabase sozlangan bo'lsa unga ulanamiz. Ulanib bo'lmasa — botni
 * to'xtatmaymiz, xotiradagi bazaga o'tamiz va buni baland ovozda
 * ogohlantiramiz. Ishlamayotgan bot ishlayotgan lekin vaqtinchalik
 * bazadagi botdan yomonroq.
 */
export async function initStore(): Promise<Store> {
  const { url, serviceKey } = config.supabase;

  if (url && serviceKey) {
    try {
      await verifySupabase(url, serviceKey);
      active = createSupabaseStore(url, serviceKey);
      log.info('Supabase ulandi');
      return active;
    } catch (err) {
      log.warn('Supabase ishlamadi, xotiradagi bazaga o\'tildi', { error: String(err) });
    }
  } else {
    log.info('Supabase sozlanmagan — xotiradagi baza ishlatiladi');
  }

  active = createMemoryStore();
  return active;
}

export type { Store } from './types.js';
export type { AnalysisRow, CheckRow, JournalRow, TokenRow } from './types.js';
