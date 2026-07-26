import { z } from 'zod';
import { readAnalysisRuntimeLimits } from './_shared/env';
import { errorResponse, jsonResponse, readJsonBody } from './_shared/http';
import { runAnalysisJob } from './_shared/analysis-service';
import { createRuntimeModelFactory } from './_shared/runtime-model';
import { envValue, isProductionRuntime, requireEnv, type FunctionRuntimeContext } from './_shared/runtime-env';
import { createSupabaseAdminClient } from './_shared/supabase-admin';
import { SupabaseAnalysisStore } from './_shared/supabase-analysis-store';

const requestSchema = z.object({
  subjectType: z.enum(['employee_assessment', 'position_survey']),
  subjectId: z.string().uuid(),
  revision: z.number().int().positive(),
}).strict();

export default async function handler(request: Request, context?: FunctionRuntimeContext): Promise<Response> {
  try {
    if (request.headers.get('x-analysis-secret') !== requireEnv('ANALYSIS_INTERNAL_SECRET')) return new Response('禁止访问', { status: 403 });
    const analysis = requestSchema.parse(await readJsonBody(request));
    const client = createSupabaseAdminClient();
    const runtimeModel = createRuntimeModelFactory({
      ANALYSIS_MODEL_MODE: envValue('ANALYSIS_MODEL_MODE'),
      OPENAI_API_KEY: envValue('OPENAI_API_KEY'),
      OPENAI_BASE_URL: envValue('OPENAI_BASE_URL'),
      OPENAI_ALLOWED_HOSTS: envValue('OPENAI_ALLOWED_HOSTS'),
      OPENAI_MODEL: envValue('OPENAI_MODEL'),
      ANALYSIS_MODEL_TIMEOUT_MS: envValue('ANALYSIS_MODEL_TIMEOUT_MS'),
      ANALYSIS_MAX_RESPONSE_BYTES: envValue('ANALYSIS_MAX_RESPONSE_BYTES'),
      ANALYSIS_MAX_OUTPUT_TOKENS: envValue('ANALYSIS_MAX_OUTPUT_TOKENS'),
      ANALYSIS_MAX_RETRY_DELAY_MS: envValue('ANALYSIS_MAX_RETRY_DELAY_MS'),
    }, isProductionRuntime(context));
    const limits = readAnalysisRuntimeLimits({ ANALYSIS_USER_DAILY_LIMIT: envValue('ANALYSIS_USER_DAILY_LIMIT') });
    const result = await runAnalysisJob(analysis, {
      model: runtimeModel.createModel(),
      store: new SupabaseAnalysisStore(client, runtimeModel.modelKey, limits.userDailyLimit),
      retryDelayCapMs: runtimeModel.retryDelayCapMs,
    });
    return jsonResponse({ accepted: true, status: result.status });
  } catch (error) {
    return errorResponse(error);
  }
}

export const config = { path: '/api/internal/analyze-background', method: 'POST' };
