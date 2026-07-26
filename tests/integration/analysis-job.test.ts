import { runAnalysisJob, sanitizeSingleAnalysisResult, validateEvidenceReferences, type AnalysisInput, type AnalysisStore, type ClaimResult } from '../../netlify/functions/_shared/analysis-service';
import { ModelRequestError } from '../../netlify/functions/_shared/openai-model-client';
import { ANALYSIS_MAX_EXCERPT_LENGTH, SingleAnalysisResultSchema, type AnalysisRecord, type AnalysisRequest, type EmployeeAnalysisResult, type ModelClient, type SingleAnalysisResult } from '../../src/types/analysis';

const request: AnalysisRequest = { subjectType: 'employee_assessment', subjectId: 'response-1', revision: 2 };
const input: AnalysisInput = {
  subjectType: 'employee_assessment', subjectId: request.subjectId, revision: request.revision,
  respondent: { department: '产品与运营', position: '产品经理', experience: '3_5' }, aiUseStatus: 'sometimes', aiUseBackground: ['整理材料'],
  backgroundEvidence: { nonUseReasons: [], discontinuationReasons: [], aiScenarios: ['整理材料'], painPoints: ['耗时'] },
  hasExplicitDemand: true, dimensions: [3, 3, 3, 3, 3, 3], allowedEvidencePaths: ['tasks.task-1.mainProblem'],
  tasks: [{ id: 'task-1', title: '整理材料', currentProcess: '人工整理', mainProblem: '耗时', occurrence: 'weekly', stability: 'partly_fixed', audience: 'self', aiUseStatus: 'never', expectedSupport: '辅助归类' }],
};
const result: EmployeeAnalysisResult = {
  kind: 'employee', subjectId: request.subjectId, revision: request.revision, hasExplicitDemand: true,
  summary: '初步分析', departments: ['产品与运营'], positions: ['产品经理'], aiUseBackground: ['整理材料'], behaviorProfile: ['只记录行为'], dimensionNotes: ['已记录'], disclaimer: '初步分析',
  scenarios: [{
    id: 'scenario-1', title: '整理材料', audience: 'self', taskSummary: '整理材料', currentProcess: '人工整理', mainProblem: '耗时', occurrence: 'weekly', stability: 'partly_fixed',
    originalExpectation: '辅助归类', supportForms: ['结构化模板'], attentionReason: '耗时', completeness: 'complete', missingInformation: [], followUpQuestions: [],
    evidence: [{ subjectType: 'employee_assessment', subjectId: request.subjectId, revision: request.revision, fieldPath: 'tasks.task-1.mainProblem', taskId: 'task-1', label: '查看原始回答' }],
  }],
};

function analysis(status: AnalysisRecord['status'], payload: SingleAnalysisResult | null = null, attempts = 0): AnalysisRecord {
  return { id: 'analysis-1', ...request, status, result: payload, attemptCount: attempts, promptVersion: 'single-v1', createdAt: '2026-07-24T00:00:00.000Z', updatedAt: '2026-07-24T00:00:00.000Z' };
}

class MemoryStore implements AnalysisStore {
  attempts: number[] = [];
  leases: string[] = [];
  retry: { code: string; summary: string; nextRetryAt?: string } | undefined;
  current = true;
  final: AnalysisRecord | null = null;
  constructor(
    private claimResult: ClaimResult = { kind: 'claimed', jobId: 'job-1', leaseToken: 'lease-1', leaseGeneration: 1, attemptCount: 0 },
    private loadedInput: AnalysisInput = input,
  ) {}
  async claim() { return this.claimResult; }
  async loadInput() { return this.loadedInput; }
  async isCurrent() { return this.current; }
  async recordAttempt(_jobId: string, leaseToken: string, count: number, error?: { code: string; summary: string; nextRetryAt?: string }) {
    this.leases.push(leaseToken); this.attempts.push(count); this.retry = error;
    return analysis(error ? 'queued' : 'running', null, count);
  }
  async complete(_jobId: string, leaseToken: string, _request: AnalysisRequest, payload: SingleAnalysisResult, count: number) { this.leases.push(leaseToken); return this.final = analysis('complete', payload, count); }
  async fail(_jobId: string, leaseToken: string, _request: AnalysisRequest, _error: { code: string; summary: string }, count: number) { this.leases.push(leaseToken); return this.final = analysis('failed', null, count); }
  async markStale(_jobId: string, leaseToken: string) { this.leases.push(leaseToken); return this.final = analysis('stale'); }
}

