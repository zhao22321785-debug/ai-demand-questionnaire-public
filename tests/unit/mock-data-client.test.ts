import { createMockDataClient } from '../../src/lib/data';
import type { EmployeeSurveyInput, PositionSurveyInput } from '../../src/types/survey';

const employeeInput: EmployeeSurveyInput = {
  batchId: 'batch-m1', surveyVersionId: 'survey-v1',
  profile: { name: '测试员工', departmentId: 'product', positionId: 'product-manager', currentPositionExperience: '1_3' },
  aiUseStatus: 'never', nonUseReasons: ['不清楚可以从哪些工作开始'], discontinuationReasons: [], aiToolIds: [], aiScenarios: [], painPoints: [],
  hasExplicitDemand: false, tasks: [], dimensions: [3, null, null, null, null, null],
};

function positionInput(positionId = 'product-manager', positionName = '产品经理'): PositionSurveyInput {
  const workItemId = crypto.randomUUID();
  return {
    batchId: 'batch-m1', surveyVersionId: 'survey-v1', researcherName: '测试负责人', departmentId: 'product', positionId,
    positionName, relatedPositionExperience: '3_5',
    workItems: [
      { id: workItemId, name: '需求调研', description: '收集业务需求', selectedForImprovement: true },
      { id: crypto.randomUUID(), name: '方案评审', description: '组织方案评审', selectedForImprovement: false },
    ],
    taskDemands: [{ id: crypto.randomUUID(), workItemId, task: '整理访谈记录', commonInput: '访谈记录', hasFixedInput: true, output: '需求摘要', hasFixedOutput: true, currentProcess: '人工整理', mainProblem: '耗时', occurrence: 'weekly', stability: 'partly_fixed', audience: 'same_position', aiParticipation: 'assist', expectedAiSupport: '归纳主题', resultUsage: 'human_review', humanReviewContent: '关键事实', requiresCollaboration: false, collaborationDepartments: [], collaborationPositions: [] }],
  };
}

beforeEach(() => window.localStorage.clear());

it('updates the same employee response and increments its revision', async () => {
  const client = createMockDataClient();
  const first = await client.saveEmployeeSurvey(employeeInput);
  const second = await client.saveEmployeeSurvey({ ...employeeInput, painPoints: ['重复操作多'] });
  expect(second.id).toBe(first.id);
  expect(second.revision).toBe(2);
  expect(await client.listMyResponses()).toHaveLength(1);
  const analysis = await client.getAnalysis('employee_assessment', second.id);
  expect(analysis?.status).toBe('complete');
  expect(analysis?.revision).toBe(2);
});

it('keeps position responses separate by position key', async () => {
  const client = createMockDataClient();
  await client.savePositionSurvey(positionInput());
  await client.savePositionSurvey(positionInput('operations', '运营'));
  expect(await client.listPositionResponses()).toHaveLength(2);
});

it('rejects contradictory employee task AI status in mock mode', async () => {
  const contradictory: EmployeeSurveyInput = {
    ...employeeInput,
    hasExplicitDemand: true,
    tasks: [{
      id: crypto.randomUUID(), title: '整理材料', currentProcess: '人工整理', mainProblem: '耗时',
      occurrence: 'unknown', stability: 'unknown', audience: 'unknown', aiUseStatus: 'using', aiFollowUp: '使用摘要工具', expectedSupport: '辅助归类',
    }],
  };
  await expect(createMockDataClient().saveEmployeeSurvey(contradictory)).rejects.toThrow(/never/);
});

it('rejects stale AI tool details in a never-use mock submission', async () => {
  await expect(createMockDataClient().saveEmployeeSurvey({
    ...employeeInput,
    aiToolOther: '旧工具名称',
  })).rejects.toThrow(/不能包含工具/);
});

it('accepts explicit unknown employee task facts', async () => {
  const input: EmployeeSurveyInput = {
    ...employeeInput,
    aiUseStatus: 'sometimes',
    nonUseReasons: [],
    aiToolIds: ['chatgpt'],
    aiScenarios: ['整理资料'],
    hasExplicitDemand: true,
    dimensions: [3, 3, 3, 3, 3, 3],
    tasks: [{
      id: crypto.randomUUID(), title: '整理材料', currentProcess: '人工整理', mainProblem: '耗时',
      occurrence: 'unknown', stability: 'unknown', audience: 'unknown', aiUseStatus: 'never', expectedSupport: '辅助归类',
    }],
  };
  const saved = await createMockDataClient().saveEmployeeSurvey(input);
  expect(saved.revision).toBe(1);
});

it('increments the same canonical position response revision', async () => {
  const client = createMockDataClient();
  const first = await client.savePositionSurvey(positionInput());
  const second = await client.savePositionSurvey(positionInput());
  expect(second.id).toBe(first.id);
  expect(second.revision).toBe(2);
});
