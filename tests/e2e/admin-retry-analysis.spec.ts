import { expect, test } from '@playwright/test';
import type { AnalysisRecord } from '../../src/types/analysis';
import type { EmployeeResponseRecord } from '../../src/types/survey';

const subjectId = '22222222-2222-4222-8222-222222222222';
const now = '2026-07-24T10:00:00.000Z';

function failedMockState() {
  const response: EmployeeResponseRecord = {
    id: subjectId,
    userId: 'mock-user',
    batchId: 'batch-m1',
    revision: 2,
    analysisStatus: 'failed',
    submittedAt: now,
    updatedAt: now,
    type: 'employee',
    input: {
      batchId: 'batch-m1',
      surveyVersionId: 'survey-v1',
      profile: {
        name: '重试验证员工',
        departmentId: 'product',
        positionId: 'product-manager',
        currentPositionExperience: '1_3',
      },
      aiUseStatus: 'never',
      nonUseReasons: ['暂时没有合适工具'],
      discontinuationReasons: [],
      aiToolIds: [],
      aiScenarios: [],
      painPoints: [],
      hasExplicitDemand: false,
      tasks: [],
      dimensions: [3, null, null, null, null, null],
    },
  };
  const analysis: AnalysisRecord = {
    id: 'analysis-failed',
    subjectType: 'employee_assessment',
    subjectId,
    revision: 2,
    status: 'failed',
    result: null,
    attemptCount: 3,
    errorCode: 'MODEL_TIMEOUT',
    errorSummary: '模型请求超时',
    promptVersion: 'single-v1',
    createdAt: now,
    updatedAt: now,
  };
  return { profile: null, responses: [response], analyses: [analysis] };
}

test('管理员可在失败的当前版本详情发起重新分析并看到受理和刷新结果', async ({ page }) => {
  await page.addInitScript((state) => {
    window.localStorage.setItem('ai-demand-questionnaire:m1', JSON.stringify(state));
  }, failedMockState());
  await page.goto('/admin/login');
  await page.getByLabel('管理员邮箱').fill('admin-retry@example.com');
  await page.getByLabel('密码').fill('local-only-password');
  await page.getByRole('button', { name: /进入管理端/ }).click();

  await page.goto(`/admin/employee-responses/${subjectId}`);
  await expect(page.getByRole('heading', { name: '分析暂未完成' })).toBeVisible();
  await expect(page.getByText('失败代码：MODEL_TIMEOUT')).toBeVisible();
  await page.getByRole('button', { name: '重新分析' }).click();

  await expect(page.getByRole('heading', { name: '重新分析已受理' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '分析已更新' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新分析' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /编辑|保存|审批/ })).toHaveCount(0);
});
