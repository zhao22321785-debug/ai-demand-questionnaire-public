import type {
  AggregateAnalysisResult,
  AggregateScenario,
  EmployeeAnalysisInput,
  EmployeeAnalysisResult,
  EvidenceDimensionComparison,
  EvidenceReference,
  ModelClient,
  PositionAnalysisInput,
  PositionAnalysisResult,
  ScenarioAnalysis,
  SingleAnalysisResult,
} from '../../types/analysis';
import { groupScenarioCandidateDetails, groupScenarioCandidates } from './aggregate-rules';

const preliminaryDisclaimer = '这是基于当前答卷形成的初步分析，只用于帮助管理员继续了解线索，不代表立项、优先级或技术可行性结论。';

function evidence(
  subjectType: EvidenceReference['subjectType'],
  subjectId: string,
  revision: number,
  fieldPath: string,
  label: string,
  taskId?: string,
  excerpt?: string,
): EvidenceReference {
  return { subjectType, subjectId, revision, fieldPath, label, taskId, excerpt };
}

function supportForms(expectation: string): string[] {
  const values: string[] = [];
  if (/整理|归类|总结|提取/.test(expectation)) values.push('材料整理与结构化模板');
  if (/检查|审核|校验/.test(expectation)) values.push('检查规则与人工复核清单');
  if (/自动|流程|重复/.test(expectation)) values.push('流程节点与可复用步骤');
  return values.length ? values : ['进一步确认输入、输出与人工边界'];
}

function evidenceSourceIds(
  references: EvidenceReference[],
  fieldPattern: RegExp,
): string[] {
  return [...new Set(
    references
      .filter((reference) => fieldPattern.test(reference.fieldPath))
      .map((reference) => reference.subjectId),
  )];
}

function evidenceDimension(
  dimension: EvidenceDimensionComparison['dimension'],
  relation: EvidenceDimensionComparison['relation'],
  employeeSummary: string,
  positionSummary: string,
  employeeSourceIds: string[],
  positionSourceIds: string[],
): EvidenceDimensionComparison {
  return {
    dimension,
    relation,
    employeeSummary,
    positionSummary,
    employeeSourceIds,
    positionSourceIds,
    // Counts are deterministic server data. Mock model output follows the same
    // contract and leaves placeholders for sanitizeEvidenceDimensions().
    employeeSourceCount: 0,
    employeeSourceTotal: 0,
    positionSourceCount: 0,
    positionSourceTotal: 0,
  };
}

type SourceScenarioDetail = {
  subjectId: string;
  subjectType: 'employee_assessment' | 'position_survey';
  scenario: ScenarioAnalysis;
};

function groupedScenarioDetails(
  analyses: SingleAnalysisResult[],
): SourceScenarioDetail[][] {
  return groupScenarioCandidateDetails(analyses).map((group) => group.map(({ result, scenario }) => ({
    subjectId: result.subjectId,
    subjectType: result.kind === 'employee' ? 'employee_assessment' : 'position_survey',
    scenario,
  })));
}

function detailEvidence(
  details: SourceScenarioDetail[],
  summary: (scenario: ScenarioAnalysis) => string,
): { sourceIds: string[]; summary: string } {
  const values = details
    .map(({ subjectId, scenario }) => ({ subjectId, value: summary(scenario).trim() }))
    .filter((item) => item.value);
  return {
    sourceIds: [...new Set(values.map((item) => item.subjectId))],
    summary: [...new Set(values.map((item) => item.value))].join('；'),
  };
}

function systemDataSummary(scenario: ScenarioAnalysis): string {
  return [
    scenario.commonInput ? `常见输入：${scenario.commonInput}` : '',
    scenario.expectedOutput ? `期望输出：${scenario.expectedOutput}` : '',
    scenario.collaboration ? `协作条件：${scenario.collaboration}` : '',
  ].filter(Boolean).join('；');
}

function taskContextSummary(scenario: ScenarioAnalysis): string {
  return [
    `实际任务：${scenario.taskSummary}`,
    `当前做法：${scenario.currentProcess}`,
    `发生规律：${scenario.occurrence}`,
    `覆盖人群：${scenario.audience}`,
  ].join('；');
}