function model(generate: ModelClient['generateEmployeeAnalysis']): ModelClient {
  return { generateEmployeeAnalysis: generate, generatePositionAnalysis: vi.fn(), generateAggregateAnalysis: vi.fn() };
}

it('defers a transient failure to the scheduler without sleeping or retrying in the same invocation', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-24T00:00:00.000Z'));
  const generate = vi.fn().mockRejectedValue(new ModelRequestError('provider detail must not persist', 'http_error', 429, 86_400));
  const store = new MemoryStore();
  const pending = runAnalysisJob(request, { model: model(generate), store, retryDelayCapMs: 60_000 });
  await vi.runAllTimersAsync();
  const saved = await pending;
  expect(saved.status).toBe('queued');
  expect(saved.attemptCount).toBe(1);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(store.retry).toEqual({ code: 'http_error', summary: '模型服务暂时不可用', nextRetryAt: '2026-07-24T00:01:00.000Z' });
  vi.useRealTimers();
});

it('does not retry permanent schema failures', async () => {
  const generate = vi.fn().mockRejectedValue(new ModelRequestError('invalid schema', 'schema_error'));
  const store = new MemoryStore();
  const saved = await runAnalysisJob(request, { model: model(generate), store });
  expect(saved.status).toBe('failed');
  expect(generate).toHaveBeenCalledTimes(1);
});

it('marks a result stale when the response revision changed during analysis', async () => {
  const store = new MemoryStore(); store.current = false;
  const saved = await runAnalysisJob(request, { model: model(vi.fn().mockResolvedValue(result)), store });
  expect(saved.status).toBe('stale');
});

it('does not invoke the model for an already complete idempotency key', async () => {
  const existing = analysis('complete', result, 1);
  const store = new MemoryStore({ kind: 'already_complete', analysis: existing });
  const generate = vi.fn();
  await expect(runAnalysisJob(request, { model: model(generate), store })).resolves.toBe(existing);
  expect(generate).not.toHaveBeenCalled();
});

it('does not let the model turn a no-demand response into invented scenarios', () => {
  const noDemandInput: AnalysisInput = { ...input, hasExplicitDemand: false, tasks: [] };
  expect(() => validateEvidenceReferences(noDemandInput, { ...result, hasExplicitDemand: true })).toThrow(/改变了原始需求状态/);
});

it('rebuilds evidence type, task id, label and excerpt from the original input', () => {
  const polluted = {
    ...result,
    scenarios: [{ ...result.scenarios[0], evidence: [{
      subjectType: 'position_survey' as const, subjectId: request.subjectId, revision: request.revision,
      fieldPath: 'tasks.task-1.mainProblem', taskId: 'fake-task', label: '模型伪造标签', excerpt: '模型伪造摘录',
    }] }],
  };
  const sanitized = sanitizeSingleAnalysisResult(input, polluted);
  expect(sanitized.scenarios[0].evidence[0]).toEqual({
    subjectType: 'employee_assessment', subjectId: request.subjectId, revision: request.revision,
    fieldPath: 'tasks.task-1.mainProblem', taskId: 'task-1', label: '主要问题', excerpt: '耗时',
  });
});

it('does not reopen a terminal task from the normal analysis path', async () => {
  const terminal = analysis('failed', null, 3);
  const store = new MemoryStore({ kind: 'terminal', analysis: terminal });
  const generate = vi.fn();
  await expect(runAnalysisJob(request, { model: model(generate), store })).resolves.toBe(terminal);
  expect(generate).not.toHaveBeenCalled();
});

it('resumes a recovered automatic job from its cumulative attempt count and uses the current lease for every write', async () => {
  const store = new MemoryStore({ kind: 'claimed', jobId: 'job-1', leaseToken: 'lease-current', leaseGeneration: 7, attemptCount: 2 });
  const generate = vi.fn().mockResolvedValue(result);
  const saved = await runAnalysisJob(request, { model: model(generate), store });
  expect(saved.attemptCount).toBe(3);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(store.leases).toEqual(['lease-current', 'lease-current']);
});

