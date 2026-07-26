import type { SupabaseClient } from '@supabase/supabase-js';
import { buildEmployeeAnalysisInput, buildPositionAnalysisInput } from '../../../src/lib/analysis/input-builders';
import {
  EmployeeAnalysisInputSchema,
  PositionAnalysisInputSchema,
  SingleAnalysisResultSchema,
  type AnalysisRecord,
  type AnalysisRequest,
  type SingleAnalysisResult,
} from '../../../src/types/analysis';
import type { EmployeeResponseRecord, OptionItem, PositionResponseRecord, ReferenceData } from '../../../src/types/survey';
import type { AnalysisInput, AnalysisStore, ClaimResult } from './analysis-service';

interface JobRow {
  id: string;
  subject_type: AnalysisRequest['subjectType'];
  subject_id: string;
  revision: number;
  status: AnalysisRecord['status'];
  attempt_count: number;
  lease_token: string | null;
  lease_generation: number;
  error_code: string | null;
  error_summary: string | null;
  created_at: string;
  updated_at: string;
}

interface ResultRow {
  id: string;
  job_id: string;
  subject_type: AnalysisRequest['subjectType'];
  subject_id: string;
  revision: number;
  status: AnalysisRecord['status'];
  result_payload: SingleAnalysisResult | null;
  attempt_count: number;
  error_code: string | null;
  error_summary: string | null;
  model_key: string | null;
  prompt_version: string;
  created_at: string;
  updated_at: string;
}

function assertNoError(error: unknown, operation: string): void {
  if (error) throw new Error(`${operation}失败`, { cause: error });
}

export function isMissingRpcError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  return code === 'PGRST202' || code === '42883';
}

