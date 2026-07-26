import { expect, test, type Page } from '@playwright/test';

const password = 'M1-demo-pass!';

async function chooseRadio(page: Page, name: string | RegExp): Promise<void> {
  const radio = page.getByRole('radio', { name });
  await radio.locator('..').click();
  await expect(radio).toBeChecked();
}

async function expectSessionControlsClear(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  const meta = await page.locator('.survey-page__meta').boundingBox();
  const controls = await page.locator('.session-controls').boundingBox();
  expect(meta).not.toBeNull();
  expect(controls).not.toBeNull();
  if (viewport && viewport.width <= 767) {
    const header = await page.locator('.survey-page__header').boundingBox();
    expect(header).not.toBeNull();
    expect((controls?.y ?? 0) + (controls?.height ?? 0)).toBeLessThanOrEqual(header?.y ?? 0);
    return;
  }
  expect((meta?.x ?? 0) + (meta?.width ?? 0)).toBeLessThanOrEqual(controls?.x ?? 0);
}

async function expectAdminControlsClear(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport || viewport.width > 1023) return;
  const navigation = await page.locator('.admin-nav nav').boundingBox();
  const controls = await page.locator('.session-controls--admin').boundingBox();
  expect(navigation).not.toBeNull();
  expect(controls).not.toBeNull();
  expect((navigation?.x ?? 0) + (navigation?.width ?? 0)).toBeLessThanOrEqual(controls?.x ?? 0);
}

async function expectQuestionActionsNearBody(page: Page): Promise<void> {
  const body = await page.locator('.question-step__body').boundingBox();
  const actions = await page.locator('.question-step__actions').boundingBox();
  expect(body).not.toBeNull();
  expect(actions).not.toBeNull();
  const verticalGap = (actions?.y ?? 0) - ((body?.y ?? 0) + (body?.height ?? 0));
  expect(verticalGap).toBeGreaterThanOrEqual(0);
  expect(verticalGap).toBeLessThanOrEqual(96);
}

async function registerAndSaveProfile(page: Page): Promise<void> {
  await page.goto('/survey/register');
  await page.getByLabel('邮箱').fill('employee@example.com');
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByLabel('确认密码').fill(password);
  await page.getByRole('button', { name: /创建账号/ }).click();

  await expect(page.getByRole('heading', { name: '先确认您的岗位背景' })).toBeVisible();
  await page.getByLabel('姓名').fill('测试员工');
  await page.getByLabel('所属部门').selectOption({ label: '技术研发' });
  await page.getByLabel('岗位名称').selectOption({ label: '研发工程师' });
  await page.getByLabel('当前岗位经验').selectOption('3_5');
  await page.getByRole('button', { name: /保存并继续/ }).click();
  await expect(page.getByRole('heading', { name: '您准备从哪个视角提供信息？' })).toBeVisible();
}

async function fillEmployeeSurvey(page: Page): Promise<void> {
  await page.getByRole('link', { name: /普通员工/ }).click();
  await expectQuestionActionsNearBody(page);

  await chooseRadio(page, '还没有使用过');
  await page.getByRole('button', { name: '下一题' }).click();
  await page.getByRole('checkbox', { name: '暂时没有发现适合的工作' }).check();
  await page.getByRole('button', { name: '下一题' }).click();
  await page.getByRole('button', { name: '下一题' }).click();
  await chooseRadio(page, /暂时没有明确想改善的工作/);
  await page.getByRole('button', { name: '下一题' }).click();
  const dimension = page.locator('input[name="dimension-0"]').nth(2);
  await dimension.locator('..').click();
  await expect(dimension).toBeChecked();
  await page.getByRole('button', { name: '保存答卷' }).click();

  await expect(page.getByRole('heading', { name: '本次没有提交明确想改善的工作' })).toBeVisible();
  await expect(page.getByText('第 1 版', { exact: true })).toBeVisible();
  await expect(page.locator('.analysis-view').getByRole('heading', { name: '个人需求分析' })).toBeVisible();
  await expect(page.locator('.analysis-view').getByRole('heading', { name: '本次没有明确需求' })).toBeVisible();
  await expect(page.getByRole('button', { name: '查看原始回答' })).toBeVisible();
}

