import { expect, test } from '@playwright/test';

test('survey and admin entry points stay separate', async ({ page }) => {
  await page.goto('/survey/login');
  await expect(page.getByRole('heading', { name: '继续填写需求调研' })).toBeVisible();
  await expect(page.getByText('管理员登录')).toHaveCount(0);

  await page.goto('/admin/login');
  await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible();
  await expect(page.getByText('创建账号')).toHaveCount(0);
});