function mockEvidenceDimensions(
  scenario: AggregateScenario,
  sourceDetails: SourceScenarioDetail[],
): EvidenceDimensionComparison[] {
  const employeeDetails = sourceDetails.filter((item) => item.subjectType === 'employee_assessment');
  const positionDetails = sourceDetails.filter((item) => item.subjectType === 'position_survey');
  const employeeProblemSources = evidenceSourceIds(scenario.employeeEvidence, /\.mainProblem$/i);
  const positionProblemSources = evidenceSourceIds(scenario.positionEvidence, /\.mainProblem$/i);
  const employeeSupportSources = evidenceSourceIds(scenario.employeeEvidence, /\.expectedSupport$/i);
  const positionSupportSources = evidenceSourceIds(scenario.positionEvidence, /\.(?:expectedAiSupport|expectedSupport)$/i);
  const employeeTaskContext = detailEvidence(employeeDetails, taskContextSummary);
  const positionTaskContext = detailEvidence(positionDetails, taskContextSummary);
  const employeeProblem = detailEvidence(
    employeeDetails.filter((item) => employeeProblemSources.includes(item.subjectId)),
    (item) => item.mainProblem,
  );
  const positionProblem = detailEvidence(
    positionDetails.filter((item) => positionProblemSources.includes(item.subjectId)),
    (item) => item.mainProblem,
  );
  const employeeExpectation = detailEvidence(
    employeeDetails.filter((item) => employeeSupportSources.includes(item.subjectId)),
    (item) => item.originalExpectation,
  );
  const positionExpectation = detailEvidence(
    positionDetails.filter((item) => positionSupportSources.includes(item.subjectId)),
    (item) => item.originalExpectation,
  );
  const employeeBoundary = detailEvidence(employeeDetails, (item) => item.humanBoundary ?? '');
  const positionBoundary = detailEvidence(positionDetails, (item) => item.humanBoundary ?? '');
  const employeeSystemData = detailEvidence(employeeDetails, systemDataSummary);
  const positionSystemData = detailEvidence(positionDetails, systemDataSummary);

  return [
    evidenceDimension(
      'task_context',
      'both_mentioned',
      employeeTaskContext.summary,
      positionTaskContext.summary,
      employeeTaskContext.sourceIds,
      positionTaskContext.sourceIds,
    ),
    evidenceDimension(
      'main_problem',
      'direction_aligned',
      employeeProblem.summary,
      positionProblem.summary,
      employeeProblem.sourceIds,
      positionProblem.sourceIds,
    ),
    evidenceDimension(
      'expected_support',
      'complementary',
      employeeExpectation.summary,
      positionExpectation.summary,
      employeeExpectation.sourceIds,
      positionExpectation.sourceIds,
    ),
    evidenceDimension(
      'human_boundary',
      'complementary',
      employeeBoundary.summary,
      positionBoundary.summary,
      employeeBoundary.sourceIds,
      positionBoundary.sourceIds,
    ),
    evidenceDimension(
      'system_data_conditions',
      'complementary',
      employeeSystemData.summary,
      positionSystemData.summary,
      employeeSystemData.sourceIds,
      positionSystemData.sourceIds,
    ),
  ];
}

function employeeScenario(input: EmployeeAnalysisInput, task: EmployeeAnalysisInput['tasks'][number]): ScenarioAnalysis {
  const base = `tasks.${task.id}`;
  return {
    id: `employee-${input.subjectId}-${task.id}`,
    title: task.title,
    audience: task.audience,
    taskSummary: task.title,
    currentProcess: task.currentProcess,
    mainProblem: task.mainProblem,
    occurrence: task.occurrence,
    stability: task.stability,
    originalExpectation: task.expectedSupport,
    supportForms: supportForms(task.expectedSupport),
    attentionReason: `这项任务的当前问题是“${task.mainProblem}”，答卷同时保留了发生规律和步骤稳定程度，可作为后续判断复用价值的线索。`,
    completeness: task.currentProcess && task.mainProblem && task.expectedSupport ? 'complete' : 'partial',
    missingInformation: ['实际投入时间或工作量', '可用于验收的结果标准'],
    followUpQuestions: ['当前流程中最需要人工判断的是哪一步？', '什么结果可以说明这项支持确实有效？'],
    evidence: [
      evidence('employee_assessment', input.subjectId, input.revision, `${base}.mainProblem`, '查看原始回答', task.id, task.mainProblem),
      evidence('employee_assessment', input.subjectId, input.revision, `${base}.expectedSupport`, '查看原始回答', task.id, task.expectedSupport),
    ],
  };
}

