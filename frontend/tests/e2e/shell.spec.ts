import { expect, test } from '@playwright/test';

test('opens a project, selects a line and keeps edit navigation visible', async ({ page }) => {
  await page.goto('/projects');
  await page.getByPlaceholder('搜索项目').fill('星の手紙');
  await page.getByRole('link', { name: /星の手紙/ }).click();
  await page.locator('[data-outline-drag]').nth(1).click();
  await expect(page.getByText('已选行：L2')).toBeVisible();
  await expect(page.getByLabel('歌词列表', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '歌词获取' }).click();
  await expect(page.getByRole('heading', { name: '歌词获取' })).toBeVisible();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByLabel('歌词列表', { exact: true })).toBeVisible();
});

test('keeps one A/B snapshot and five layers while collapsing the timeline', async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  const layers = page.getByLabel('时间轴图层');
  await page.getByRole('button', { name: '循环当前行' }).click();
  await expect(page.getByRole('slider', { name: '循环 A 边界' })).toHaveAttribute('aria-valuenow', '0');
  await expect(page.getByRole('slider', { name: '循环 B 边界' })).toHaveAttribute('aria-valuenow', '5');
  await page.locator('[data-outline-drag]').nth(1).click();
  await expect(page.getByRole('slider', { name: '循环 B 边界' })).toHaveAttribute('aria-valuenow', '5');
  await layers.getByRole('button', { name: '声谱图' }).click();
  await expect(layers.getByRole('button', { name: '声谱图' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '收起' }).click();
  await expect(page.getByRole('button', { name: '展开时间轴' })).toBeVisible();
  await page.getByRole('button', { name: '展开时间轴' }).click();
  await expect(layers.getByRole('button', { name: '声谱图' })).toHaveAttribute('aria-pressed', 'true');
});

test('drags an A/B boundary without adding lyric undo history', async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  await page.getByRole('button', { name: '循环当前行' }).click();
  const boundary = page.getByRole('slider', { name: '循环 B 边界' });
  const box = (await boundary.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 25, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(Number(await boundary.getAttribute('aria-valuenow'))).toBeGreaterThan(5);
  await expect(page.getByRole('button', { name: '撤销' })).toBeDisabled();
});

test('keeps the sync cursor separate from lyric undo', async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  await page.locator('[data-outline-drag]').first().click();
  await page.getByRole('button', { name: '打轴', exact: true }).click();
  const panel = page.getByRole('region', { name: '连续打轴' });
  await expect(panel.getByText('L1 · 单元 1 / 1')).toBeVisible();
  await panel.getByRole('button', { name: '起始轴' }).click();
  await panel.getByRole('button', { name: '连续轴' }).click();
  await expect(panel.getByText('L2 · 单元 1 / 1')).toBeVisible();
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(panel.getByText('L2 · 单元 1 / 1')).toBeVisible();
});
