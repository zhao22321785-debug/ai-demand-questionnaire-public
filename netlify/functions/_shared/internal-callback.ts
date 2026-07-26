import type { AnalysisRequest } from '../../../src/types/analysis';
import { readCallbackOrigin } from './env';
import { envValue, requireEnv } from './runtime-env';

export async function dispatchAnalysisCallback(
  path: '/api/internal/analyze-background',
  analysis: AnalysisRequest,
  production = false,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const origin = readCallbackOrigin(envValue('ANALYSIS_CALLBACK_ORIGIN'), production);
  await fetcher(new URL(path, origin).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-analysis-secret': requireEnv('ANALYSIS_INTERNAL_SECRET') },
    body: JSON.stringify(analysis),
    redirect: 'manual',
  });
}
