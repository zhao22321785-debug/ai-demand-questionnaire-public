import { describe, expect, it } from 'vitest';
import { buildAiUsageStats, buildMockDashboard } from '../../src/lib/analysis/dashboard';
import { sanitizeAggregateResult } from '../../netlify/functions/_shared/aggregate-service';
import { AggregateAnalysisResultSchema } from '../../src/types/analysis';
import { aggregateResultJsonSchema } from '../../netlify/functions/_shared/analysis-schemas';
import adminDashboardSource from '../../netlify/functions/admin-dashboard.ts?raw';
import type { AnalysisRecord, EmployeeAnalysisResult, PositionAnalysisResult } from '../../src/types/analysis';
import type { EmployeeResponseRecord, ReferenceData } from '../../src/types/survey';
import { adminDashboardFixture } from '../fixtures/admin-analysis';

const reference: ReferenceData = {
  activeBatch: {
    id: 'batch-1', name: '测试批次', surveyVersionId: 'v1',
    employeeSurveyVersionId: 'v1', positionSurveyVersionId: 'v1',
  },
  departments: [{ id: 'technology', code: 'technology', label: '技术研发' }],
  positions: [
    { id: 'engineer', code: 'engineer', label: '研发工程师' },
    { id: 'sales', code: 'sales', label: '销售' },
  ],
  aiTools: [{ id: 'chatgpt', code: 'chatgpt', label: 'ChatGPT' }],
};

function scenario(subjectType: 'employee_assessment' | 'position_survey', subjectId: string) {
  return {
    id: `source-${subjectId}`, title: '整理客户材料', audience: '业务团队', taskSummary: '整理客户材料',
    currentProcess: '人工逐份整理', mainProblem: '材料分散且耗时', occurrence: 'weekly', stability: 'partly_fixed',
    originalExpectation: '辅助归类并保留来源', supportForms: ['资料归类'], attentionReason: '存在重复整理工作',
    completeness: 'complete' as const, missingInformation: [], followUpQuestions: ['哪些内容必须人工确认？'],
    evidence: [{
      subjectType, subjectId, revision: 1, fieldPath: `tasks.${subjectId}.mainProblem`, taskId: subjectId,
      label: '主要问题', excerpt: '材料分散且耗时',
    }],
  };
}

function employeeAnalysis(id: string): EmployeeAnalysisResult {
  return {
    kind: 'employee', subjectId: id, revision: 1, hasExplicitDemand: true, summary: '初步分析',
    departments: ['技术研发'], positions: ['研发工程师'], aiUseBackground: ['经常使用'],
    scenarios: [scenario('employee_assessment', id)], behaviorProfile: [], dimensionNotes: [], disclaimer: '初步分析',
  };
}

function positionAnalysis(id: string): PositionAnalysisResult {
  return {
    kind: 'position', subjectId: id, revision: 1, summary: '初步分析', departments: ['技术研发'], positions: ['研发工程师'],
    workSummary: [], scenarios: [scenario('position_survey', id)], capabilityThemes: ['资料归类'], boundariesToAssess: [], disclaimer: '初步分析',
  };
}

function aggregateScenario() {
  return {
    id: 'scenario-1', title: '整理客户材料', capabilityTheme: '资料归类', summary: '整理客户材料',
    currentProcess: '占位', mainProblem: '占位', occurrence: '占位', stability: '占位', audience: '占位',
    originalExpectations: [], possibleSupport: [], departments: [], positions: [], responseCount: 999, coveredPeople: 999,
    employeeEvidence: [scenario('employee_assessment', 'employee-1').evidence[0], scenario('employee_assessment', 'employee-2').evidence[0]],
    positionEvidence: [scenario('position_survey', 'position-1').evidence[0]], evidenceStatus: 'both_supported' as const,
    completeness: 'complete' as const, followUpQuestions: [],
    sources: [{ subjectType: 'employee_assessment' as const, subjectId: 'employee-1', revision: 1, title: '占位', route: '/forged' }],
  };
}

