import type { SupabaseClient } from '@supabase/supabase-js';
import { compareEvidence, demandDirectionForScenarioGroup, groupScenarioDetails } from '../../../src/lib/analysis/aggregate-rules';
import { sanitizeEvidenceDimensions } from '../../../src/lib/analysis/evidence-comparison';
import {
  AggregateAnalysisInputSchema,
  AggregateAnalysisResultSchema,
  SingleAnalysisResultSchema,
  type AggregateAnalysisResult,
  type AggregateScenario,
  type EvidenceReference,
  type ModelClient,
  type ScenarioAnalysis,
  type SingleAnalysisResult,
} from '../../../src/types/analysis';

interface SourceRef {
  subjectType: 'employee_assessment' | 'position_survey';
  subjectId: string;
  revision: number;
}

function evidenceKey(reference: EvidenceReference): string {
  return [reference.subjectType, reference.subjectId, reference.revision, reference.fieldPath, reference.taskId || ''].join('|');
}

function sourceKey(source: { subjectType: string; subjectId: string; revision: number }): string {
  return `${source.subjectType}|${source.subjectId}|${source.revision}`;
}

function stableId(value: string): string {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash.toString(36);
}

function stableJsonStringify(value: unknown): string {
  const normalize = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(normalize);
    if (current && typeof current === 'object') {
      return Object.keys(current).sort().reduce<Record<string, unknown>>((normalized, key) => {
        normalized[key] = normalize((current as Record<string, unknown>)[key]);
        return normalized;
      }, {});
    }
    return current;
  };
  return JSON.stringify(normalize(value));
}

export function buildAggregateSourceSnapshot(
  rows: Array<{ id: string; subject_type: string; subject_id: string; revision: number; updated_at: string }>,
  config: { ruleVersion: string; promptVersion: string; modelKey: string; minSampleSize: number },
): Array<Record<string, unknown>> {
  return [
    config,
    ...rows.map((row) => ({ analysisResultId: row.id, subjectType: row.subject_type, subjectId: row.subject_id, revision: row.revision, updatedAt: row.updated_at }))
      .sort((a, b) => `${a.subjectType}:${a.subjectId}`.localeCompare(`${b.subjectType}:${b.subjectId}`)),
  ];
}