function positionScenario(input: PositionAnalysisInput, task: PositionAnalysisInput['tasks'][number]): ScenarioAnalysis {
  const base = `tasks.${task.id}`;
  const collaboration = task.collaboration.join('；');
  return {
    id: `position-${input.subjectId}-${task.id}`,
    title: task.task,
    audience: task.audience,
    taskSummary: task.task,
    currentProcess: task.currentProcess,
    mainProblem: task.mainProblem,
    occurrence: task.occurrence,
    stability: task.stability,
    originalExpectation: task.expectedAiSupport,
    supportForms: supportForms(task.expectedAiSupport),
    attentionReason: `负责人把“${task.mainProblem}”作为当前问题，相关期望仍需结合真实样本和人工边界继续评估。`,
    completeness: task.currentProcess && task.mainProblem && task.expectedAiSupport ? 'complete' : 'partial',
    missingInformation: ['真实输入样本', '业务影响证据', '可验收的质量标准'],
    followUpQuestions: ['是否有可脱敏的真实样本用于验证？', '哪些结果必须由岗位人员最终确认？'],
    evidence: [
      evidence('position_survey', input.subjectId, input.revision, `${base}.mainProblem`, '查看原始回答', task.id, task.mainProblem),
      evidence('position_survey', input.subjectId, input.revision, `${base}.expectedAiSupport`, '查看原始回答', task.id, task.expectedAiSupport),
    ],
    commonInput: task.hasFixedInput ? task.commonInput : '输入不固定',
    expectedOutput: task.hasFixedOutput ? task.output : '输出不固定',
    humanBoundary: task.humanReviewContent || (task.resultUsage === 'direct' ? '负责人暂未提出固定人工确认项' : '需要进一步明确人工确认内容'),
    collaboration: collaboration || '未提出跨部门或跨岗位协作条件',
    capabilityTheme: supportForms(task.expectedAiSupport)[0],
  };
}

export function createMockModelClient(): ModelClient {
  return {
    async generateEmployeeAnalysis(input) {
      const scenarios = input.hasExplicitDemand ? input.tasks.map((task) => employeeScenario(input, task)) : [];
      return {
        kind: 'employee',
        subjectId: input.subjectId,
        revision: input.revision,
        hasExplicitDemand: input.hasExplicitDemand,
        summary: input.hasExplicitDemand
          ? `当前答卷记录了 ${scenarios.length} 个具体工作场景，可继续核对样本、人工判断点和验收标准。`
          : '填写者本次没有提交明确想改善的工作，当前只保留 AI 使用背景和行为回顾。',
        departments: [input.respondent.department],
        positions: [input.respondent.position],
        aiUseBackground: input.aiUseBackground.length ? input.aiUseBackground : [`AI 使用状态：${input.aiUseStatus}`],
        scenarios,
        behaviorProfile: ['仅描述当前答卷中的实际行为，不形成能力评分或绩效判断。'],
        dimensionNotes: input.dimensions.map((value, index) => `维度 ${index + 1}：${value === null ? '不适用' : '已记录'}`),
        disclaimer: preliminaryDisclaimer,
      } satisfies EmployeeAnalysisResult;
    },
    async generatePositionAnalysis(input) {
      const scenarios = input.tasks.map((task) => positionScenario(input, task));
      return {
        kind: 'position',
        subjectId: input.subjectId,
        revision: input.revision,
        summary: `当前岗位答卷形成 ${scenarios.length} 个具体任务线索；负责人期望、可能能力主题和待评估边界保持分开展示。`,
        departments: [input.position.department],
        positions: [input.position.name],
        workSummary: input.workItems.filter((item) => item.selectedForImprovement).map((item) => `${item.name}：${item.description}`),
        scenarios,
        capabilityThemes: [...new Set(scenarios.map((scenario) => scenario.capabilityTheme).filter((value): value is string => Boolean(value)))],
        boundariesToAssess: ['真实样本是否可用', '人工确认责任', '数据与权限边界', '结果验收方式'],
        disclaimer: preliminaryDisclaimer,
      } satisfies PositionAnalysisResult;
    },
    async generateAggregateAnalysis(input) {
      const grouped = groupScenarioCandidates(input.analyses);
      const sourceGroups = groupedScenarioDetails(input.analyses);
      const sampleSufficient = input.analyses.length >= input.minSampleSize;
      return {
        kind: 'aggregate',
        batchId: input.batchId,
        ruleVersion: input.ruleVersion,
        sampleSize: input.analyses.length,
        sampleSufficient,
        summary: sampleSufficient
          ? `当前 ${input.analyses.length} 份有效单份分析形成 ${grouped.scenarios.length} 个具体场景。`
          : `当前只有 ${input.analyses.length} 份有效单份分析，低于 ${input.minSampleSize} 份样本保护阈值，暂不形成共性或差异结论。`,
        scenarios: sampleSufficient
          ? grouped.scenarios.map((scenario, index) => ({
            ...scenario,
            evidenceDimensions: mockEvidenceDimensions(scenario, sourceGroups[index] ?? []),
          }))
          : [],
        capabilityThemes: sampleSufficient ? grouped.capabilityThemes : [],
        disclaimer: preliminaryDisclaimer,
      } satisfies AggregateAnalysisResult;
    },
  };
}
