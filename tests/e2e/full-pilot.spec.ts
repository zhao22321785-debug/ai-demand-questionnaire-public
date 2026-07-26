import { expect, test } from '@playwright/test';

test('本地 mock 试点：管理员可见已隔离的只读总览', async ({ page }) => {
  await page.goto('/admin/login');
  await page.getByLabel('管理员邮箱').fill('pilot-admin@example.com');
  await page.getByLabel('密码').fill('local-only-password');
  await page.getByRole('button', { name: /进入管理端/ }).click();

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: '数据总览' })).toBeVisible();
  await expect(page.getByText(/只读/)).toBeVisible();
  await expect(page.getByText('有效答卷')).toBeVisible();
  await expect(page.getByRole('heading', { name: '当前没有可展示的需求场景' })).toBeVisible();
});
