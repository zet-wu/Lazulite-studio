import { importLyrics } from '../fixtures/import-lyrics';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function openFileMenu(page: Page) {
  await page.getByRole('button', { name: '文件打包', exact: true }).click();
}

test('opens a project, selects a line and keeps edit navigation visible', async ({ page }) => {
  await page.goto('/projects');
  await page.getByPlaceholder('搜索项目').fill('星の手紙');
  await page.getByRole('link', { name: /星の手紙/ }).click();
  await page.locator('[data-outline-drag]').nth(1).click();
  await expect(page.getByText('已选行：L2')).toBeVisible();
  await expect(page.getByLabel('歌词列表', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '项目辅助' }).click();
  await expect(page.getByRole('heading', { name: '项目辅助' })).toBeVisible();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByLabel('歌词列表', { exact: true })).toBeVisible();
});

test('keeps one A/B snapshot and five layers while collapsing the timeline', async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  const layers = page.getByLabel('时间轴图层');
  for (const name of ['行', '词', 'Ruby', '空隙']) await expect(layers.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(layers.getByRole('button', { name: '声谱图' })).toHaveAttribute('aria-pressed', 'false');
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

test('zooms a long waveform and leaves the editor responsive', async ({ page }) => {
  await page.goto('/projects/sample-project/edit?scenario=long');
  await expect(page.getByRole('slider', { name: '波形进度' })).toHaveAttribute('aria-valuemax', '1800');
  for (let index = 0; index < 7; index++) await page.getByRole('button', { name: '放大波形' }).click();
  await expect(page.getByRole('button', { name: '时间轴行 L1' })).toBeVisible();
  await page.getByRole('button', { name: '后移窗口' }).click();
  await page.getByRole('button', { name: '前移窗口' }).click();
  await expect(page.getByLabel('歌词列表', { exact: true })).toBeVisible();
});

test('saves a semantic project edit and reopens the saved revision', async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  const word = page.getByRole('textbox', { name: '词 夜の風が静かに吹く', exact: true });
  await word.dblclick();
  await word.fill('夜の風が静かに歌う');
  await word.blur();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('link', { name: 'Lazulite Studio' }).click();
  await page.getByRole('link', { name: /星の手紙/ }).click();
  await expect(page.getByRole('textbox', { name: '词 夜の風が静かに歌う', exact: true })).toBeVisible();
});

test('imports rich TTML, saves Ruby and reopens it from the project route', async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  const source = await readFile('../tests/fixtures/ttml/reference-apple-metadata.ttml');
  await importLyrics(page, { name: 'reference.ttml', mimeType: 'application/ttml+xml', buffer: source });
  const ruby = page.getByRole('textbox', { name: '读音 今日', exact: true }).first();
  await ruby.dblclick();
  await ruby.fill('きよう');
  await ruby.blur();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('link', { name: 'Lazulite Studio' }).click();
  await page.getByRole('link', { name: /星の手紙/ }).click();
  await expect(page.getByRole('textbox', { name: '读音 今日', exact: true }).first()).toHaveValue('きよう');
  await expect(page.getByRole('textbox', { name: '翻译 1', exact: true })).toHaveValue('今天 也唱歌');
  await openFileMenu(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载草稿' }).click();
  expect(await readFile(await (await download).path(), 'utf8')).toContain('きよう');
});

test('previews the current lyrics and returns to editing', async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await expect(page.getByRole('region', { name: '动态歌词预览' })).toBeVisible();
  await expect(page.getByText('夜の風が静かに吹く').first()).toBeVisible();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByLabel('歌词列表', { exact: true })).toBeVisible();
});

test('keeps the sync cursor separate from lyric undo', async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  await page.getByRole('button', { name: '打轴', exact: true }).click();
  const panel = page.getByRole('region', { name: '连续打轴' });
  await expect(panel.getByText('打轴 1/6')).toBeVisible();
  await panel.getByRole('button', { name: '起始轴' }).click();
  await panel.getByRole('button', { name: '连续轴' }).click();
  await expect(panel.getByText('打轴 2/6')).toBeVisible();
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(panel.getByText('打轴 2/6')).toBeVisible();
});

test('moves a timed word on the timeline and undoes the move', async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  const start = page.getByRole('textbox', { name: '词 夜の風が静かに吹く开始秒数' });
  const end = page.getByRole('textbox', { name: '词 夜の風が静かに吹く结束秒数' });
  await start.fill('0'); await start.blur();
  await end.fill('5'); await end.blur();
  for (let index = 0; index < 3; index++) await page.getByRole('button', { name: '放大波形' }).click();
  const bar = page.getByRole('button', { name: '时间轴词 夜の風が静かに吹く' });
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(start).not.toHaveValue('0');
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(start).toHaveValue('0');
});
