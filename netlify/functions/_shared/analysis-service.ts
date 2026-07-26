import type {
  AnalysisRecord,
  AnalysisRequest,
  EmployeeAnalysisInput,
  EvidenceReference,
  ModelClient,
  PositionAnalysisInput,
  SingleAnalysisResult,
} from '../../../src/types/analysis';
import { ANALYSIS_MAX_EXCERPT_LENGTH, EmployeeAnalysisInputSchema, PositionAnalysisInputSchema, SingleAnalysisResultSchema } from '../../../src/types/analysis';
import { ModelRequestError } from './openai-model-client';

export type AnalysisInput = EmployeeAnalysisInput | PositionAnalysisInput;
export type ClaimResult =
  | { kind: 'claimed'; jobId: string; leaseToken: string; leaseGeneration: number; attemptCount: number }
  | { kind: 'already_complete'; analysis: AnalysisRecord }
  | { kind: 'already_running'; analysis: AnalysisRecord }
  | { kind: 'deferred'; analysis: AnalysisRecord }
  | { kind: 'terminal'; analysis: AnalysisRecord };

export interface AnalysisStore {
  claim(request: AnalysisRequest, actorId?: string): Promise<ClaimResult>;
  loadInput(request: AnalysisRequest): Promise<AnalysisInput>;
  isCurrent(request: AnalysisRequest): Promise<boolean>;
  recordAttempt(jobId: string, leaseToken: string, attemptCount: number, error?: { code: string; summary: string; nextRetryAt?: string }): Promise<AnalysisRecord>;
  complete(jobId: string, leaseToken: string, request: AnalysisRequest, result: SingleAnalysisResult, attemptCount: number): Promise<AnalysisRecord>;
  fail(jobId: string, leaseToken: string, request: AnalysisRequest, error: { code: string; summary: string }, attemptCount: number): Promise<AnalysisRecord>;
  markStale(jobId: string, leaseToken: string, request: AnalysisRequest): Promise<AnalysisRecord>;
}

export function classifyModelError(error: unknown): 'retryable' | 'permanent' {
  if (error instanceof ModelRequestError) {
    if (error.code === 'network_error' || error.code === 'timeout') return 'retryable';
    if (error.code !== 'http_error') return 'permanent';
    return error.status === 408 || error.status === 429 || (error.status !== undefined && error.status >= 500)
      ? 'retryable'
      : 'permanent';
  }
  const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : undefined;
  return status === 408 || status === 429 || (status !== undefined && status >= 500) ? 'retryable' : 'permanent';
}

function errorDetails(error: unknown): { code: string; summary: string; retryAfterSeconds?: number } {
  if (error instanceof ModelRequestError) {
    const summary = classifyModelError(error) === 'retryable'
      ? '模型服务暂时不可用'
      : error.code === 'refusal'
        ? '模型拒绝处理该输入'
        : '模型输出无法通过安全校验';
    return { code: error.code, summary, retryAfterSeconds: error.retryAfterSeconds };
  }
  return { code: 'analysis_error', summary: '分析服务处理失败' };
}

function evidenceReferences(result: SingleAnalysisResult) {
  return result.scenarios.flatMap((scenario) => scenario.evidence);
}

const evidenceLabels: Record<string, string> = {
  aiUseStatus: 'AI 使用状态', nonUseReasons: '未使用原因', discontinuationReasons: '停用原因', aiScenarios: 'AI 使用场景', painPoints: '工作痛点提示',
  title: '任务名称', task: '任务名称', currentProcess: '当前做法', mainProblem: '主要问题', occurrence: '发生规律', stability: '步骤稳定程度',
  audience: '覆盖人群', expectedSupport: '期望支持', expectedAiSupport: '期望 AI 支持', commonInput: '常见输入', output: '常见输出',
  humanReviewContent: '人工确认内容', collaboration: '协作条件', name: '主要工作', description: '工作说明',
};

function evidenceValue(input: AnalysisInput, fieldPath: string): { value: unknown; taskId?: string } {
  const [collection, identifier, field] = fieldPath.split('.');
  if (collection === 'tasks' && identifier && field) {
    const task = input.tasks.find((item) => item.id === identifier);
    return { value: task ? (task as unknown as Record<string, unknown>)[field] : undefined, taskId: identifier };
  }
  if (input.subjectType === 'position_survey' && collection === 'workItems' && identifier && field) {
    const item = input.workItems.find((work) => work.id === identifier);
    return { value: item ? (item as unknown as Record<string, unknown>)[field] : undefined };
  }
  if (input.subjectType === 'employee_assessment' && collection === 'dimensions' && identifier) {
    return { value: input.dimensions[Number(identifier)] };
  }
  if (input.subjectType === 'employee_assessment' && collection in input.backgroundEvidence) {
    return { value: input.backgroundEvidence[collection as keyof typeof input.backgroundEvidence] };
  }
  return { value: (input as unknown as Record<string, unknown>)[collection] };
}

function displayEvidenceValue(value: unknown): string | undefined {
  let text: string | undefined;
  if (Array.isArray(value)) text = value.length ? value.map(String).join('、') : undefined;
  else if (value === null) text = '不适用';
  else if (typeof value === 'boolean') text = value ? '是' : '否';
  else if (typeof value === 'string' || typeof value === 'number') text = String(value) || undefined;
  return text?.slice(0, ANALYSIS_MAX_EXCERPT_LENGTH);
}

