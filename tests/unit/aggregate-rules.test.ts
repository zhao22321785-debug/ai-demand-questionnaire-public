import { groupScenarioCandidates, compareEvidence } from '../../src/lib/analysis/aggregate-rules';
import type { EmployeeAnalysisResult, PositionAnalysisResult } from '../../src/types/analysis';
import { createMockModelClient } from '../../src/lib/analysis/mock-model-client';
import { buildAggregateSourceSnapshot, sanitizeAggregateResult } from '../../netlify/functions/_shared/aggregate-service';

function result(id: string, mainProblem: string, input: string): PositionAnalysisResult {
  return {
    kind: 'position', subjectId: id, revision: 1, summary: '初步分析', departments: ['产品与运营'], positions: ['产品经理'], workSummary: ['会议记录'],
    capabilityThemes: ['会议内容结构化'], boundariesToAssess: ['保密边界'], disclaimer: '初步分析',
    scenarios: [{
      id: `scenario-${id}`, title: '整理会议记录', audience: 'same_position', taskSummary: '整理会议记录', currentProcess: '人工整理',
      mainProblem, occurrence: 'weekly', stability: 'partly_fixed', originalExpectation: '辅助总结', supportForms: ['会议内容结构化'],
      attentionReason: mainProblem, completeness: 'complete', missingInformation: [], followUpQuestions: ['如何验收？'], commonInput: input,
      expectedOutput: '会议纪要', capabilityTheme: '会议内容结构化',
      evidence: [{ subjectType: 'position_survey', subjectId: id, revision: 1, fieldPath: `tasks.${id}.mainProblem`, taskId: id, label: '查看原始回答' }],
    }],
  };
}

function employeeResult(
  id: string,
  title: string,
  mainProblem: string,
  currentProcess: string,
  position = '产品经理',
): EmployeeAnalysisResult {
  return {
    kind: 'employee', subjectId: id, revision: 1, hasExplicitDemand: true, summary: '初步分析',
    departments: ['产品与运营'], positions: [position], aiUseBackground: [], behaviorProfile: [], dimensionNotes: [], disclaimer: '初步分析',
    scenarios: [{
      id: `employee-${id}`, title, audience: 'same_position', taskSummary: title, currentProcess, mainProblem,
      occurrence: 'weekly', stability: 'partly_fixed', originalExpectation: '辅助整理并保留来源', supportForms: ['材料整理与结构化模板'],
      attentionReason: mainProblem, completeness: 'complete', missingInformation: ['真实输入样本'], followUpQuestions: ['如何验收？'],
      evidence: [
        { subjectType: 'employee_assessment', subjectId: id, revision: 1, fieldPath: `tasks.${id}.mainProblem`, taskId: id, label: '主要问题' },
        { subjectType: 'employee_assessment', subjectId: id, revision: 1, fieldPath: `tasks.${id}.expectedSupport`, taskId: id, label: '期望支持' },
      ],
    }],
  };
}

it('keeps same-name tasks separate when business conditions differ', () => {
  const grouped = groupScenarioCandidates([result('private', '涉密内容需人工把关', '内部会议录音'), result('public', '公开活动内容很长', '公开直播转写')]);
  expect(grouped.scenarios).toHaveLength(2);
  expect(grouped.capabilityThemes).toHaveLength(1);
});

it('does not let a source with missing input bridge two explicitly different business conditions', () => {
  const internal = result('internal', '涉密内容需人工把关', '内部会议录音');
  const publicSource = result('public', '公开活动内容很长', '公开直播转写');
  const employee = employeeResult('employee', '整理会议记录', '会议记录整理耗时', '人工整理');

  const grouped = groupScenarioCandidates([internal, publicSource, employee]);
  expect(grouped.scenarios).toHaveLength(2);
  expect(grouped.scenarios.reduce((count, scenario) => count + scenario.sources.length, 0)).toBe(3);
});

it('does not merge unrelated tasks merely because both mention a generic data term', () => {
  const report = employeeResult('report', '分析销售数据报表', '数据口径核对耗时', '汇总销售明细并生成报表');
  const backup = employeeResult('backup', '迁移用户数据备份', '数据迁移窗口较短', '校验备份后执行迁移');

  expect(groupScenarioCandidates([report, backup]).scenarios).toHaveLength(2);
});

