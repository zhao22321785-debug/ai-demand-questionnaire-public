import type { AdminDashboardDto } from '../../src/types/analysis';

export const adminDashboardFixture: AdminDashboardDto = {
  batch: { id: 'batch-1', name: '第一轮 AI 需求调研' },
  aggregateStatus: 'complete',
  sampleSufficient: true,
  minSampleSize: 3,
  validAnalysisSourceCount: 7,
  metrics: [
    { label: '有效答卷', value: 8 },
    { label: '具体需求场景', value: 2 },
    { label: '覆盖岗位', value: 3 },
    { label: '已完成分析', value: 7 },
  ],
  analysisStatuses: [{ label: '分析完成', count: 7 }],
  departmentCoverage: [{ label: '技术研发', count: 5 }],
  positionCoverage: [{ label: '研发工程师', count: 5 }],
  heatmap: [{ row: '研发工程师', column: '知识整理', count: 4 }],
  dimensions: [{ dimensionKey: 'ai_suitability', dimension: 'AI 适用场景判断', description: '判断 AI 适用环节。', average: 3.5, validSampleCount: 6 }],
  positionDemandMatrix: {
    positions: [
      { position: '产品经理', validSampleCount: 3 },
      { position: '销售', validSampleCount: 2 },
      { position: '暂无样本岗位', validSampleCount: 0 },
    ],
    scenarios: [
      { scenarioId: 'scenario-knowledge', title: '整理访谈与需求记录', capabilityTheme: '知识整理' },
      { scenarioId: 'scenario-brief', title: '生成客户沟通摘要', capabilityTheme: '沟通准备' },
    ],
    cells: [
      { position: '产品经理', scenarioId: 'scenario-knowledge', mentions: 2, validSampleCount: 3 },
      { position: '产品经理', scenarioId: 'scenario-brief', mentions: 0, validSampleCount: 3 },
      { position: '销售', scenarioId: 'scenario-knowledge', mentions: 0, validSampleCount: 2 },
      { position: '销售', scenarioId: 'scenario-brief', mentions: 1, validSampleCount: 2 },
      { position: '暂无样本岗位', scenarioId: 'scenario-knowledge', mentions: 0, validSampleCount: 0 },
      { position: '暂无样本岗位', scenarioId: 'scenario-brief', mentions: 0, validSampleCount: 0 },
    ],
  },
  aiUsageStats: {
    validSampleCount: 6,
    statuses: [{ label: '经常使用', count: 3 }, { label: '有时使用', count: 2 }, { label: '还没有使用过', count: 1 }],
    tools: [{ label: '通用对话工具', count: 4 }],
    scenarios: [{ label: '材料整理', count: 3 }],
    nonUseReasons: [{ label: '不了解适用场景', count: 1 }],
    barriers: [{ label: '结果仍需核对', count: 3 }],
  },
  scenarios: [
    {
      id: 'scenario-knowledge', title: '整理访谈与需求记录', capabilityTheme: '知识整理', summary: '将分散记录整理为可追溯的需求材料。',
      currentProcess: '人工逐条阅读并归类', mainProblem: '耗时且容易遗漏来源', occurrence: '每周', stability: '基本固定', audience: '产品与运营团队',
      originalExpectations: ['辅助归类并保留来源证据'], possibleSupport: ['归类与来源定位'], departments: ['产品与运营'], positions: ['产品经理'],
      responseCount: 4, coveredPeople: 5, employeeEvidence: [{ subjectType: 'employee_assessment', subjectId: 'employee-1', revision: 1, fieldPath: 'tasks.0.mainProblem', taskId: 'task-1', label: '主要问题', excerpt: '耗时且容易遗漏来源' }],
      positionEvidence: [{ subjectType: 'position_survey', subjectId: 'position-1', revision: 1, fieldPath: 'taskDemands.0.expectedAiSupport', taskId: 'task-1', label: '期望 AI 支持', excerpt: '辅助归类并保留来源证据' }],
      evidenceStatus: 'both_supported', completeness: 'complete', followUpQuestions: [],
      sources: [
        { subjectType: 'employee_assessment', subjectId: 'employee-1', revision: 1, title: '员工答卷', route: '/admin/employee-responses/employee-1' },
        { subjectType: 'position_survey', subjectId: 'position-1', revision: 1, title: '负责人答卷', route: '/admin/position-responses/position-1' },
      ],
      evidenceDimensions: [
        { dimension: 'task_context', employeeSourceCount: 1, employeeSourceTotal: 1, positionSourceCount: 1, positionSourceTotal: 1, relation: 'both_mentioned', employeeSummary: '每周整理访谈记录。', positionSummary: '岗位任务包含访谈记录整理。', employeeSourceIds: ['employee-1'], positionSourceIds: ['position-1'] },
        { dimension: 'main_problem', employeeSourceCount: 1, employeeSourceTotal: 1, positionSourceCount: 1, positionSourceTotal: 1, relation: 'direction_aligned', employeeSummary: '人工整理耗时且容易遗漏来源。', positionSummary: '负责人同样关注来源遗漏。', employeeSourceIds: ['employee-1'], positionSourceIds: ['position-1'] },
        { dimension: 'expected_support', employeeSourceCount: 1, employeeSourceTotal: 1, positionSourceCount: 1, positionSourceTotal: 1, relation: 'complementary', employeeSummary: '希望辅助归类。', positionSummary: '还需保留来源定位。', employeeSourceIds: ['employee-1'], positionSourceIds: ['position-1'] },
        { dimension: 'human_boundary', employeeSourceCount: 0, employeeSourceTotal: 1, positionSourceCount: 1, positionSourceTotal: 1, relation: 'employee_missing', employeeSummary: '', positionSummary: '关键事实需要人工确认。', employeeSourceIds: [], positionSourceIds: ['position-1'] },
        { dimension: 'system_data_conditions', employeeSourceCount: 0, employeeSourceTotal: 1, positionSourceCount: 0, positionSourceTotal: 1, relation: 'both_missing', employeeSummary: '', positionSummary: '', employeeSourceIds: [], positionSourceIds: [] },
      ],
    },
    {
      id: 'scenario-brief', title: '生成客户沟通摘要', capabilityTheme: '沟通准备', summary: '快速形成客户沟通材料。',
      currentProcess: '人工整理会议记录', mainProblem: '整理时间较长', occurrence: '每月', stability: '部分固定', audience: '销售团队',
      originalExpectations: ['生成摘要'], possibleSupport: ['摘要提取'], departments: ['业务团队'], positions: ['销售'], responseCount: 2, coveredPeople: 2,
      employeeEvidence: [{ subjectType: 'employee_assessment', subjectId: 'employee-2', revision: 1, fieldPath: 'tasks.0.expectedSupport', taskId: 'task-2', label: '期望支持', excerpt: '生成客户摘要' }], positionEvidence: [],
      evidenceStatus: 'employee_only', completeness: 'partial', followUpQuestions: ['确认固定的输出格式'],
      sources: [{ subjectType: 'employee_assessment', subjectId: 'employee-2', revision: 1, title: '销售员工答卷', route: '/admin/employee-responses/employee-2' }],
      evidenceDimensions: [
        { dimension: 'task_context', employeeSourceCount: 1, employeeSourceTotal: 1, positionSourceCount: 0, positionSourceTotal: 0, relation: 'insufficient_sample', employeeSummary: '生成客户沟通摘要。', positionSummary: '', employeeSourceIds: ['employee-2'], positionSourceIds: [] },
        { dimension: 'main_problem', employeeSourceCount: 1, employeeSourceTotal: 1, positionSourceCount: 0, positionSourceTotal: 0, relation: 'insufficient_sample', employeeSummary: '人工整理时间较长。', positionSummary: '', employeeSourceIds: ['employee-2'], positionSourceIds: [] },
        { dimension: 'expected_support', employeeSourceCount: 1, employeeSourceTotal: 1, positionSourceCount: 0, positionSourceTotal: 0, relation: 'insufficient_sample', employeeSummary: '希望生成摘要。', positionSummary: '', employeeSourceIds: ['employee-2'], positionSourceIds: [] },
        { dimension: 'human_boundary', employeeSourceCount: 0, employeeSourceTotal: 1, positionSourceCount: 0, positionSourceTotal: 0, relation: 'insufficient_sample', employeeSummary: '', positionSummary: '', employeeSourceIds: [], positionSourceIds: [] },
        { dimension: 'system_data_conditions', employeeSourceCount: 0, employeeSourceTotal: 1, positionSourceCount: 0, positionSourceTotal: 0, relation: 'insufficient_sample', employeeSummary: '', positionSummary: '', employeeSourceIds: [], positionSourceIds: [] },
      ],
    },
  ],
};

export const insufficientDashboardFixture: AdminDashboardDto = {
  ...adminDashboardFixture,
  sampleSufficient: false,
  validAnalysisSourceCount: 1,
  metrics: adminDashboardFixture.metrics.map((metric) => metric.label === '有效答卷' ? { ...metric, value: 1 } : metric),
};