export function sanitizeAggregateResult(
  result: AggregateAnalysisResult,
  context: { batchId: string; ruleVersion: string; minSampleSize: number; analyses: SingleAnalysisResult[] },
): AggregateAnalysisResult {
  const sampleSufficient = context.analyses.length >= context.minSampleSize;
  if (result.batchId !== context.batchId || result.ruleVersion !== context.ruleVersion || !sampleSufficient) {
    throw new Error('聚合结果与服务端批次、规则或样本状态不一致');
  }

  const evidence = new Map<string, { reference: EvidenceReference; scenario: ScenarioAnalysis; result: SingleAnalysisResult }>();
  const sources = new Map<string, SingleAnalysisResult>();
  for (const analysis of context.analyses) {
    const type = analysis.kind === 'employee' ? 'employee_assessment' : 'position_survey';
    sources.set(sourceKey({ subjectType: type, subjectId: analysis.subjectId, revision: analysis.revision }), analysis);
    for (const scenario of analysis.scenarios) {
      for (const reference of scenario.evidence) evidence.set(evidenceKey(reference), { reference, scenario, result: analysis });
    }
  }

  const usedEvidence = new Set<string>();
  const sanitizedScenarios = result.scenarios.map((scenario): AggregateScenario => {
    const requested = [...scenario.employeeEvidence, ...scenario.positionEvidence];
    if (!requested.length) throw new Error(`聚合场景 ${scenario.id} 没有可验证来源证据`);
    const canonical = requested.map((reference) => {
      const key = evidenceKey(reference);
      const found = evidence.get(key);
      if (!found) throw new Error(`聚合结果包含输入集合之外的证据：${reference.fieldPath}`);
      if (usedEvidence.has(key)) throw new Error(`同一证据被重复归入多个聚合场景：${reference.fieldPath}`);
      usedEvidence.add(key);
      return found;
    });
    const businessGroups = groupScenarioDetails(canonical.map((item) => ({ result: item.result, scenario: item.scenario })));
    if (businessGroups.length > 1) throw new Error(`聚合场景 ${scenario.id} 错误合并了业务条件不同的具体场景`);

    const canonicalSources = [...new Map(canonical.map((item) => {
      const subjectType = item.result.kind === 'employee' ? 'employee_assessment' as const : 'position_survey' as const;
      const key = sourceKey({ subjectType, subjectId: item.result.subjectId, revision: item.result.revision });
      const route = item.result.kind === 'employee'
        ? `/admin/employee-responses/${encodeURIComponent(item.result.subjectId)}`
        : `/admin/position-responses/${encodeURIComponent(item.result.subjectId)}`;
      return [key, { subjectType, subjectId: item.result.subjectId, revision: item.result.revision, title: item.scenario.title, route }] as const;
    })).values()];
    for (const source of canonicalSources) if (!sources.has(sourceKey(source))) throw new Error('聚合来源不属于当前输入集合');
    const sourceScenarios = [...new Map(canonical.map((item) => {
      const subjectType = item.result.kind === 'employee' ? 'employee_assessment' : 'position_survey';
      return [`${sourceKey({ subjectType, subjectId: item.result.subjectId, revision: item.result.revision })}|${item.scenario.id}`, item.scenario] as const;
    })).values()];
    const sourceResults = [...new Map(canonical.map((item) => [sourceKey({ subjectType: item.reference.subjectType, subjectId: item.result.subjectId, revision: item.result.revision }), item.result] as const)).values()];
    const employeeEvidence = canonical.filter((item) => item.reference.subjectType === 'employee_assessment').map((item) => item.reference);
    const positionEvidence = canonical.filter((item) => item.reference.subjectType === 'position_survey').map((item) => item.reference);
    return {
      ...scenario,
      capabilityTheme: demandDirectionForScenarioGroup(canonical.map((item) => ({ result: item.result, scenario: item.scenario }))),
      currentProcess: [...new Set(sourceScenarios.map((item) => item.currentProcess))].join('；'),
      mainProblem: [...new Set(sourceScenarios.map((item) => item.mainProblem))].join('；'),
      occurrence: [...new Set(sourceScenarios.map((item) => item.occurrence))].join('；'),
      stability: [...new Set(sourceScenarios.map((item) => item.stability))].join('；'),
      audience: [...new Set(sourceScenarios.map((item) => item.audience))].join('；'),
      originalExpectations: [...new Set(sourceScenarios.map((item) => item.originalExpectation))],
      possibleSupport: [...new Set(sourceScenarios.flatMap((item) => item.supportForms))],
      departments: [...new Set(sourceResults.flatMap((item) => item.departments))],
      positions: [...new Set(sourceResults.flatMap((item) => item.positions))],
      responseCount: canonicalSources.length,
      coveredPeople: canonicalSources.length,
      employeeEvidence,
      positionEvidence,
      evidenceStatus: scenario.evidenceStatus === 'explicit_conflict' && employeeEvidence.length > 0 && positionEvidence.length > 0
        ? 'explicit_conflict'
        : compareEvidence(employeeEvidence.length, positionEvidence.length).status,
      sources: canonicalSources,
      evidenceDimensions: sanitizeEvidenceDimensions(scenario.evidenceDimensions, canonicalSources, context.minSampleSize),
    };
  });

  const themeMap = new Map<string, { id: string; title: string; scenarioIds: string[] }>();
  for (const scenario of sanitizedScenarios) {
    const id = `theme-${stableId(scenario.capabilityTheme)}`;
    const theme = themeMap.get(id) || { id, title: scenario.capabilityTheme, scenarioIds: [] };
    theme.scenarioIds.push(scenario.id);
    themeMap.set(id, theme);
  }
  return { ...result, sampleSize: context.analyses.length, sampleSufficient: true, scenarios: sanitizedScenarios, capabilityThemes: [...themeMap.values()] };
}

