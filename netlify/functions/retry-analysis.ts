import { z } from 'zod';
import { authenticateRequest, authorizeSubject, requireAdmin, requireRetryableAnalysis } from './_shared/auth';
import { readAnalysisRuntimeLimits } from './_shared/env';
import { errorResponse, jsonResponse, readJsonBody } from './_shared/http';
import { dispatchAnalysisCallback } from './_shared/internal-callback';
import { envValue, isProductionRuntime, type FunctionRuntimeContext } from './_shared/runtime-env';
import { createSupabaseAdminClient } from './_shared/supabase-admin';
import { queueAnalysisRetry } from './_shared/supabase-analysis-store';

const requestSchema = z.object({
  subjectType: z.enum(['employee_assessment', 'position_survey']),
  subjectId: z.string().uuid(),
  revision: z.number().int().positive(),
}).strict();

export default async function handler(request: Request, context?: FunctionRuntimeContext): Promise<Response> {
  try {
    const client = createSupabaseAdminClient();
    const actor = await authenticateRequest(request, client);
    requireAdmin(actor);
    const analysis = requestSchema.parse(await readJsonBody(request));
    await authorizeSubject(client, actor, analysis);
    await requireRetryableAnalysis(client, analysis);
    const limits = readAnalysisRuntimeLimits({
      ANALYSIS_ADMIN_RETRY_COOLDOWN_SECONDS: envValue('ANALYSIS_ADMIN_RETRY_COOLDOWN_SECONDS'),
      ANALYSIS_ADMIN_DAILY_RETRY_LIMIT: envValue('ANALYSIS_ADMIN_DAILY_RETRY_LIMIT'),
    });
    await queueAnalysisRetry(client, analysis, actor.id, limits.adminRetryCooldownSeconds, limits.adminDailyRetryLimit);
    try {
      await dispatchAnalysisCallback('/api/internal/analyze-background', analysis, isProductionRuntime(context));
    } catch {
      // The queued row remains durable; the scheduled reconciler will retry it.
    }
    return jsonResponse({ accepted: true }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}

export const config = { path: '/api/admin/retry-analysis', method: 'POST' };
