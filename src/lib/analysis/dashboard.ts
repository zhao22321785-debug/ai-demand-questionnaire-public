import type {
  AdminDashboardDto,
  AggregateScenario,
  AnalysisRecord,
  DashboardAiUsageStats,
  DashboardPositionDemandMatrix,
} from '../../types/analysis';
import type { ReferenceData, SurveyResponseRecord } from '../../types/survey';
import { employeeDimensionDefinitions } from '../survey/employee-dimensions';
import { createMockModelClient } from './mock-model-client';
import { sanitizeEvidenceDimensions } from './evidence-comparison';

function labelById(options: ReferenceData['departments'] | ReferenceData['positions'], id?: string, other?: string): string {
  return other || options.find((item) => item.id === id)?.label || id || '未说明';
}

export interface DashboardResponseFact {
  sourceId: string;
  subjectType: 'employee_assessment' | 'position_survey';
  position: string;
  employeeAiUsage?: {
    status: string;
    tools: string[];
    scenarios: string[];
    nonUseReasons: string[];
    barriers: string[];
  };
}

function breakdown(values: string[]): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values.map((item) => item.trim()).filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'));
}

const fixedScenarioLabels = new Set([
  '查找、阅读或整理资料',
  '撰写、修改或翻译内容',
  '数据处理与分析',
  '制作方案、汇报或演示材料',
  '编程、测试或技术排查',
  '会议记录与沟通协作',
  '处理重复操作或工作流程',
  '其他',
]);

const fixedBarrierLabels = new Set([
  '重复操作多或步骤繁琐',
  '查找、整理资料比较耗时',
  '容易出错或反复返工',
  '很依赖个人经验或判断',
  '跨部门、岗位沟通或交接不顺',
  '结果不够稳定',
  '使用过程比较麻烦',
  '准备材料或数据不方便',
  '工具或权限受限',
  '对实际工作帮助不明显',
  '担心数据安全或合规问题',
  '其他',
]);

function themeByKeyword(value: string, rules: Array<[RegExp, string]>, fixed: Set<string>): string {
  const normalized = value.trim();
  if (!normalized || normalized === '其他') return '其他';
  if (fixed.has(normalized)) return normalized;
  return rules.find(([pattern]) => pattern.test(normalized))?.[1] ?? '其他';
}

function scenarioTheme(value: string): string {
  return themeByKeyword(value, [
    [/会议|纪要|沟通|协作|访谈/, '会议记录与沟通协作'],
    [/查找|搜索|检索|阅读|资料|知识/, '查找、阅读或整理资料'],
    [/撰写|写作|文案|修改|润色|翻译/, '撰写、修改或翻译内容'],
    [/数据|报表|统计|分析|计算/, '数据处理与分析'],
    [/方案|汇报|演示|PPT|幻灯片/, '制作方案、汇报或演示材料'],
    [/编程|代码|开发|测试|排查|调试/, '编程、测试或技术排查'],
    [/流程|自动化|重复|批量|操作/, '处理重复操作或工作流程'],
  ], fixedScenarioLabels);
}

function barrierTheme(value: string): string {
  return themeByKeyword(value, [
    [/安全|合规|隐私|敏感/, '数据安全与合规'],
    [/权限|工具|访问|账号|网络/, '工具与权限'],
    [/材料|数据|资料|准备|格式/, '材料与数据准备'],
    [/稳定|准确|错误|异常|质量|返工|幻觉/, '结果稳定性与准确性'],
    [/麻烦|学习|时间|成本|提示词|不会用|难用/, '使用成本与学习门槛'],
    [/场景|适合|价值|帮助|效果|收益/, '场景适配与实际价值'],
    [/沟通|交接|协作|部门|流程/, '沟通与流程协作'],
  ], fixedBarrierLabels);
}

