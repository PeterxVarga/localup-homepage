// ============================================================
// Supabase server client — service role for backend operations
// ============================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

let supabase: SupabaseClient | undefined;

export function isSupabaseConfigured(): boolean {
  return !!(env.supabaseUrl && env.supabaseServiceRoleKey);
}

/**
 * Returns the shared Supabase service-role client.
 * Throws if Supabase is not configured — call isSupabaseConfigured() first.
 */
export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    );
  }

  if (!supabase) {
    supabase = createClient(env.supabaseUrl!, env.supabaseServiceRoleKey!, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return supabase;
}