describe('admin dashboard v2 deterministic data', () => {
  it('deterministically folds free-text AI themes and keeps at most five visible groups', () => {
    const makeFact = (sourceId: string, scenarios: string[], barriers: string[]) => ({
      sourceId,
      subjectType: 'employee_assessment' as const,
      position: '研发工程师',
      employeeAiUsage: { status: '经常使用', tools: [], scenarios, nonUseReasons: [], barriers },
    });
    const stats = buildAiUsageStats([
      makeFact('employee-1', ['检索竞品资料', '查找、阅读或整理资料', '整理会议纪要', '生成汇报 PPT'], ['模型回答经常不准确', '缺少系统访问权限', '敏感数据合规风险']),
      makeFact('employee-2', ['整理会议纪要'], ['缺少系统访问权限']),
      makeFact('employee-3', ['生成汇报 PPT'], ['敏感数据合规风险']),
      makeFact('employee-4', ['辅助代码调试'], ['准备表格数据很麻烦']),
      makeFact('employee-5', ['批量处理重复流程'], ['不知道哪些场景有实际价值']),
      makeFact('employee-6', ['撰写业务文案'], ['跨部门沟通成本高']),
      makeFact('employee-7', ['清洗数据报表'], ['提示词学习成本高']),
    ]);

    expect(stats.scenarios).toHaveLength(5);
    expect(stats.scenarios).toContainEqual({ label: '查找、阅读或整理资料', count: 1 });
    expect(stats.scenarios.find((item) => item.label === '其他')?.count).toBeLessThanOrEqual(stats.validSampleCount);
    expect(stats.barriers).toHaveLength(5);
    expect(stats.barriers.every((item) => item.count <= stats.validSampleCount)).toBe(true);
  });

  it('uses the same employee-response denominator for AI usage and the mandatory first profile dimension', () => {
    const employeeTotal = adminDashboardFixture.aiUsageStats.validSampleCount;
    expect(adminDashboardFixture.dimensions[0].validSampleCount).toBe(employeeTotal);
    expect(adminDashboardFixture.aiUsageStats.statuses.reduce((sum, item) => sum + item.count, 0)).toBe(employeeTotal);
  });

  it('keeps remote position grouping aligned with mock concrete position names', () => {
    expect(adminDashboardSource).toContain("position: row.position_name || row.position_other || positionNames.get(row.position_id)");
    expect(adminDashboardSource).toContain('responsePositionCoverage');
  });

  it('requires all five evidence dimensions while making model supplied counts fixed placeholders', () => {
    const aggregateScenarioSchema = aggregateResultJsonSchema.properties.scenarios.items;
    expect(aggregateScenarioSchema.required).toContain('evidenceDimensions');
    expect(aggregateScenarioSchema.properties.evidenceDimensions).toMatchObject({ minItems: 5, maxItems: 5 });
    expect(aggregateScenarioSchema.properties.evidenceDimensions.items.properties.employeeSourceCount).toEqual({ const: 0 });
    expect(aggregateScenarioSchema.properties.evidenceDimensions.items.properties.positionSourceTotal).toEqual({ const: 0 });
  });

  it('keeps an old aggregate payload usable by defaulting evidence dimensions to an empty list', () => {
    const parsed = AggregateAnalysisResultSchema.parse({
      kind: 'aggregate', batchId: 'batch-1', ruleVersion: 'aggregate-v1', sampleSize: 3, sampleSufficient: true,
      summary: '初步分析', scenarios: [aggregateScenario()], capabilityThemes: [], disclaimer: '初步分析',
    });
    expect((parsed.scenarios[0] as { evidenceDimensions?: unknown[] }).evidenceDimensions).toEqual([]);
  });

  it('rejects a partially generated five-dimension comparison while still accepting legacy omission', () => {
    const parsed = AggregateAnalysisResultSchema.safeParse({
      kind: 'aggregate', batchId: 'batch-1', ruleVersion: 'aggregate-v1', sampleSize: 3, sampleSufficient: true,
      summary: '初步分析', capabilityThemes: [], disclaimer: '初步分析',
      scenarios: [{
        ...aggregateScenario(),
        evidenceDimensions: [{
          dimension: 'main_problem', employeeSourceCount: 0, employeeSourceTotal: 0,
          positionSourceCount: 0, positionSourceTotal: 0, relation: 'both_mentioned',
          employeeSummary: '员工摘要', positionSummary: '负责人摘要', employeeSourceIds: ['employee-1'], positionSourceIds: ['position-1'],
        }],
      }],
    });
    expect(parsed.success).toBe(false);
  });

  it('filters dimension source ids and overwrites every model supplied count from canonical sources', () => {
    const analyses = [employeeAnalysis('employee-1'), employeeAnalysis('employee-2'), positionAnalysis('position-1')];
    const result = sanitizeAggregateResult({
      kind: 'aggregate', batchId: 'batch-1', ruleVersion: 'aggregate-v1', sampleSize: 999, sampleSufficient: true,
      summary: '初步分析', capabilityThemes: [], disclaimer: '初步分析',
      scenarios: [{
        ...aggregateScenario(),
        evidenceDimensions: [{
          dimension: 'main_problem', employeeSourceCount: 999, employeeSourceTotal: 999,
          positionSourceCount: 999, positionSourceTotal: 999, relation: 'both_mentioned',
          employeeSummary: '员工提到材料分散', positionSummary: '负责人提到整理耗时',
          employeeSourceIds: ['employee-1', 'employee-1', 'forged'], positionSourceIds: ['position-1', 'forged'],
        }],
      }],
    } as never, { batchId: 'batch-1', ruleVersion: 'aggregate-v1', minSampleSize: 3, analyses });

    const comparison = (result.scenarios[0] as { evidenceDimensions: Array<Record<string, unknown>> }).evidenceDimensions[0];
    expect(comparison).toMatchObject({
      employeeSourceIds: ['employee-1'], positionSourceIds: ['position-1'],
      employeeSourceCount: 1, employeeSourceTotal: 2, positionSourceCount: 1, positionSourceTotal: 1,
    });
  });

  it('derives position matrix denominators and AI usage distributions only from response fields', async () => {
    const response: EmployeeResponseRecord = {
      id: 'employee-1', userId: 'user-1', batchId: 'batch-1', revision: 1, analysisStatus: 'complete',
      submittedAt: '2026-07-25T00:00:00.000Z', updatedAt: '2026-07-25T00:00:00.000Z', type: 'employee',
      input: {
        batchId: 'batch-1', surveyVersionId: 'v1', profile: {
          name: '测试员工', departmentId: 'technology', positionId: 'engineer', currentPositionExperience: '1_3',
        },
        aiUseStatus: 'frequent', nonUseReasons: [], discontinuationReasons: [], aiToolIds: ['chatgpt'],
        aiScenarios: ['查找、阅读或整理资料'], painPoints: ['查找、整理资料比较耗时'], hasExplicitDemand: true,
        tasks: [], dimensions: [3, 3, 3, 3, 3, 3],
      },
    };
    const now = '2026-07-25T00:00:00.000Z';
    const analyses: AnalysisRecord[] = [{
      id: 'analysis-1', subjectType: 'employee_assessment', subjectId: response.id, revision: 1, status: 'complete',
      result: employeeAnalysis(response.id), attemptCount: 1, promptVersion: 'single-v1', createdAt: now, updatedAt: now,
    }];
    const dashboard = await buildMockDashboard([response], analyses, reference, 1);

    expect(dashboard.dimensions.map((item) => item.dimension)).toEqual([
      'AI 适用场景判断',
      '任务目标与信息准备',
      '结果偏差识别与过程调整',
      'AI 结果核验与人工确认',
      'AI 融入工作流程',
      '方法沉淀与协作复用',
    ]);
    expect(dashboard.aiUsageStats).toMatchObject({
      validSampleCount: 1,
      statuses: [{ label: '经常使用', count: 1 }],
      tools: [{ label: 'ChatGPT', count: 1 }],
      scenarios: [{ label: '查找、阅读或整理资料', count: 1 }],
      barriers: [{ label: '查找、整理资料比较耗时', count: 1 }],
    });
    expect(dashboard.positionDemandMatrix.positions).toEqual([
      { position: '研发工程师', validSampleCount: 1 },
      { position: '销售', validSampleCount: 0 },
    ]);
    expect(dashboard.positionDemandMatrix.cells).toEqual(expect.arrayContaining([
      expect.objectContaining({ position: '研发工程师', mentions: 1, validSampleCount: 1 }),
      expect.objectContaining({ position: '销售', mentions: 0, validSampleCount: 0 }),
    ]));
    expect(dashboard.scenarios[0].evidenceDimensions).toHaveLength(5);
    expect(dashboard.scenarios[0].evidenceDimensions?.map((item) => item.dimension)).toEqual([
      'task_context',
      'main_problem',
      'expected_support',
      'human_boundary',
      'system_data_conditions',
    ]);
    expect(dashboard.scenarios[0].evidenceDimensions?.find((item) => item.dimension === 'main_problem')).toMatchObject({
      employeeSourceIds: ['employee-1'],
      employeeSourceCount: 1,
      employeeSourceTotal: 1,
      positionSourceCount: 0,
      positionSourceTotal: 0,
      relation: 'position_missing',
    });
  });

  it('reads only the fixed employee fields and minimum position identity needed by the remote dashboard', () => {
    expect(adminDashboardSource).toMatch(/from\('employee_assessments'\)[\s\S]*response_payload[\s\S]*ai_use_status[\s\S]*pain_points/);
    expect(adminDashboardSource).toMatch(/from\('position_demand_surveys'\)[\s\S]*position_name/);
    expect(adminDashboardSource).toMatch(/from\('ai_tool_options'\)[\s\S]*select\('id,name'\)/);
  });
});