function themeBreakdown(
  facts: DashboardResponseFact[],
  values: (usage: NonNullable<DashboardResponseFact['employeeAiUsage']>) => string[],
  theme: (value: string) => string,
  limit = 5,
): Array<{ label: string; count: number }> {
  const sourceIdsByTheme = new Map<string, Set<string>>();
  for (const fact of facts) {
    if (!fact.employeeAiUsage) continue;
    for (const label of new Set(values(fact.employeeAiUsage).map(theme))) {
      const sourceIds = sourceIdsByTheme.get(label) ?? new Set<string>();
      sourceIds.add(fact.sourceId);
      sourceIdsByTheme.set(label, sourceIds);
    }
  }
  const ordered = [...sourceIdsByTheme.entries()]
    .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0], 'zh-CN'));
  if (ordered.length <= limit) return ordered.map(([label, sourceIds]) => ({ label, count: sourceIds.size }));

  const visible = ordered.slice(0, limit - 1);
  const remainingSources = new Set(ordered.slice(limit - 1).flatMap(([, sourceIds]) => [...sourceIds]));
  const visibleOther = visible.find(([label]) => label === '其他');
  if (visibleOther) {
    remainingSources.forEach((sourceId) => visibleOther[1].add(sourceId));
    return visible.map(([label, sourceIds]) => ({ label, count: sourceIds.size }));
  }
  return [...visible.map(([label, sourceIds]) => ({ label, count: sourceIds.size })), { label: '其他', count: remainingSources.size }];
}

const aiUseStatusLabels: Record<string, string> = {
  frequent: '经常使用',
  sometimes: '有时使用',
  tried_rarely: '尝试过，但很少使用',
  never: '还没有使用过',
};

export function dashboardResponseFacts(
  responses: SurveyResponseRecord[],
  reference: ReferenceData,
): DashboardResponseFact[] {
  return responses.map((record): DashboardResponseFact => {
    if (record.type === 'position') {
      return {
        sourceId: record.id,
        subjectType: 'position_survey',
        position: record.input.positionName || labelById(reference.positions, record.input.positionId, record.input.positionOther),
      };
    }
    const toolLabels = record.input.aiToolIds.flatMap((id) => {
      if (id === 'other') return record.input.aiToolOther?.trim() ? [record.input.aiToolOther.trim()] : ['其他'];
      return [reference.aiTools.find((item) => item.id === id)?.label || id];
    });
    if (record.input.aiToolOther?.trim() && !record.input.aiToolIds.includes('other')) toolLabels.push(record.input.aiToolOther.trim());
    return {
      sourceId: record.id,
      subjectType: 'employee_assessment',
      position: labelById(reference.positions, record.input.profile.positionId, record.input.profile.positionOther),
      employeeAiUsage: {
        status: aiUseStatusLabels[record.input.aiUseStatus] || record.input.aiUseStatus,
        tools: [...new Set(toolLabels)],
        scenarios: [...new Set(record.input.aiScenarios)],
        nonUseReasons: [...new Set(record.input.nonUseReasons)],
        barriers: [...new Set([...record.input.painPoints, ...record.input.discontinuationReasons])],
      },
    };
  });
}

export function buildPositionDemandMatrix(
  facts: DashboardResponseFact[],
  scenarios: AggregateScenario[],
  referencePositionLabels: string[],
): DashboardPositionDemandMatrix {
  const positionLabels = [...new Set([
    ...referencePositionLabels.filter(Boolean),
    ...facts.map((fact) => fact.position).filter(Boolean),
  ])];
  const validSamples = new Map<string, number>();
  for (const fact of facts) validSamples.set(fact.position, (validSamples.get(fact.position) || 0) + 1);
  const factPositions = new Map(facts.map((fact) => [`${fact.subjectType}:${fact.sourceId}`, fact.position]));
  const scenarioColumns = scenarios.map((scenario) => ({
    scenarioId: scenario.id,
    title: scenario.title,
    capabilityTheme: scenario.capabilityTheme,
  }));
  const cells = scenarioColumns.flatMap((scenarioColumn) => {
    const sourcePositions = new Map<string, Set<string>>();
    const scenario = scenarios.find((item) => item.id === scenarioColumn.scenarioId);
    for (const source of scenario?.sources ?? []) {
      const sourceKey = `${source.subjectType}:${source.subjectId}`;
      const position = factPositions.get(sourceKey);
      if (!position) continue;
      const ids = sourcePositions.get(position) ?? new Set<string>();
      ids.add(sourceKey);
      sourcePositions.set(position, ids);
    }
    return positionLabels.map((position) => ({
      position,
      scenarioId: scenarioColumn.scenarioId,
      mentions: sourcePositions.get(position)?.size ?? 0,
      validSampleCount: validSamples.get(position) ?? 0,
    }));
  });
  return {
    positions: positionLabels.map((position) => ({ position, validSampleCount: validSamples.get(position) ?? 0 })),
    scenarios: scenarioColumns,
    cells,
  };
}

