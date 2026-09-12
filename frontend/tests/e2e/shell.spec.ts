import { expect, test, type Page } from '@playwright/test';

function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('searches, opens a project, selects a line, and switches compact panels', async ({ page }) => {
  const errors = pageErrors(page);
  await page.goto('/projects');
  await page.getByPlaceholder('搜索项目').fill('星の手紙');
  await page.getByRole('link', { name: /星の手紙/ }).click();
  await expect(page.getByRole('option').first()).toBeVisible();
  await page.getByRole('option').first().press('ArrowDown');
  await expect(page.getByRole('listbox').locator('[role="option"][aria-selected="true"] input')).toHaveValue('遠い星を見上げて');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '属性', exact: true }).click();
  await expect(page.getByText('审核', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '歌词', exact: true }).click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await expect(page.getByRole('listbox').locator('[role="option"][aria-selected="true"] input')).toHaveValue('遠い星を見上げて');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('shows empty, error, expired, and loading states and can recover', async ({ page }) => {
  const errors = pageErrors(page);
  await page.goto('/projects?scenario=empty');
  await expect(page.getByText('还没有项目', { exact: true })).toBeVisible();

  await page.goto('/projects?scenario=error');
  await expect(page.getByText('项目暂时不可用', { exact: true })).toBeVisible();
  const retryResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/projects') && response.request().method() === 'GET');
  await page.getByRole('button', { name: '重试', exact: true }).click();
  expect((await retryResponse).status()).toBe(503);
  await expect(page.getByText('项目暂时不可用', { exact: true })).toBeVisible();

  await page.goto('/projects?scenario=expired');
  await expect(page.getByRole('heading', { name: '登录 Lazulite Studio' })).toBeVisible();
  await page.getByRole('button', { name: '返回模拟工作台', exact: true }).click();
  await expect(page.getByPlaceholder('搜索项目')).toBeVisible();

  await page.goto('/projects?scenario=loading');
  await expect(page.getByText('正在检查会话…', { exact: true })).toBeVisible();
  await page.goto('/projects');
  await expect(page.getByPlaceholder('搜索项目')).toBeVisible();
  expect(errors).toEqual([]);
});

test('keeps deep edit navigation, task tabs, settings, and export state usable', async ({ page }) => {
  const errors = pageErrors(page);
  await page.goto('/projects/sample-project/edit?line=line-4');
  await expect(page.getByRole('heading', { name: '歌词行表' })).toBeVisible();
  await expect(page.getByRole('listbox').locator('[role="option"][aria-selected="true"] input')).toHaveValue('小さな願いを抱いて');
  await expect(page.getByText('审核', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '任务', exact: true }).click();
  await expect(page.getByRole('region', { name: '自动化任务' }).locator('strong').filter({ hasText: '行对齐' })).toBeVisible({ timeout: 10_000 });

  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();
  await expect(page.getByText('document.edit', { exact: true })).toBeVisible();

  await page.goto('/projects/sample-project/export');
  await expect(page.getByRole('heading', { name: '导出 TTML' })).toBeVisible();
  await expect(page.getByRole('button', { name: '准备导出', exact: true })).toBeEnabled();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '准备导出', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('sample-project.ttml');
  expect(errors).toEqual([]);
});
