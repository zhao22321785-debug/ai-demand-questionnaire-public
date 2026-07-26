import { readAggregateSampleSize } from './_shared/env';
import { errorResponse, jsonResponse } from './_shared/http';
import { createRuntimeModelFactory } from './_shared/runtime-model';
import { envValue, isProductionRuntime, requireEnv, type FunctionRuntimeContext } from './_shared/runtime-env';
import { createSupabaseAdminClient } from './_shared/supabase-admin';
import { runAggregateAnalysis } from './_shared/aggregate-service';

export default async function handler(request: Request, context?: FunctionRuntimeContext): Promise<Response> {
  try {
    if (request.headers.get('x-analysis-secret') !== requireEnv('ANALYSIS_INTERNAL_SECRET')) return new Response('禁止访问', { status: 403 });
    const runtimeModel = createRuntimeModelFactory({
      ANALYSIS_MODEL_MODE: envValue('ANALYSIS_MODEL_MODE'),
      OPENAI_API_KEY: envValue('OPENAI_API_KEY'), OPENAI_BASE_URL: envValue('OPENAI_BASE_URL'), OPENAI_ALLOWED_HOSTS: envValue('OPENAI_ALLOWED_HOSTS'), OPENAI_MODEL: envValue('OPENAI_MODEL'),
      ANALYSIS_MODEL_TIMEOUT_MS: envValue('ANALYSIS_MODEL_TIMEOUT_MS'), ANALYSIS_MAX_RESPONSE_BYTES: envValue('ANALYSIS_MAX_RESPONSE_BYTES'),
      ANALYSIS_MAX_OUTPUT_TOKENS: envValue('ANALYSIS_MAX_OUTPUT_TOKENS'), ANALYSIS_MAX_RETRY_DELAY_MS: envValue('ANALYSIS_MAX_RETRY_DELAY_MS'),
    }, isProductionRuntime(context));
    const result = await runAggregateAnalysis({
      client: createSupabaseAdminClient(), model: runtimeModel.createModel(), modelKey: runtimeModel.modelKey,
      minSampleSize: readAggregateSampleSize(envValue('MIN_AGGREGATE_SAMPLE_SIZE'), isProductionRuntime(context)),
    });
    return jsonResponse({ accepted: true, result: result ? 'updated' : 'empty' });
  } catch (error) {
    return errorResponse(error);
  }
}

export const config = { path: '/api/internal/aggregate', method: 'POST' };
