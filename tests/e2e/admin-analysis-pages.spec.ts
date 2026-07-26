import { expect, test } from '@playwright/test';
import type { AnalysisRecord, PositionAnalysisResult } from '../../src/types/analysis';
import type { PositionResponseRecord } from '../../src/types/survey';

async function signInAsAdmin(page: import('@playwright/test').Page) {
  await page.goto('/admin/login');
  await page.getByLabel('管理员邮箱').fill('admin-analysis@example.com');
  await page.getByLabel('密码').fill('M3-demo-pass!');
  await page.getByRole('button', { name: /进入管理端/ }).click();
  await expect(page.getByRole('heading', { name: '数据总览' })).toBeVisible();
}

test('管理分析端保持只读，并支持直接打开需求分析 URL', async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto('/admin/demands?selected=missing&tab=evidence');
  await expect(page.getByRole('heading', { name: '需求分析' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '选择一条需求查看初步分析' })).toBeVisible();
  await expect(page.getByRole('button', { name: /编辑|保存|评分|审批|立项/ })).toHaveCount(0);
  await page.goto('/admin/differences');
  await expect(page.getByRole('heading', { name: '证据对比' })).toBeVisible();
  await expect(page.getByText(/镜像条只表示来源覆盖/)).toBeVisible();
});

function populatedMockState() {
  const responses: PositionResponseRecord[] = [];
  const analyses: AnalysisRecord[] = [];
  for (let index = 1; index <= 3; index += 1) {
    const subjectId = `position-response-${index}`;
    const taskId = `position-task-${index}`;
    const workItemId = `work-item-${index}`;
    const now = '2026-07-24T03:00:00.000Z';
    responses.push({
      id: subjectId, userId: 'mock-user', batchId: 'batch-m1', revision: 1, analysisStatus: 'complete', submittedAt: now, updatedAt: now,
      type: 'position', positionKey: 'std:product-manager',
      input: {
        batchId: 'batch-m1', surveyVersionId: 'survey-v1', researcherName: `负责人 ${index}`, departmentId: 'product', positionId: 'product-manager',
        positionName: '产品经理', relatedPositionExperience: '3_5',
        workItems: [{ id: workItemId, name: '需求调研', description: '收集并梳理业务需求', selectedForImprovement: true }, { id: `backup-${index}`, name: '方案评审', description: '组织方案评审', selectedForImprovement: false }],
        taskDemands: [{ id: taskId, workItemId, task: '整理访谈记录', commonInput: '访谈笔记与业务材料', hasFixedInput: true, output: '结构化需求清单', hasFixedOutput: true, currentProcess: '人工逐条阅读并归类', mainProblem: '耗时且容易遗漏来源', occurrence: 'weekly', stability: 'partly_fixed', audience: 'same_position', aiParticipation: 'assist', expectedAiSupport: '辅助归类并保留来源证据', resultUsage: 'human_review', humanReviewContent: '关键事实与来源', requiresCollaboration: false, collaborationDepartments: [], collaborationPositions: [] }],
      },
    });
    const result: PositionAnalysisResult = {
      kind: 'position', subjectId, revision: 1, summary: '形成一个可继续核对的岗位任务线索。', departments: ['产品与运营'], positions: ['产品经理'],
      workSummary: ['需求调研：收集并梳理业务需求'], capabilityThemes: ['材料整理与结构化模板'], boundariesToAssess: ['关键事实需要人工确认'], disclaimer: '初步分析，不代表立项或优先级。',
      scenarios: [{
        id: `scenario-${index}`, title: '整理访谈记录', audience: 'same_position', taskSummary: '整理访谈记录', currentProcess: '人工逐条阅读并归类', mainProblem: '耗时且容易遗漏来源', occurrence: 'weekly', stability: 'partly_fixed', originalExpectation: '辅助归类并保留来源证据', supportForms: ['材料整理与结构化模板'], attentionReason: '任务、问题和期望均有来源。', completeness: 'complete', missingInformation: ['真实样本'], followUpQuestions: ['如何验收结果？'], commonInput: '访谈笔记与业务材料', expectedOutput: '结构化需求清单', humanBoundary: '关键事实与来源需人工确认', collaboration: '未提出跨部门协作条件', capabilityTheme: '材料整理与结构化模板',
        evidence: [{ subjectType: 'position_survey', subjectId, revision: 1, fieldPath: `tasks.${taskId}.mainProblem`, taskId, label: '主要问题', excerpt: '耗时且容易遗漏来源' }],
      }],
    };
    analyses.push({ id: `analysis-${index}`, subjectType: 'position_survey', subjectId, revision: 1, status: 'complete', result, attemptCount: 1, modelKey: 'deterministic-mock', promptVersion: 'single-v1', createdAt: now, updatedAt: now });
  }
  return { profile: null, responses, analyses };
}

test('充足 mock 样本下 D1、D2、D3 可见联动并保留来源', async ({ page }, testInfo) => {
  await page.addInitScript((state) => window.localStorage.setItem('ai-demand-questionnaire:m1', JSON.stringify(state)), populatedMockState());
  await signInAsAdmin(page);
  const demand = page.getByRole('link', { name: /整理访谈记录/ });
  await expect(demand).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('d1-overview.png'), fullPage: true });
  await demand.click();
  await expect(page).toHaveURL(/\/admin\/demands\?selected=/);
  await expect(page.getByRole('heading', { name: '整理访谈记录' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Agent 初步分析' })).toBeVisible();
  await expect(page.locator('.admin-analysis-path li')).toHaveCount(5);
  await page.getByRole('tab', { name: '原始答卷' }).click();
  await expect(page.getByRole('link', { name: /整理访谈记录/ })).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath('d2-demand.png'), fullPage: true });
  await page.goto('/admin/differences');
  await expect(page.getByRole('heading', { name: '证据对比' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '选择具体需求' })).toBeVisible();
  await expect(page.getByRole('button', { name: /整理访谈记录/ }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('d3-differences.png'), fullPage: true });
});

test('D1、D2、D3 在各视口无页面级横向溢出，D3 选择同步 URL', async ({ page }, testInfo) => {
  await page.addInitScript((state) => window.localStorage.setItem('ai-demand-questionnaire:m1', JSON.stringify(state)), populatedMockState());
  await signInAsAdmin(page);
  for (const route of ['/admin', '/admin/demands', '/admin/differences']) {
    await page.goto(route);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  }
  const demandButtons = page.getByRole('button', { name: /整理访谈记录/ });
  await expect(demandButtons.first()).toBeVisible();
  await demandButtons.last().click();
  await expect(page).toHaveURL(/\/admin\/differences\?selected=/);
  if (await page.locator('.admin-mirror-panel').count()) {
    await expect(page.locator('.admin-mirror-panel article')).toHaveCount(5);
  } else {
    await expect(page.getByRole('heading', { name: '结构化证据正在补充' })).toBeVisible();
  }
  await page.screenshot({ path: testInfo.outputPath(`d3-layout-${testInfo.project.name}.png`), fullPage: true });
});