export async function runAggregateAnalysis(deps: {
  client: SupabaseClient;
  model: ModelClient;
  modelKey: string;
  minSampleSize: number;
  ruleVersion?: string;
  promptVersion?: string;
}): Promise<AggregateAnalysisResult | null> {
  const ruleVersion = deps.ruleVersion ?? 'aggregate-v2';
  const promptVersion = deps.promptVersion ?? 'aggregate-v2';
  const batchResult = await deps.client.from('survey_batches').select('id').eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (batchResult.error) throw new Error('读取当前调研批次失败', { cause: batchResult.error });
  if (!batchResult.data) return null;
  const batchId = batchResult.data.id as string;
  const [employees, positions] = await Promise.all([
    deps.client.from('employee_assessments').select('id,revision').eq('batch_id', batchId),
    deps.client.from('position_demand_surveys').select('id,revision').eq('batch_id', batchId),
  ]);
  if (employees.error || positions.error) throw new Error('读取聚合答卷版本失败', { cause: employees.error || positions.error });
  const sources: SourceRef[] = [
    ...(employees.data ?? []).map((row) => ({ subjectType: 'employee_assessment' as const, subjectId: row.id, revision: row.revision })),
    ...(positions.data ?? []).map((row) => ({ subjectType: 'position_survey' as const, subjectId: row.id, revision: row.revision })),
  ].sort((a, b) => `${a.subjectType}:${a.subjectId}`.localeCompare(`${b.subjectType}:${b.subjectId}`));
  if (!sources.length) return null;

  const ids = sources.map((source) => source.subjectId);
  const analysesResult = await deps.client.from('analysis_results').select('id,subject_type,subject_id,revision,result_payload,updated_at')
    .eq('status', 'complete').in('subject_id', ids);
  if (analysesResult.error) throw new Error('读取单份分析结果失败', { cause: analysesResult.error });
  const validSourceKeys = new Set(sources.map((source) => `${source.subjectType}:${source.subjectId}:${source.revision}`));
  const currentRows = (analysesResult.data ?? []).filter((row) => validSourceKeys.has(`${row.subject_type}:${row.subject_id}:${row.revision}`));
  const analyses = currentRows.map((row) => {
    const parsed = SingleAnalysisResultSchema.parse(row.result_payload);
    const expectedType = parsed.kind === 'employee' ? 'employee_assessment' : 'position_survey';
    if (expectedType !== row.subject_type || parsed.subjectId !== row.subject_id || parsed.revision !== row.revision) {
      throw new Error('数据库单份分析结果与来源行不一致');
    }
    return parsed;
  });
  const sourceSnapshot = buildAggregateSourceSnapshot(currentRows, { ruleVersion, promptVersion, modelKey: deps.modelKey, minSampleSize: deps.minSampleSize });

  const latest = await deps.client.from('aggregate_analysis_runs').select('source_snapshot,result_payload,status')
    .eq('batch_id', batchId).eq('status', 'complete').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (latest.error) throw new Error('读取聚合运行状态失败', { cause: latest.error });
  if (latest.data && stableJsonStringify(latest.data.source_snapshot) === stableJsonStringify(sourceSnapshot)) {
    const cached = AggregateAnalysisResultSchema.safeParse(latest.data.result_payload);
    if (cached.success) return cached.data;
  }

  const invalidated = await deps.client.from('aggregate_analysis_runs').update({ status: 'stale' }).eq('batch_id', batchId).in('status', ['queued', 'running', 'complete']);
  if (invalidated.error) throw new Error('使旧聚合运行失效失败', { cause: invalidated.error });
  const created = await deps.client.from('aggregate_analysis_runs').insert({
    batch_id: batchId,
    status: 'running',
    rule_version: ruleVersion,
    prompt_version: promptVersion,
    model_key: deps.modelKey,
    min_sample_size: deps.minSampleSize,
    source_snapshot: sourceSnapshot,
  }).select('id').single();
  if (created.error) throw new Error('创建聚合分析任务失败', { cause: created.error });

  try {
    let result: AggregateAnalysisResult;
    if (analyses.length < deps.minSampleSize) {
      result = {
        kind: 'aggregate', batchId, ruleVersion, sampleSize: analyses.length, sampleSufficient: false,
        summary: `当前有效分析样本为 ${analyses.length} 份，低于 ${deps.minSampleSize} 份保护阈值，暂不形成岗位共性、部门比较或冲突结论。`,
        scenarios: [],
        capabilityThemes: [],
        disclaimer: '这是基于当前调研样本形成的初步线索；样本不足时仅保留来源入口，不代表组织共性或优先级。',
      };
    } else {
      const input = AggregateAnalysisInputSchema.parse({ batchId, ruleVersion, minSampleSize: deps.minSampleSize, analyses });
      const generated = AggregateAnalysisResultSchema.parse(await deps.model.generateAggregateAnalysis(input));
      result = sanitizeAggregateResult(generated, { batchId, ruleVersion, minSampleSize: deps.minSampleSize, analyses });
    }
    result = AggregateAnalysisResultSchema.parse(result);
    const saved = await deps.client.rpc('finalize_aggregate_analysis_run', {
      p_run_id: created.data.id,
      p_expected_snapshot: sourceSnapshot,
      p_terminal_status: 'complete',
      p_result_payload: result,
      p_error_code: null,
      p_error_summary: null,
    });
    if (saved.error) throw new Error('保存聚合分析结果失败', { cause: saved.error });
    return (saved.data as { status?: string } | null)?.status === 'complete' ? result : null;
  } catch (error) {
    await deps.client.rpc('finalize_aggregate_analysis_run', {
      p_run_id: created.data.id,
      p_expected_snapshot: sourceSnapshot,
      p_terminal_status: 'failed',
      p_result_payload: null,
      p_error_code: 'aggregate_error',
      p_error_summary: '聚合分析处理失败',
    });
    throw error;
  }
}