export function buildAiUsageStats(facts: DashboardResponseFact[]): DashboardAiUsageStats {
  const employeeFacts = facts.flatMap((fact) => fact.employeeAiUsage ? [fact.employeeAiUsage] : []);
  return {
    validSampleCount: employeeFacts.length,
    statuses: breakdown(employeeFacts.map((item) => item.status)),
    tools: breakdown(employeeFacts.flatMap((item) => item.tools)),
    scenarios: themeBreakdown(facts, (item) => item.scenarios, scenarioTheme),
    nonUseReasons: breakdown(employeeFacts.flatMap((item) => item.nonUseReasons)),
    barriers: themeBreakdown(facts, (item) => item.barriers, barrierTheme),
  };
}

export async function buildMockDashboard(
  responses: SurveyResponseRecord[],
  analyses: AnalysisRecord[],
  reference: ReferenceData,
  minSampleSize = 3,
): Promise<AdminDashboardDto> {
  const currentResults = analyses
    .filter((item) => item.status === 'complete' && item.result)
    .map((item) => item.result)
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const aggregate = await createMockModelClient().generateAggregateAnalysis({
    batchId: reference.activeBatch.id,
    ruleVersion: 'aggregate-v2',
    minSampleSize,
    analyses: currentResults,
  });
  const departments = responses.map((record) => record.type === 'employee'
    ? labelById(reference.departments, record.input.profile.departmentId, record.input.profile.departmentOther)
    : labelById(reference.departments, record.input.departmentId, record.input.departmentOther));
  const positions = responses.map((record) => record.type === 'employee'
    ? labelById(reference.positions, record.input.profile.positionId, record.input.profile.positionOther)
    : record.input.positionName);
  const statusLabels = { pending: '分析准备中', running: '分析中', complete: '分析完成', failed: '分析失败', stale: '分析已过期' } as const;
  const dimensionValues = Array.from({ length: 6 }, (_, index) => responses
    .filter((record) => record.type === 'employee')
    .map((record) => record.type === 'employee' ? record.input.dimensions[index] : null)
    .filter((value): value is Exclude<typeof value, null> => value !== null));
  const facts = dashboardResponseFacts(responses, reference);
  const aggregateScenarios = aggregate.scenarios.map((scenario) => ({
    ...scenario,
    evidenceDimensions: sanitizeEvidenceDimensions(
      scenario.evidenceDimensions,
      scenario.sources,
      minSampleSize,
    ),
  }));

  return {
    batch: { id: reference.activeBatch.id, name: reference.activeBatch.name },
    aggregateStatus: 'complete',
    sampleSufficient: aggregate.sampleSufficient,
    minSampleSize,
    validAnalysisSourceCount: currentResults.length,
    metrics: [
      { label: '有效答卷', value: responses.length },
      { label: '具体需求场景', value: aggregate.scenarios.length },
      { label: '覆盖岗位', value: new Set(positions).size },
      { label: '已完成分析', value: currentResults.length },
    ],
    analysisStatuses: breakdown(responses.map((record) => statusLabels[record.analysisStatus])),
    departmentCoverage: breakdown(departments),
    positionCoverage: breakdown(positions),
    heatmap: aggregateScenarios.flatMap((scenario) => {
      const scenarioPositions = scenario.positions.length ? scenario.positions : positions;
      return [...new Set(scenarioPositions)].map((position) => ({ row: position, column: scenario.capabilityTheme, count: scenario.responseCount }));
    }),
    dimensions: dimensionValues.map((values, index) => ({
      dimensionKey: employeeDimensionDefinitions[index].key,
      dimension: employeeDimensionDefinitions[index]?.name ?? `未知维度 ${index + 1}`,
      description: employeeDimensionDefinitions[index]?.description ?? '当前没有维度说明。',
      average: values.length ? values.reduce((total, value) => total + value, 0) / values.length : null,
      validSampleCount: values.length,
    })),
    positionDemandMatrix: buildPositionDemandMatrix(facts, aggregateScenarios, reference.positions.map((item) => item.label)),
    aiUsageStats: buildAiUsageStats(facts),
    scenarios: aggregateScenarios,
    lastCalculatedAt: new Date().toISOString(),
  };
}