async function reviseEmployeeSurvey(page: Page): Promise<void> {
  await page.getByRole('link', { name: '修改答卷' }).click();
  await page.getByRole('button', { name: '下一题' }).click();
  await page.getByRole('button', { name: '下一题' }).click();
  await page.getByRole('button', { name: '下一题' }).click();
  await page.getByRole('button', { name: '下一题' }).click();
  await page.getByRole('button', { name: '保存答卷' }).click();
  await expect(page.getByText('第 2 版', { exact: true })).toBeVisible();
}

async function fillPositionSurvey(page: Page): Promise<void> {
  await page.goto('/survey/position');
  await expect(page.getByRole('heading', { name: '确认调研岗位' })).toBeVisible();
  await page.getByLabel('负责人姓名').fill('岗位负责人');
  await page.getByLabel('调研岗位名称').fill('产品经理');
  await page.getByLabel('岗位类别').selectOption({ label: '产品经理' });
  await page.getByLabel('所属部门').selectOption({ label: '产品与运营' });
  await page.getByLabel('了解该岗位的经验').selectOption('5_10');
  await page.getByRole('button', { name: '下一项' }).click();

  const workOne = page.getByRole('group', { name: '主要工作 1' });
  await workOne.getByLabel('工作名称').fill('需求调研');
  await workOne.getByLabel('工作说明').fill('收集并梳理真实业务需求');
  await workOne.getByRole('checkbox', { name: /希望优先改进/ }).check();
  const workTwo = page.getByRole('group', { name: '主要工作 2' });
  await workTwo.getByLabel('工作名称').fill('方案设计');
  await workTwo.getByLabel('工作说明').fill('形成可评审的产品方案');
  await page.getByRole('button', { name: '下一项' }).click();

  await page.getByRole('button', { name: '添加岗位共性任务' }).click();
  const task = page.getByRole('group', { name: '岗位共性任务 1' });
  await task.getByLabel('任务名称').fill('整理访谈记录');
  await task.getByLabel('常见输入').fill('访谈笔记与业务材料');
  await task.getByLabel('常见输出').fill('结构化需求清单');
  await task.getByLabel('当前做法').fill('人工逐条阅读并归类');
  await task.getByLabel('主要问题').fill('耗时且容易遗漏来源');
  await task.getByLabel('希望获得的具体支持').fill('辅助归类并保留来源证据');
  await page.getByRole('button', { name: '下一项' }).click();
  await page.getByRole('button', { name: '保存答卷' }).click();

  await expect(page.getByRole('heading', { name: '产品经理' })).toBeVisible();
  await expect(page.getByText('第 1 版', { exact: true })).toBeVisible();
  await expect(page.locator('.analysis-view').getByRole('heading', { name: '岗位需求分析' })).toBeVisible();
  await expect(page.locator('.analysis-view').getByRole('heading', { name: '整理访谈记录' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '原始回答' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '查看原始回答' })).toBeVisible();
}

async function revisePositionSurvey(page: Page): Promise<void> {
  await page.getByRole('link', { name: '修改答卷' }).click();
  await expect(page.getByRole('heading', { name: '确认调研岗位' })).toBeVisible();
  await expect(page.getByLabel('负责人姓名')).toHaveValue('岗位负责人');
  await page.getByRole('button', { name: '下一项' }).click();
  const referencedWork = page.getByRole('group', { name: '主要工作 1' }).getByRole('checkbox', { name: /希望优先改进/ });
  await referencedWork.click();
  await expect(page.getByText('这项主要工作已被岗位任务引用，请先调整任务关联。')).toBeVisible();
  await expect(referencedWork).toBeChecked();
  await page.getByRole('button', { name: '下一项' }).click();
  await page.getByRole('button', { name: '下一项' }).click();
  await page.getByRole('button', { name: '保存答卷' }).click();
  await expect(page.getByText('第 2 版', { exact: true })).toBeVisible();
}

