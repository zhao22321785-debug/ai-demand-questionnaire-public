import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireEnv } from './runtime-env';

export function createSupabaseAdminClient(): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
