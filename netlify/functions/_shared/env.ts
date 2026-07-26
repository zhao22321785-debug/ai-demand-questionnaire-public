import { z } from 'zod';
import type { ModelConfig } from '../../../src/types/analysis';

const modelConfigSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, '缺少 OPENAI_API_KEY'),
  OPENAI_BASE_URL: z.preprocess(
    (value) => value === '' || value == null ? undefined : value,
    z.string().url('OPENAI_BASE_URL 必须是有效 URL').optional(),
  ),
  OPENAI_ALLOWED_HOSTS: z.string().optional(),
  OPENAI_MODEL: z.string().min(1, '缺少 OPENAI_MODEL'),
});

export interface AnalysisRuntimeLimits {
  modelTimeoutMs: number;
  maxResponseBytes: number;
  maxOutputTokens: number;
  maxRetryDelayMs: number;
  userDailyLimit: number;
  adminRetryCooldownSeconds: number;
  adminDailyRetryLimit: number;
  reconcileBudgetMs: number;
  reconcileJobLimit: number;
}

function boundedInteger(source: Record<string, string | undefined>, name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(source[name] ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} 必须是 ${min}–${max} 的整数`);
  return parsed;
}

export function readAnalysisRuntimeLimits(source: Record<string, string | undefined>): AnalysisRuntimeLimits {
  return {
    modelTimeoutMs: boundedInteger(source, 'ANALYSIS_MODEL_TIMEOUT_MS', 45_000, 1_000, 120_000),
    maxResponseBytes: boundedInteger(source, 'ANALYSIS_MAX_RESPONSE_BYTES', 524_288, 16_384, 2_097_152),
    maxOutputTokens: boundedInteger(source, 'ANALYSIS_MAX_OUTPUT_TOKENS', 2_000, 256, 8_000),
    maxRetryDelayMs: boundedInteger(source, 'ANALYSIS_MAX_RETRY_DELAY_MS', 60_000, 1_000, 300_000),
    userDailyLimit: boundedInteger(source, 'ANALYSIS_USER_DAILY_LIMIT', 5, 1, 100),
    adminRetryCooldownSeconds: boundedInteger(source, 'ANALYSIS_ADMIN_RETRY_COOLDOWN_SECONDS', 300, 30, 86_400),
    adminDailyRetryLimit: boundedInteger(source, 'ANALYSIS_ADMIN_DAILY_RETRY_LIMIT', 10, 1, 100),
    reconcileBudgetMs: boundedInteger(source, 'ANALYSIS_RECONCILE_BUDGET_MS', 50_000, 5_000, 120_000),
    reconcileJobLimit: boundedInteger(source, 'ANALYSIS_RECONCILE_JOB_LIMIT', 5, 1, 20),
  };
}

function isIpLiteral(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');
}

function validateModelBaseUrl(raw: string, allowedHosts: Set<string>, production: boolean): string {
  const url = new URL(raw);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (url.username || url.password) throw new Error('OPENAI_BASE_URL 不得包含 credentials');
  if (url.protocol !== 'https:' && (production || url.protocol !== 'http:')) throw new Error('正式环境 OPENAI_BASE_URL 必须使用 HTTPS');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || isIpLiteral(hostname)) {
    throw new Error('OPENAI_BASE_URL 不得指向 localhost、私网、link-local 或 IP 目标');
  }
  if (hostname !== 'api.openai.com' && !allowedHosts.has(hostname)) {
    throw new Error('兼容网关 host 必须显式加入 OPENAI_ALLOWED_HOSTS');
  }
  return raw.replace(/\/$/, '');
}

export function readModelConfig(source: Record<string, string | undefined>, production = false): ModelConfig {
  const value = modelConfigSchema.parse(source);
  const limits = readAnalysisRuntimeLimits(source);
  const allowedHosts = new Set((value.OPENAI_ALLOWED_HOSTS ?? '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean));
  const baseURL = validateModelBaseUrl(value.OPENAI_BASE_URL ?? 'https://api.openai.com/v1', allowedHosts, production);
  return {
    apiKey: value.OPENAI_API_KEY,
    baseURL,
    model: value.OPENAI_MODEL,
    requestTimeoutMs: limits.modelTimeoutMs,
    maxResponseBytes: limits.maxResponseBytes,
    maxOutputTokens: limits.maxOutputTokens,
    maxRetryDelayMs: limits.maxRetryDelayMs,
  };
}

export function readCallbackOrigin(value: string | undefined, production = false): string {
  if (!value) throw new Error('缺少 ANALYSIS_CALLBACK_ORIGIN');
  const url = new URL(value);
  if (url.username || url.password) throw new Error('ANALYSIS_CALLBACK_ORIGIN 不得包含 credentials');
  const isLocalhost = url.hostname.toLowerCase() === 'localhost';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalhost && !production)) {
    throw new Error('ANALYSIS_CALLBACK_ORIGIN 必须使用 HTTPS；仅非生产 localhost 可使用 HTTP');
  }
  return url.origin;
}

export function readAggregateSampleSize(value: string | undefined, production = false): number {
  if (production && !value) throw new Error('正式环境必须显式配置 MIN_AGGREGATE_SAMPLE_SIZE');
  const parsed = Number(value ?? '3');
  if (!Number.isInteger(parsed) || parsed < 2 || parsed > 100) throw new Error('MIN_AGGREGATE_SAMPLE_SIZE 必须是 2–100 的整数');
  return parsed;
}
