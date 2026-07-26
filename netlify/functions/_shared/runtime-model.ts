import type { ModelClient } from '../../../src/types/analysis';
import { createMockModelClient } from '../../../src/lib/analysis/mock-model-client';
import { readAnalysisRuntimeLimits, readModelConfig } from './env';
import { createOpenAIModelClient } from './openai-model-client';

export interface RuntimeModelFactory {
  modelKey: string;
  requestTimeoutMs: number;
  retryDelayCapMs: number;
  createModel(requestTimeoutMs?: number): ModelClient;
}

export function createRuntimeModelFactory(
  source: Record<string, string | undefined>,
  production: boolean,
): RuntimeModelFactory {
  const mode = source.ANALYSIS_MODEL_MODE?.trim() || 'openai';
  if (mode === 'mock') {
    if (production) throw new Error('production 禁止使用 mock 分析模型');
    const limits = readAnalysisRuntimeLimits(source);
    return {
      modelKey: 'deterministic-mock',
      requestTimeoutMs: limits.modelTimeoutMs,
      retryDelayCapMs: limits.maxRetryDelayMs,
      createModel: () => createMockModelClient(),
    };
  }
  if (mode !== 'openai') throw new Error('ANALYSIS_MODEL_MODE 必须是 openai 或 mock');

  const limits = readAnalysisRuntimeLimits(source);
  const config = readModelConfig(source, production);
  return {
    modelKey: config.model,
    requestTimeoutMs: config.requestTimeoutMs ?? limits.modelTimeoutMs,
    retryDelayCapMs: config.maxRetryDelayMs ?? limits.maxRetryDelayMs,
    createModel: (requestTimeoutMs) => createOpenAIModelClient({
      ...config,
      requestTimeoutMs: requestTimeoutMs ?? config.requestTimeoutMs,
    }),
  };
}
