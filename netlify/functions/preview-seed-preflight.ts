import { errorResponse, jsonResponse } from './_shared/http';
import { createRuntimeModelFactory } from './_shared/runtime-model';
import {
  envValue,
  isProductionRuntime,
  requireEnv,
  type FunctionRuntimeContext,
} from './_shared/runtime-env';

const APPROVED_PROJECT_REF = 'exampleprojectref123';
const APPROVED_SUPABASE_HOST = `${APPROVED_PROJECT_REF}.supabase.co`;
const APPROVED_MODEL_KEY = 'deterministic-mock';
const ALLOWED_DEPLOY_CONTEXTS = new Set(['branch-deploy', 'deploy-preview']);

function approvedSupabaseHost(value: string | undefined): string {
  if (!value) throw new Error('SUPABASE_URL 未配置');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('SUPABASE_URL 无效');
  }
  if (
    url.protocol !== 'https:'
    || url.hostname !== APPROVED_SUPABASE_HOST
    || url.port
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
  ) {
    throw new Error('SUPABASE_URL 不属于批准的预览项目');
  }
  return url.hostname;
}

export default async function handler(request: Request, context?: FunctionRuntimeContext): Promise<Response> {
  try {
    if (request.headers.get('x-analysis-secret') !== requireEnv('ANALYSIS_INTERNAL_SECRET')) {
      return new Response('禁止访问', { status: 403 });
    }
    const deployContext = context?.deploy?.context;
    if (!deployContext || !ALLOWED_DEPLOY_CONTEXTS.has(deployContext)) {
      throw new Error('预览数据 preflight 仅允许 branch-deploy 或 deploy-preview');
    }
    const supabaseHost = approvedSupabaseHost(envValue('SUPABASE_URL'));
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
    if (runtimeModel.modelKey !== APPROVED_MODEL_KEY) throw new Error('预览数据必须使用 deterministic mock 模型');
    return jsonResponse({
      accepted: true,
      deployContext,
      supabaseProjectRef: APPROVED_PROJECT_REF,
      supabaseHost,
      modelKey: runtimeModel.modelKey,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export const config = { path: '/api/internal/preview-seed-preflight', method: 'GET' };