it('does not call the model when a recovered job already used all automatic attempts', async () => {
  const store = new MemoryStore({ kind: 'claimed', jobId: 'job-1', leaseToken: 'lease-current', leaseGeneration: 7, attemptCount: 3 });
  const generate = vi.fn();
  const saved = await runAnalysisJob(request, { model: model(generate), store });
  expect(saved.status).toBe('failed');
  expect(generate).not.toHaveBeenCalled();
});

it('rebuilds root employee background evidence from the canonical structured field', () => {
  const backgroundInput: AnalysisInput = {
    ...input,
    allowedEvidencePaths: ['painPoints'],
  };
  const sanitized = sanitizeSingleAnalysisResult(backgroundInput, {
    ...result,
    scenarios: [{ ...result.scenarios[0], evidence: [{
      subjectType: 'employee_assessment', subjectId: request.subjectId, revision: request.revision,
      fieldPath: 'painPoints', label: '模型标签', excerpt: '模型摘录',
    }] }],
  });
  expect(sanitized.scenarios[0].evidence[0]).toMatchObject({ fieldPath: 'painPoints', label: '工作痛点提示', excerpt: '耗时' });
});

it('rejects an allowed evidence path when it cannot resolve a canonical value', () => {
  expect(() => sanitizeSingleAnalysisResult({ ...input, allowedEvidencePaths: ['missingRoot'] }, {
    ...result,
    scenarios: [{ ...result.scenarios[0], evidence: [{
      subjectType: 'employee_assessment', subjectId: request.subjectId, revision: request.revision,
      fieldPath: 'missingRoot', label: '来源',
    }] }],
  })).toThrow(/无法解析来源引用/);
});

it('caps a 2001-character canonical scalar excerpt at the auditable evidence limit', () => {
  const longInput: AnalysisInput = {
    ...input,
    tasks: [{ ...input.tasks[0], mainProblem: '甲'.repeat(2_001) }],
  };
  const sanitized = sanitizeSingleAnalysisResult(longInput, result);
  const excerpt = sanitized.scenarios[0].evidence[0].excerpt;
  expect(excerpt).toHaveLength(ANALYSIS_MAX_EXCERPT_LENGTH);
  expect(excerpt).toBe('甲'.repeat(ANALYSIS_MAX_EXCERPT_LENGTH));
});

it('caps a joined canonical array excerpt after inserting its separator', () => {
  const first = '甲'.repeat(1_500);
  const second = '乙'.repeat(1_500);
  const backgroundInput: AnalysisInput = {
    ...input,
    backgroundEvidence: { ...input.backgroundEvidence, painPoints: [first, second] },
    allowedEvidencePaths: ['painPoints'],
  };
  const sanitized = sanitizeSingleAnalysisResult(backgroundInput, {
    ...result,
    scenarios: [{ ...result.scenarios[0], evidence: [{
      subjectType: 'employee_assessment', subjectId: request.subjectId, revision: request.revision,
      fieldPath: 'painPoints', label: '来源', excerpt: '模型摘录',
    }] }],
  });
  expect(sanitized.scenarios[0].evidence[0].excerpt).toBe(`${first}、${'乙'.repeat(499)}`);
  expect(sanitized.scenarios[0].evidence[0].excerpt).toHaveLength(ANALYSIS_MAX_EXCERPT_LENGTH);
});

it('re-parses the canonicalized result before passing it to the complete RPC boundary', async () => {
  const longInput: AnalysisInput = {
    ...input,
    tasks: [{ ...input.tasks[0], mainProblem: '甲'.repeat(2_001) }],
  };
  const store = new MemoryStore(undefined, longInput);
  const saved = await runAnalysisJob(request, { model: model(vi.fn().mockResolvedValue(result)), store });
  expect(saved.status).toBe('complete');
  expect(() => SingleAnalysisResultSchema.parse(saved.result)).not.toThrow();
  expect(saved.result?.scenarios[0].evidence[0].excerpt).toHaveLength(ANALYSIS_MAX_EXCERPT_LENGTH);
});
