import type { AnalysisRequest } from '../../src/types/analysis';
import { readAggregateSampleSize, readAnalysisRuntimeLimits } from './_shared/env';
import { createRuntimeModelFactory } from './_shared/runtime-model';
import { runAnalysisJob } from './_shared/analysis-service';
import { envValue, isProductionRuntime, type FunctionRuntimeContext } from './_shared/runtime-env';
import { createSupabaseAdminClient } from './_shared/supabase-admin';
import { isMissingRpcError, SupabaseAnalysisStore } from './_shared/supabase-analysis-store';
import { runAggregateAnalysis } from './_shared/aggregate-service';

export async function processWithBudget<T>(items: T[], options: {
  budgetMs: number;
  minimumRemainingMs: number;
  now?: () => number;
  run: (item: T, remainingMs: number) => Promise<void>;
  onError?: (item: T, error: unknown) => void;
}): Promise<{ processed: number; remainingMs: number }> {
  const now = options.now ?? Date.now;
  const deadline = now() + options.budgetMs;
  let processed = 0;
  for (const item of items) {
    const before = Math.max(0, deadline - now());
    if (before < options.minimumRemainingMs) break;
    try {
      await options.run(item, before);
    } catch (error) {
      options.onError?.(item, error);
    }
    processed += 1;
  }
  return { processed, remainingMs: Math.max(0, deadline - now()) };
}

export default async function handler(_request?: Request, context?: FunctionRuntimeContext): Promise<void> {
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
    ANALYSIS_USER_DAILY_LIMIT: envValue('ANALYSIS_USER_DAILY_LIMIT'),
  }, isProductionRuntime(context));
  const limits = readAnalysisRuntimeLimits({
    ANALYSIS_MODEL_TIMEOUT_MS: envValue('ANALYSIS_MODEL_TIMEOUT_MS'),
    ANALYSIS_MAX_RESPONSE_BYTES: envValue('ANALYSIS_MAX_RESPONSE_BYTES'),
    ANALYSIS_MAX_OUTPUT_TOKENS: envValue('ANALYSIS_MAX_OUTPUT_TOKENS'),
    ANALYSIS_MAX_RETRY_DELAY_MS: envValue('ANALYSIS_MAX_RETRY_DELAY_MS'),
    ANALYSIS_USER_DAILY_LIMIT: envValue('ANALYSIS_USER_DAILY_LIMIT'),
    ANALYSIS_RECONCILE_BUDGET_MS: envValue('ANALYSIS_RECONCILE_BUDGET_MS'),
    ANALYSIS_RECONCILE_JOB_LIMIT: envValue('ANALYSIS_RECONCILE_JOB_LIMIT'),
  });
  const startedAt = Date.now();
  const repaired = await client.rpc('backfill_orphan_analysis_jobs', { p_limit: limits.reconcileJobLimit });
  if (repaired.error && !isMissingRpcError(repaired.error)) throw new Error('补建孤儿分析任务失败', { cause: repaired.error });
  const queueSetupRemainingMs = Math.max(0, limits.reconcileBudgetMs - (Date.now() - startedAt));
  if (queueSetupRemainingMs < 2_000) return;
  const staleLockBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  const [queued, recovered] = await Promise.all([
    client.from('analysis_jobs').select('subject_type,subject_id,revision')
      .eq('status', 'queued').or(`next_retry_at.is.null,next_retry_at.lte.${new Date().toISOString()}`).order('created_at').limit(limits.reconcileJobLimit),
    client.rpc('requeue_stalled_analysis_jobs', { p_stalled_before: staleLockBefore, p_limit: limits.reconcileJobLimit }),
  ]);
  if (queued.error || recovered.error) throw new Error('读取待补偿分析任务失败', { cause: queued.error || recovered.error });
  const pending = [...(queued.data ?? []), ...(recovered.data ?? [])].slice(0, limits.reconcileJobLimit) as Array<{
    subject_type: AnalysisRequest['subjectType']; subject_id: string; revision: number;
  }>;
  const queueBudget = await processWithBudget(pending, {
    budgetMs: queueSetupRemainingMs,
    minimumRemainingMs: 2_000,
    run: async (row, remainingMs) => {
      const request: AnalysisRequest = { subjectType: row.subject_type, subjectId: row.subject_id, revision: row.revision };
      const model = runtimeModel.createModel(Math.min(runtimeModel.requestTimeoutMs, Math.max(1_000, remainingMs - 1_000)));
      await runAnalysisJob(request, {
        model,
        store: new SupabaseAnalysisStore(client, runtimeModel.modelKey, limits.userDailyLimit),
        retryDelayCapMs: limits.maxRetryDelayMs,
      });
    },
    onError: () => console.error('analysis_reconcile_item_failed'),
  });
  const actualRemaining = Math.min(queueBudget.remainingMs, Math.max(0, limits.reconcileBudgetMs - (Date.now() - startedAt)));
  if (actualRemaining >= 2_000) {
    const model = runtimeModel.createModel(Math.min(runtimeModel.requestTimeoutMs, actualRemaining - 1_000));
    try {
      await runAggregateAnalysis({
        client,
        model,
        modelKey: runtimeModel.modelKey,
        minSampleSize: readAggregateSampleSize(envValue('MIN_AGGREGATE_SAMPLE_SIZE'), isProductionRuntime(context)),
      });
    } catch {
      console.error('analysis_reconcile_aggregate_failed');
    }
  }
}

export const config = { schedule: '*/5 * * * *' };