it('merges employee and position evidence for the same role and business task despite wording and field asymmetry', () => {
  const employee = employeeResult(
    'employee-interview',
    '整理用户访谈记录',
    '一次访谈需要两小时整理，原话出处容易丢失',
    '逐段回听录音并把原话复制到主题表格',
  );
  const position = result('position-interview', '主题合并耗时，难以定位原始证据', '访谈录音、原始笔记和需求背景');
  position.scenarios[0] = {
    ...position.scenarios[0],
    title: '形成可追溯的访谈结论',
    taskSummary: '形成可追溯的访谈结论',
    currentProcess: '合并多名员工的访谈笔记并回看原始记录',
    expectedOutput: '带原话出处的主题摘要',
    originalExpectation: '按主题整理候选结论并保留原话出处',
  };

  const grouped = groupScenarioCandidates([employee, position]);
  expect(grouped.scenarios).toHaveLength(1);
  expect(grouped.scenarios[0]).toMatchObject({
    evidenceStatus: 'both_supported',
    capabilityTheme: '用户研究与洞察',
    responseCount: 2,
  });
  expect(grouped.scenarios[0].employeeEvidence).not.toHaveLength(0);
  expect(grouped.scenarios[0].positionEvidence).not.toHaveLength(0);
});

it('uses a broader position task to connect related employee task evidence within one role', () => {
  const fault = employeeResult('employee-fault', '定位开发环境故障', '跨服务日志分散，故障重复排查', '比对日志和最近提交', '研发工程师');
  const handoff = employeeResult('employee-handoff', '整理跨团队交接材料', '交接信息分散，证据出处难确认', '汇总工单、群聊和接口变化', '研发工程师');
  const position = result('position-delivery', '排障和交接材料分散，重复询问影响发布节奏', '服务日志、提交记录、接口变更说明和工单');
  position.positions = ['研发工程师'];
  position.scenarios[0] = {
    ...position.scenarios[0],
    title: '整理故障定位与交接信息', taskSummary: '整理故障定位与交接信息',
    currentProcess: '从多个系统收集线索并同步调用方', expectedOutput: '排查证据和待办责任人清单',
  };

  const grouped = groupScenarioCandidates([fault, handoff, position]);
  expect(grouped.scenarios).toHaveLength(1);
  expect(grouped.scenarios[0].sources).toHaveLength(3);
  expect(grouped.scenarios[0].capabilityTheme).toBe('研发交付与协作');
});

it('accepts a semantically compatible cross-source aggregate and preserves both sides through sanitizing', async () => {
  const employee = employeeResult('employee-interview', '整理用户访谈记录', '访谈整理耗时且原话出处易丢失', '回听录音并整理原话');
  const position = result('position-interview', '访谈主题合并耗时且证据难定位', '访谈录音和原始笔记');
  position.scenarios[0] = {
    ...position.scenarios[0], title: '形成可追溯的访谈结论', taskSummary: '形成可追溯的访谈结论',
    currentProcess: '合并访谈笔记并回看原始记录', expectedOutput: '带原话出处的主题摘要',
    evidence: [
      { subjectType: 'position_survey', subjectId: 'position-interview', revision: 1, fieldPath: 'tasks.position-interview.mainProblem', taskId: 'position-interview', label: '主要问题' },
      { subjectType: 'position_survey', subjectId: 'position-interview', revision: 1, fieldPath: 'tasks.position-interview.expectedAiSupport', taskId: 'position-interview', label: '期望支持' },
    ],
  };
  const analyses = [employee, position];
  const generated = await createMockModelClient().generateAggregateAnalysis({
    batchId: 'batch-1', ruleVersion: 'aggregate-v1', minSampleSize: 2, analyses,
  });

  expect(() => sanitizeAggregateResult(generated, {
    batchId: 'batch-1', ruleVersion: 'aggregate-v1', minSampleSize: 2, analyses,
  })).not.toThrow();
  const sanitized = sanitizeAggregateResult(generated, {
    batchId: 'batch-1', ruleVersion: 'aggregate-v1', minSampleSize: 2, analyses,
  });
  expect(sanitized.scenarios[0]).toMatchObject({ evidenceStatus: 'both_supported', responseCount: 2 });
  expect(sanitized.scenarios[0].evidenceDimensions?.find((item) => item.dimension === 'main_problem')).toMatchObject({
    employeeSourceIds: ['employee-interview'], positionSourceIds: ['position-interview'],
    employeeSourceCount: 1, positionSourceCount: 1,
  });
  const taskContext = sanitized.scenarios[0].evidenceDimensions?.find((item) => item.dimension === 'task_context');
  expect(taskContext).toMatchObject({
    employeeSummary: expect.stringContaining('回听录音'),
    positionSummary: expect.stringContaining('合并访谈笔记'),
    employeeSourceIds: ['employee-interview'],
    positionSourceIds: ['position-interview'],
  });
  expect(taskContext?.employeeSummary).not.toContain('合并访谈笔记');
  expect(taskContext?.positionSummary).not.toContain('回听录音');
});