function recordFrom(row: ResultRow): AnalysisRecord {
  const result = row.status === 'complete' ? SingleAnalysisResultSchema.parse(row.result_payload) : null;
  return {
    id: row.id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    revision: row.revision,
    status: row.status,
    result,
    attemptCount: row.attempt_count,
    errorCode: row.error_code ?? undefined,
    errorSummary: row.error_summary ?? undefined,
    modelKey: row.model_key ?? undefined,
    promptVersion: row.prompt_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function preflightAnalysisJob(client: SupabaseClient, request: AnalysisRequest, actorId: string, dailyLimit: number): Promise<void> {
  let checked = await client.rpc('check_analysis_job_quota', {
    p_subject_type: request.subjectType,
    p_subject_id: request.subjectId,
    p_revision: request.revision,
    p_actor_id: actorId,
    p_daily_limit: dailyLimit,
  });
  if (isMissingRpcError(checked.error)) {
    checked = await client.rpc('enqueue_analysis_job_with_quota', {
      p_subject_type: request.subjectType,
      p_subject_id: request.subjectId,
      p_revision: request.revision,
      p_actor_id: actorId,
      p_daily_limit: dailyLimit,
    });
    assertNoError(checked.error, '兼容创建分析任务');
    const legacyValue = checked.data as { kind?: string; retryAfterSeconds?: number } | null;
    if (legacyValue?.kind === 'quota_exceeded') {
      throw new Response('今日分析请求已达上限', { status: 429, headers: { 'retry-after': String(86_400) } });
    }
    return;
  }
  assertNoError(checked.error, '检查分析任务');
  const value = checked.data as { kind?: string; retryAfterSeconds?: number } | null;
  if (value?.kind === 'quota_exceeded') {
    const retryAfterSeconds = Math.max(1, Math.min(86_400, Math.ceil(Number(value.retryAfterSeconds) || 86_400)));
    throw new Response('今日分析请求已达上限', { status: 429, headers: { 'retry-after': String(retryAfterSeconds) } });
  }
  if (value?.kind === 'missing') throw new Response('分析任务尚未就绪', { status: 409 });
  if (value?.kind !== 'ready' && value?.kind !== 'already_consumed') throw new Error('分析配额检查没有返回有效状态');
}

export async function queueAnalysisRetry(client: SupabaseClient, request: AnalysisRequest, actorId: string, cooldownSeconds: number, dailyLimit: number): Promise<void> {
  const queued = await client.rpc('queue_analysis_retry_with_throttle', {
    p_subject_type: request.subjectType,
    p_subject_id: request.subjectId,
    p_revision: request.revision,
    p_actor_id: actorId,
    p_cooldown_seconds: cooldownSeconds,
    p_daily_limit: dailyLimit,
  });
  assertNoError(queued.error, '创建分析重试任务');
  const value = queued.data as { kind?: string; retryAfterSeconds?: number } | null;
  const kind = value?.kind;
  if (kind === 'throttled' || kind === 'quota_exceeded') {
    const fallback = kind === 'throttled' ? cooldownSeconds : 86_400;
    const retryAfterSeconds = Math.max(1, Math.min(86_400, Math.ceil(Number(value?.retryAfterSeconds) || fallback)));
    throw new Response(kind === 'throttled' ? '手动重试过于频繁，请稍后再试' : '今日管理员分析重试已达上限', {
      status: 429,
      headers: { 'retry-after': String(retryAfterSeconds) },
    });
  }
  if (kind !== 'queued') throw new Response('只有失败或已过期的当前分析可以手动重试', { status: 409 });
}

export class SupabaseAnalysisStore implements AnalysisStore {
  constructor(
    private readonly client: SupabaseClient,
    private readonly modelKey: string,
    private readonly dailyLimit: number,
    private readonly promptVersion = 'single-v1',
  ) {}

  async claim(request: AnalysisRequest): Promise<ClaimResult> {
    const existing = await this.client.from('analysis_jobs').select('*')
      .eq('subject_type', request.subjectType).eq('subject_id', request.subjectId).eq('revision', request.revision).single();
    assertNoError(existing.error, '读取分析任务');
    const job = existing.data as JobRow;
    let claimed = await this.client.rpc('claim_analysis_job', {
      p_job_id: job.id,
      p_model_key: this.modelKey,
      p_prompt_version: this.promptVersion,
      p_daily_limit: this.dailyLimit,
    });
    if (isMissingRpcError(claimed.error)) {
      claimed = await this.client.rpc('claim_analysis_job', {
        p_job_id: job.id,
        p_model_key: this.modelKey,
        p_prompt_version: this.promptVersion,
      });
    }
    assertNoError(claimed.error, '领取分析任务');
    const value = claimed.data as { kind: ClaimResult['kind']; jobId?: string; leaseToken?: string; leaseGeneration?: number; attemptCount?: number; analysis?: ResultRow };
    if (value.kind === 'claimed' && value.jobId && value.leaseToken && value.leaseGeneration !== undefined) {
      return { kind: 'claimed', jobId: value.jobId, leaseToken: value.leaseToken, leaseGeneration: value.leaseGeneration, attemptCount: value.attemptCount ?? 0 };
    }
    if (!value.analysis) throw new Error('分析领取事务没有返回结果状态');
    return { kind: value.kind as Exclude<ClaimResult['kind'], 'claimed'>, analysis: recordFrom(value.analysis) } as ClaimResult;
  }

  private async referenceData(): Promise<ReferenceData> {
    const [batch, departments, positions, tools] = await Promise.all([
      this.client.from('survey_batches').select('id,name,employee_survey_version_id,position_survey_version_id').order('created_at', { ascending: false }).limit(1).single(),
      this.client.from('departments').select('id,code,name'),
      this.client.from('positions').select('id,code,name'),
      this.client.from('ai_tool_options').select('id,code,name'),
    ]);
    assertNoError(batch.error || departments.error || positions.error || tools.error, '读取分析字典');
    if (!batch.data) throw new Error('当前调研批次不存在');
    const map = (rows: unknown): OptionItem[] => (rows as Array<{ id: string; code: string; name: string }>).map((row) => ({ id: row.id, code: row.code, label: row.name }));
    return {
      activeBatch: {
        id: batch.data.id,
        name: batch.data.name,
        surveyVersionId: batch.data.employee_survey_version_id,
        employeeSurveyVersionId: batch.data.employee_survey_version_id,
        positionSurveyVersionId: batch.data.position_survey_version_id,
      },
      departments: map(departments.data),
      positions: map(positions.data),
      aiTools: map(tools.data),
    };
  }

  async loadInput(request: AnalysisRequest): Promise<AnalysisInput> {
    const reference = await this.referenceData();
    if (request.subjectType === 'employee_assessment') {
      const { data, error } = await this.client.from('employee_assessments').select('*').eq('id', request.subjectId).eq('revision', request.revision).single();
      assertNoError(error, '读取员工分析输入');
      const record: EmployeeResponseRecord = {
        id: data.id, userId: data.user_id, batchId: data.batch_id, revision: data.revision,
        analysisStatus: data.analysis_status, submittedAt: data.submitted_at, updatedAt: data.updated_at,
        type: 'employee', input: data.response_payload,
      };
      return EmployeeAnalysisInputSchema.parse(buildEmployeeAnalysisInput(record, reference));
    }
    const { data, error } = await this.client.from('position_demand_surveys').select('*').eq('id', request.subjectId).eq('revision', request.revision).single();
    assertNoError(error, '读取岗位分析输入');
    const record: PositionResponseRecord = {
      id: data.id, userId: data.user_id, batchId: data.batch_id, revision: data.revision,
      analysisStatus: data.analysis_status, submittedAt: data.submitted_at, updatedAt: data.updated_at,
      type: 'position', positionKey: data.position_key, input: data.response_payload,
    };
    return PositionAnalysisInputSchema.parse(buildPositionAnalysisInput(record, reference));
  }

  async isCurrent(request: AnalysisRequest): Promise<boolean> {
    const table = request.subjectType === 'employee_assessment' ? 'employee_assessments' : 'position_demand_surveys';
    const { data, error } = await this.client.from(table).select('revision').eq('id', request.subjectId).maybeSingle();
    assertNoError(error, '核对答卷版本');
    return data?.revision === request.revision;
  }

  async recordAttempt(jobId: string, leaseToken: string, attemptCount: number, error?: { code: string; summary: string; nextRetryAt?: string }): Promise<AnalysisRecord> {
    const saved = await this.client.rpc('record_analysis_job_attempt', {
      p_job_id: jobId,
      p_lease_token: leaseToken,
      p_attempt_count: attemptCount,
      p_error_code: error?.code ?? null,
      p_error_summary: error?.summary ?? null,
      p_next_retry_at: error?.nextRetryAt ?? null,
    });
    assertNoError(saved.error, '记录分析尝试');
    return recordFrom(saved.data as ResultRow);
  }

  async complete(jobId: string, leaseToken: string, _request: AnalysisRequest, result: SingleAnalysisResult, attemptCount: number): Promise<AnalysisRecord> {
    const evidence = result.scenarios.flatMap((scenario) => scenario.evidence);
    const saved = await this.client.rpc('finalize_analysis_job', {
      p_job_id: jobId, p_lease_token: leaseToken, p_terminal_status: 'complete', p_result_payload: result, p_evidence_index: evidence,
      p_attempt_count: attemptCount, p_error_code: null, p_error_summary: null,
    });
    assertNoError(saved.error, '保存分析结果');
    return recordFrom(saved.data as ResultRow);
  }

  async fail(jobId: string, leaseToken: string, _request: AnalysisRequest, error: { code: string; summary: string }, attemptCount: number): Promise<AnalysisRecord> {
    const saved = await this.client.rpc('finalize_analysis_job', {
      p_job_id: jobId, p_lease_token: leaseToken, p_terminal_status: 'failed', p_result_payload: null, p_evidence_index: [],
      p_attempt_count: attemptCount, p_error_code: error.code, p_error_summary: error.summary,
    });
    assertNoError(saved.error, '记录分析失败');
    return recordFrom(saved.data as ResultRow);
  }

  async markStale(jobId: string, leaseToken: string, _request: AnalysisRequest): Promise<AnalysisRecord> {
    const saved = await this.client.rpc('finalize_analysis_job', {
      p_job_id: jobId, p_lease_token: leaseToken, p_terminal_status: 'stale', p_result_payload: null, p_evidence_index: [],
      p_attempt_count: 0, p_error_code: null, p_error_summary: null,
    });
    assertNoError(saved.error, '标记过期分析');
    return recordFrom(saved.data as ResultRow);
  }
}
