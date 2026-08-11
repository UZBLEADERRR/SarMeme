import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';

/**
 * service_role kaliti bilan ulanamiz — bu server-side jarayon,
 * RLS aylanib o'tiladi. Kalit hech qachon mijozga chiqmasligi kerak.
 */
export const db: SupabaseClient = createClient(config.supabase.url, config.supabase.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
