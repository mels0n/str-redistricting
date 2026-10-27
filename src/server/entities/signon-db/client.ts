import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadDbConfig } from '../../shared/config/backend.js';

let client: SupabaseClient | null = null;

/** The service-role client (server only). No session is kept. */
export function db(): SupabaseClient {
  if (!client) {
    const cfg = loadDbConfig();
    client = createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}

/** A cheap round trip to the database (the supabase client has no raw `select 1`). Throws if it cannot be reached. */
export async function ping(): Promise<void> {
  const { error } = await db().from('asks').select('id', { head: true }).limit(1);
  if (error) throw new Error('database unreachable');
}
