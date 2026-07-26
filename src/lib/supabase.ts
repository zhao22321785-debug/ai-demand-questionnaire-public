import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { publicEnv } from './env';

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (client) return client;
  if (!publicEnv.supabaseUrl || !publicEnv.supabasePublishableKey) {
    throw new Error('Supabase 尚未配置。请在本地环境文件中设置项目地址和公开访问密钥。');
  }

  client = createClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return client;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(publicEnv.supabaseUrl && publicEnv.supabasePublishableKey);
}