it('keeps source-specific facts when different analyses reuse the same local scenario id', async () => {
  const first = employeeResult('employee-one', '整理用户访谈记录', '访谈整理耗时', '逐段回听录音');
  const second = employeeResult('employee-two', '整理用户访谈记录', '原话出处容易丢失', '人工复制原话到主题表');
  first.scenarios[0].id = 'local-scenario-1';
  second.scenarios[0].id = 'local-scenario-1';
  const analyses = [first, second];
  const generated = await createMockModelClient().generateAggregateAnalysis({
    batchId: 'batch-1', ruleVersion: 'aggregate-v2', minSampleSize: 2, analyses,
  });
  const sanitized = sanitizeAggregateResult(generated, {
    batchId: 'batch-1', ruleVersion: 'aggregate-v2', minSampleSize: 2, analyses,
  });

  expect(sanitized.scenarios[0].currentProcess).toContain('逐段回听录音');
  expect(sanitized.scenarios[0].currentProcess).toContain('人工复制原话到主题表');
  expect(sanitized.scenarios[0].responseCount).toBe(2);
});

it('treats missing position evidence as low evidence instead of conflict', () => {
  expect(compareEvidence(1, 0).status).toBe('employee_only');
  expect(compareEvidence(0, 1).status).toBe('position_evidence_low');
});

it('rejects aggregate evidence that is not part of the verified input set', async () => {
  const analyses = [result('one', '耗时', '内部访谈'), result('two', '耗时', '内部访谈'), result('three', '耗时', '内部访谈')];
  const generated = await createMockModelClient().generateAggregateAnalysis({ batchId: 'batch-1', ruleVersion: 'aggregate-v1', minSampleSize: 3, analyses });
  const scenario = generated.scenarios[0];
  const tampered = {
    ...generated,
    scenarios: [{ ...scenario, positionEvidence: [{ ...scenario.positionEvidence[0], subjectId: 'forged-response' }] }],
  };
  expect(() => sanitizeAggregateResult(tampered, { batchId: 'batch-1', ruleVersion: 'aggregate-v1', minSampleSize: 3, analyses })).toThrow(/输入集合之外/);
});

it('refuses a model attempt to merge same-name scenarios with different business conditions', async () => {
  const analyses = [result('one', '涉密内容需人工把关', '内部会议录音'), result('two', '公开活动内容很长', '公开直播转写'), result('three', '公开活动内容很长', '公开直播转写')];
  const generated = await createMockModelClient().generateAggregateAnalysis({ batchId: 'batch-1', ruleVersion: 'aggregate-v1', minSampleSize: 3, analyses });
  const merged = {
    ...generated.scenarios[0],
    positionEvidence: generated.scenarios.flatMap((scenario) => scenario.positionEvidence),
    sources: generated.scenarios.flatMap((scenario) => scenario.sources),
  };
  expect(() => sanitizeAggregateResult({ ...generated, scenarios: [merged] }, { batchId: 'batch-1', ruleVersion: 'aggregate-v1', minSampleSize: 3, analyses })).toThrow(/错误合并/);
});

it('returns no derived scenarios or themes below the sample threshold', async () => {
  const aggregate = await createMockModelClient().generateAggregateAnalysis({
    batchId: 'batch-1', ruleVersion: 'aggregate-v1', minSampleSize: 3,
    analyses: [result('one', '耗时', '内部访谈')],
  });
  expect(aggregate.sampleSufficient).toBe(false);
  expect(aggregate.scenarios).toEqual([]);
  expect(aggregate.capabilityThemes).toEqual([]);
});

it('builds complete mock evidence dimensions and lets deterministic sanitizing own all counts', async () => {
  const analyses = [
    result('one', '耗时', '内部访谈'),
    result('two', '耗时', '内部访谈'),
    result('three', '耗时', '内部访谈'),
  ];
  const input = { batchId: 'batch-1', ruleVersion: 'aggregate-v1', minSampleSize: 3, analyses };
  const generated = await createMockModelClient().generateAggregateAnalysis(input);

  expect(generated.scenarios[0].evidenceDimensions).toHaveLength(5);
  expect(generated.scenarios[0].evidenceDimensions?.every((dimension) => (
    dimension.employeeSourceCount === 0
    && dimension.employeeSourceTotal === 0
    && dimension.positionSourceCount === 0
    && dimension.positionSourceTotal === 0
  ))).toBe(true);
  expect(generated.scenarios[0].evidenceDimensions?.find((dimension) => dimension.dimension === 'system_data_conditions')).toMatchObject({
    positionSourceIds: ['one', 'two', 'three'],
  });

  const sanitized = sanitizeAggregateResult(generated, input);
  expect(sanitized.scenarios[0].evidenceDimensions?.find((dimension) => dimension.dimension === 'system_data_conditions')).toMatchObject({
    positionSourceIds: ['one', 'two', 'three'],
    positionSourceCount: 3,
    positionSourceTotal: 3,
    relation: 'employee_missing',
  });
});