function canonicalEvidence(input: AnalysisInput, reference: EvidenceReference): EvidenceReference {
  if (!input.allowedEvidencePaths.includes(reference.fieldPath)) throw new Error(`分析结果包含无效来源引用：${reference.fieldPath}`);
  const resolved = evidenceValue(input, reference.fieldPath);
  if (resolved.value === undefined) throw new Error(`分析结果无法解析来源引用：${reference.fieldPath}`);
  const field = reference.fieldPath.split('.').at(-1) || reference.fieldPath;
  return {
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    revision: input.revision,
    fieldPath: reference.fieldPath,
    taskId: resolved.taskId,
    label: evidenceLabels[field] || '原始回答',
    excerpt: displayEvidenceValue(resolved.value),
  };
}

export function sanitizeSingleAnalysisResult(input: AnalysisInput, result: SingleAnalysisResult): SingleAnalysisResult {
  if (input.subjectId !== result.subjectId || input.revision !== result.revision) throw new Error('分析结果与答卷版本不一致');
  if (input.subjectType === 'employee_assessment') {
    if (result.kind !== 'employee' || result.hasExplicitDemand !== input.hasExplicitDemand) throw new Error('员工分析结果改变了原始需求状态');
    if (!input.hasExplicitDemand && result.scenarios.length > 0) throw new Error('没有明确需求时不得生成需求场景');
  } else if (result.kind !== 'position') {
    throw new Error('岗位分析结果类型不匹配');
  }
  return { ...result, scenarios: result.scenarios.map((scenario) => ({
    ...scenario,
    evidence: scenario.evidence.map((reference) => canonicalEvidence(input, reference)),
  })) } as SingleAnalysisResult;
}

export function validateEvidenceReferences(input: AnalysisInput, result: SingleAnalysisResult): void {
  const sanitized = sanitizeSingleAnalysisResult(input, result);
  const allowed = new Set(input.allowedEvidencePaths);
  for (const reference of evidenceReferences(sanitized)) {
    if (reference.subjectId !== input.subjectId || reference.revision !== input.revision || !allowed.has(reference.fieldPath)) {
      throw new Error(`分析结果包含无效来源引用：${reference.fieldPath}`);
    }
  }
}

export async function runAnalysisJob(
  request: AnalysisRequest,
  deps: {
    model: ModelClient;
    store: AnalysisStore;
    actorId?: string;
    retryDelayCapMs?: number;
  },
): Promise<AnalysisRecord> {
  const claimed = await deps.store.claim(request, deps.actorId);
  if (claimed.kind !== 'claimed') return claimed.analysis;
  if (claimed.attemptCount >= 3) {
    return deps.store.fail(claimed.jobId, claimed.leaseToken, request, { code: 'retry_exhausted', summary: '自动重试次数已用完' }, claimed.attemptCount);
  }
  let input: AnalysisInput;
  try {
    const loaded = await deps.store.loadInput(request);
    input = loaded.subjectType === 'employee_assessment'
      ? EmployeeAnalysisInputSchema.parse(loaded)
      : PositionAnalysisInputSchema.parse(loaded);
  } catch (error) {
    if (!await deps.store.isCurrent(request)) return deps.store.markStale(claimed.jobId, claimed.leaseToken, request);
    const details = errorDetails(error);
    return deps.store.fail(claimed.jobId, claimed.leaseToken, request, details, claimed.attemptCount);
  }
  const delays = [2_000, 10_000];
  const attempt = claimed.attemptCount + 1;
  try {
    if (attempt > 1 && !await deps.store.isCurrent(request)) return deps.store.markStale(claimed.jobId, claimed.leaseToken, request);
    await deps.store.recordAttempt(claimed.jobId, claimed.leaseToken, attempt);
    const generated = input.subjectType === 'employee_assessment'
      ? await deps.model.generateEmployeeAnalysis(input)
      : await deps.model.generatePositionAnalysis(input);
    const result = SingleAnalysisResultSchema.parse(generated);
    const sanitizedResult = SingleAnalysisResultSchema.parse(sanitizeSingleAnalysisResult(input, result));
    if (!await deps.store.isCurrent(request)) return deps.store.markStale(claimed.jobId, claimed.leaseToken, request);
    return deps.store.complete(claimed.jobId, claimed.leaseToken, request, sanitizedResult, attempt);
  } catch (error) {
    const details = errorDetails(error);
    if (!await deps.store.isCurrent(request)) return deps.store.markStale(claimed.jobId, claimed.leaseToken, request);
    const retryable = classifyModelError(error) === 'retryable';
    if (!retryable || attempt === 3) return deps.store.fail(claimed.jobId, claimed.leaseToken, request, details, attempt);
    const delayCap = deps.retryDelayCapMs ?? 60_000;
    const waitMilliseconds = Math.min(delayCap, Math.max(delays[attempt - 1] ?? delays.at(-1)!, (details.retryAfterSeconds ?? 0) * 1_000));
    return deps.store.recordAttempt(claimed.jobId, claimed.leaseToken, attempt, {
      code: details.code,
      summary: details.summary,
      nextRetryAt: new Date(Date.now() + waitMilliseconds).toISOString(),
    });
  }
}
