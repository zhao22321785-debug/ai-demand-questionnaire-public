import { z } from 'zod';

const publicEnvSchema = z
  .object({
    VITE_DATA_MODE: z.enum(['mock', 'supabase']).default('mock'),
    VITE_SUPABASE_URL: z.string().url().optional().or(z.literal('')),
    VITE_SUPABASE_PUBLISHABLE_KEY: z.string().optional().or(z.literal('')),
  })
  .superRefine((value, context) => {
    if (value.VITE_DATA_MODE !== 'supabase') return;
    if (!value.VITE_SUPABASE_URL) {
      context.addIssue({ code: 'custom', path: ['VITE_SUPABASE_URL'], message: 'Supabase 模式缺少项目地址' });
    }
    if (!value.VITE_SUPABASE_PUBLISHABLE_KEY) {
      context.addIssue({ code: 'custom', path: ['VITE_SUPABASE_PUBLISHABLE_KEY'], message: 'Supabase 模式缺少公开访问密钥' });
    }
  });

const parsed = publicEnvSchema.safeParse(import.meta.env);

if (!parsed.success) {
  throw new Error(`前端环境变量无效：${parsed.error.issues.map((issue) => issue.message).join('；')}`);
}

export const publicEnv = {
  dataMode: parsed.data.VITE_DATA_MODE,
  supabaseUrl: parsed.data.VITE_SUPABASE_URL || undefined,
  supabasePublishableKey: parsed.data.VITE_SUPABASE_PUBLISHABLE_KEY || undefined,
} as const;
