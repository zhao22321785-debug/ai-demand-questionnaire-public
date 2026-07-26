import { z } from 'zod';
import { authenticateRequest, authorizeSubject } from './_shared/auth';
import { readAnalysisRuntimeLimits } from './_shared/env';
import { errorResponse, jsonResponse, readJsonBody } from './_shared/http';
import { dispatchAnalysisCallback } from './_shared/internal-callback';
import { envValue, isProductionRuntime, type FunctionRuntimeContext } from './_shared/runtime-env';
import { createSupabaseAdminClient } from './_shared/supabase-admin';
import { preflightAnalysisJob } from './_shared/supabase-analysis-store';

const requestSchema = z.object({
  subjectType: z.enum(['employee_assessment', 'position_survey']),
  subjectId: z.string().uuid(),
  revision: z.number().int().positive(),
}).strict();

export default async function handler(request: Request, context?: FunctionRuntimeContext): Promise<Response> {
  try {
    const client = createSupabaseAdminClient();
    const actor = await authenticateRequest(request, client);
    const analysis = requestSchema.parse(await readJsonBody(request));
    await authorizeSubject(client, actor, analysis);
    const limits = readAnalysisRuntimeLimits({ ANALYSIS_USER_DAILY_LIMIT: envValue('ANALYSIS_USER_DAILY_LIMIT') });
    await preflightAnalysisJob(client, analysis, actor.id, limits.userDailyLimit);

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

export const config = { path: '/api/analyze', method: 'POST' };