it('keeps hidden system and data conditions attached to their exact scenario fingerprint', async () => {
  const first = result('one', '耗时', '内部访谈');
  first.scenarios.push({
    ...first.scenarios[0],
    id: 'scenario-public',
    commonInput: '公开活动材料',
  });
  const generated = await createMockModelClient().generateAggregateAnalysis({
    batchId: 'batch-1',
    ruleVersion: 'aggregate-v1',
    minSampleSize: 1,
    analyses: [first],
  });

  expect(generated.scenarios).toHaveLength(2);
  const summaries = generated.scenarios.map((scenario) => (
    scenario.evidenceDimensions?.find((dimension) => dimension.dimension === 'system_data_conditions')?.positionSummary
  ));
  expect(summaries[0]).toContain('内部访谈');
  expect(summaries[0]).not.toContain('公开活动材料');
  expect(summaries[1]).toContain('公开活动材料');
  expect(summaries[1]).not.toContain('内部访谈');
});

it('keeps employee and position expectation summaries traceable to their own source ids', async () => {
  const position = result('position-one', '耗时', '内部访谈');
  position.scenarios[0] = {
    ...position.scenarios[0],
    originalExpectation: '负责人要求保留来源',
    evidence: [{
      subjectType: 'position_survey', subjectId: 'position-one', revision: 1,
      fieldPath: 'tasks.position-one.expectedAiSupport', taskId: 'position-one', label: '期望支持',
    }],
  };
  const employee: EmployeeAnalysisResult = {
    kind: 'employee', subjectId: 'employee-one', revision: 1, hasExplicitDemand: true, summary: '初步分析',
    departments: ['产品与运营'], positions: ['产品经理'], aiUseBackground: [], behaviorProfile: [], dimensionNotes: [], disclaimer: '初步分析',
    scenarios: [{
      ...position.scenarios[0],
      id: 'scenario-employee',
      originalExpectation: '员工希望自动归类',
      evidence: [{
        subjectType: 'employee_assessment', subjectId: 'employee-one', revision: 1,
        fieldPath: 'tasks.employee-one.expectedSupport', taskId: 'employee-one', label: '期望支持',
      }],
    }],
  };
  const generated = await createMockModelClient().generateAggregateAnalysis({
    batchId: 'batch-1', ruleVersion: 'aggregate-v1', minSampleSize: 2, analyses: [employee, position],
  });
  const comparison = generated.scenarios[0].evidenceDimensions?.find((dimension) => dimension.dimension === 'expected_support');

  expect(comparison).toMatchObject({
    employeeSummary: '员工希望自动归类',
    positionSummary: '负责人要求保留来源',
    employeeSourceIds: ['employee-one'],
    positionSourceIds: ['position-one'],
  });
});

it('invalidates the aggregate cache when completed analyses change without a response revision change', () => {
  const config = { ruleVersion: 'aggregate-v1', promptVersion: 'aggregate-v1', modelKey: 'configured-model', minSampleSize: 3 };
  const first = buildAggregateSourceSnapshot([{ id: 'analysis-1', subject_type: 'employee_assessment', subject_id: 'response-1', revision: 1, updated_at: '2026-07-24T00:00:00.000Z' }], config);
  const completedLater = buildAggregateSourceSnapshot([
    { id: 'analysis-1', subject_type: 'employee_assessment', subject_id: 'response-1', revision: 1, updated_at: '2026-07-24T00:00:00.000Z' },
    { id: 'analysis-2', subject_type: 'position_survey', subject_id: 'response-2', revision: 1, updated_at: '2026-07-24T00:05:00.000Z' },
  ], config);
  const retried = buildAggregateSourceSnapshot([{ id: 'analysis-1', subject_type: 'employee_assessment', subject_id: 'response-1', revision: 1, updated_at: '2026-07-24T00:10:00.000Z' }], config);
  expect(completedLater).not.toEqual(first);
  expect(retried).not.toEqual(first);
});