test('M1 mock 主流程：注册、两类答卷、复盘修改和管理员只读查看', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await registerAndSaveProfile(page);
  await fillEmployeeSurvey(page);
  if (testInfo.project.name === 'mobile') {
    const returnPath = new URL(page.url()).pathname;
    const sessionControls = page.locator('.session-controls');
    await expect(sessionControls.getByRole('link', { name: '基本资料' })).toBeVisible();
    await expect(sessionControls.getByRole('link', { name: '我的答卷' })).toBeVisible();
    await expect(sessionControls.getByRole('button', { name: '退出登录' })).toBeVisible();
    await sessionControls.getByRole('link', { name: '基本资料' }).click();
    await expect(page.getByRole('heading', { name: '先确认您的岗位背景' })).toBeVisible();
    await page.getByRole('button', { name: /保存并继续/ }).click();
    await expect(page).toHaveURL(new RegExp(`${returnPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    await expect(page.locator('.analysis-view').getByRole('heading', { name: '个人需求分析' })).toBeVisible();
  }
  await expectSessionControlsClear(page);
  const viewport = page.viewportSize();
  if (testInfo.project.name === 'desktop' && viewport) {
    await page.setViewportSize({ width: 1182, height: viewport.height });
    try {
      await expectSessionControlsClear(page);
    } finally {
      await page.setViewportSize(viewport);
    }
  }
  await page.screenshot({ path: testInfo.outputPath('employee-review.png'), fullPage: true });
  await reviseEmployeeSurvey(page);
  await fillPositionSurvey(page);
  await expectSessionControlsClear(page);
  await page.screenshot({ path: testInfo.outputPath('position-review.png'), fullPage: true });
  await revisePositionSurvey(page);

  await page.goto('/survey/responses');
  await expect(page.getByRole('heading', { name: '员工需求调研' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '产品经理' })).toBeVisible();
  await expect(page.getByText('第 2 版', { exact: false })).toHaveCount(2);
  await page.getByRole('button', { name: '退出登录' }).click();

  await page.goto('/admin/login');
  await page.getByLabel('管理员邮箱').fill('admin@example.com');
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: /进入管理端/ }).click();
  await expect(page.getByRole('heading', { name: '数据总览' })).toBeVisible();
  const effectiveResponses = page.locator('.admin-metric').filter({ hasText: '有效答卷' });
  await expect(effectiveResponses.locator('strong')).toHaveText('2');
  await expectAdminControlsClear(page);
  await page.screenshot({ path: testInfo.outputPath('admin-overview.png'), fullPage: true });

  await page.goto('/admin/employee-responses');
  await expect(page.getByText('技术研发', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '查看详情' }).click();
  await expect(page.locator('.analysis-view').getByRole('heading', { name: '个人需求分析' })).toBeVisible();
  await page.getByRole('tab', { name: '原始答卷' }).click();
  await expect(page.getByText('AI 使用状态')).toBeVisible();
  await expect(page.locator('.admin-detail__content').getByText('否', { exact: true })).toBeVisible();
  await expect(page.getByText('暂时没有发现适合的工作', { exact: true })).toBeVisible();
  await expect(page.getByText(/维度 1：3/)).toBeVisible();

  await page.goto('/admin/position-responses');
  await expect(page.getByText('产品与运营', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '查看详情' }).click();
  await expect(page.locator('.analysis-view').getByRole('heading', { name: '岗位需求分析' })).toBeVisible();
  await page.getByRole('tab', { name: '原始答卷' }).click();
  await expect(page.locator('.admin-detail__content dd').filter({ hasText: '需求调研' })).toBeVisible();
  await expect(page.locator('.admin-detail__content').getByRole('heading', { name: '整理访谈记录' })).toBeVisible();
  await expect(page.getByText('访谈笔记与业务材料', { exact: true })).toBeVisible();
  await expect(page.getByText('辅助归类并保留来源证据', { exact: true })).toBeVisible();
});
