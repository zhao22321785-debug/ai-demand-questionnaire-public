import { PositionAnalysisInputSchema } from '../../src/types/analysis';
import { buildPositionAnalysisInput } from '../../src/lib/analysis/input-builders';
import type { PositionResponseRecord, ReferenceData } from '../../src/types/survey';

it('normalizes position collaboration fields into the strict analysis contract', () => {
  const workItemId = crypto.randomUUID();
  const record: PositionResponseRecord = {
    id: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    batchId: crypto.randomUUID(),
    revision: 1,
    analysisStatus: 'pending',
    submittedAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
    type: 'position',
    positionKey: 'standard:product-manager',
    input: {
      batchId: crypto.randomUUID(),
      surveyVersionId: crypto.randomUUID(),
      researcherName: '负责人',
      departmentId: 'product',
      positionId: 'product-manager',
      positionName: '产品经理',
      relatedPositionExperience: '3_5',
      workItems: [{ id: workItemId, name: '需求调研', description: '梳理业务需求', selectedForImprovement: true }],
      taskDemands: [{
        id: crypto.randomUUID(),
        workItemId,
        task: '整理访谈记录',
        commonInput: '访谈笔记',
        hasFixedInput: true,
        output: '需求清单',
        hasFixedOutput: true,
        currentProcess: '人工整理',
        mainProblem: '容易遗漏来源',
        occurrence: 'weekly',
        stability: 'partly_fixed',
        audience: 'same_position',
        aiParticipation: 'assist',
        expectedAiSupport: '辅助归类',
        resultUsage: 'human_review',
        humanReviewContent: '核对事实',
        requiresCollaboration: true,
        collaborationDepartments: ['技术研发'],
        collaborationPositions: ['研发工程师'],
        handoffContent: '需求说明',
        collaborationProblem: '交接信息不完整',
        collaborationAiSupport: '生成交接清单',
      }],
    },
  };
  const reference: ReferenceData = {
    activeBatch: {
      id: record.batchId,
      name: '预发布批次',
      surveyVersionId: record.input.surveyVersionId,
      employeeSurveyVersionId: crypto.randomUUID(),
      positionSurveyVersionId: record.input.surveyVersionId,
    },
    departments: [{ id: 'product', code: 'product', label: '产品与运营' }],
    positions: [{ id: 'product-manager', code: 'product-manager', label: '产品经理' }],
    aiTools: [],
  };

  const input = PositionAnalysisInputSchema.parse(buildPositionAnalysisInput(record, reference));

  expect(input.tasks[0].collaboration).toEqual([
    '技术研发',
    '研发工程师',
    '需求说明',
    '交接信息不完整',
    '生成交接清单',
  ]);
  expect(input.tasks[0]).not.toHaveProperty('requiresCollaboration');
  expect(input.tasks[0]).not.toHaveProperty('collaborationDepartments');
  expect(input.tasks[0]).not.toHaveProperty('collaborationPositions');
});
