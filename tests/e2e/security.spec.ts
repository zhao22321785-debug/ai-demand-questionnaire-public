import { expect, test } from '@playwright/test';

test('未登录访问受保护页面时回到对应入口，且两个入口不混用', async ({ page }) => {
  await page.goto('/survey/responses');
  await expect(page).toHaveURL(/\/survey\/login$/);
  await expect(page.getByRole('heading', { name: '继续填写需求调研' })).toBeVisible();
  await expect(page.getByText('管理员登录')).toHaveCount(0);

  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible();
  await expect(page.getByText('创建账号')).toHaveCount(0);
});

test('普通会话不能进入管理端', async ({ page }) => {
  await page.goto('/survey/login');
  await page.getByLabel('邮箱').fill('participant@example.com');
  await page.getByLabel('密码').fill('local-only-password');
  await page.getByRole('button', { name: /登录/ }).click();
  await expect(page.getByRole('heading', { name: '您准备从哪个视角提供信息？' })).toBeVisible();

  await page.goto('/admin');
  await expect(page).toHaveURL(/\/survey\/identity$/);
  await expect(page.getByRole('heading', { name: '您准备从哪个视角提供信息？' })).toBeVisible();
});
