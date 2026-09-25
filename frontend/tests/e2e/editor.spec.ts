import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const fixture = '../docs/evidence/editor-e0/reference-apple-metadata.ttml';
async function upload(page: import('@playwright/test').Page) {
  await page.goto('/editor');
  const source = await readFile(fixture);
  await page.locator('input[type="file"]').setInputFiles({ name: 'sample.ttml', mimeType: 'application/xml', buffer: source });
  await expect(page.getByRole('textbox', { name: '词 今日', exact: true })).toBeVisible();
}

test('imports, edits, undoes and downloads Ruby with background vocals', async ({ page }) => {
  await upload(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const word = page.getByRole('textbox', { name: '词 今日', exact: true });
  await word.fill('今日改');
  await word.blur();
  await expect(page.getByRole('textbox', { name: '词 今日改', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.getByRole('textbox', { name: '词 今日', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重做' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载草稿' }).click();
  const xml = await readFile(await (await download).path(), 'utf8');
  expect(xml).toContain('今日改');
  expect(xml).toContain('きょ');
  expect(xml).toContain('響く');
  expect(xml).toContain('今天 也唱歌');
});

test('saves the semantic checkpoint and restores undo history', async ({ page }) => {
  await upload(page);
  const word = page.getByRole('textbox', { name: '词 今日', exact: true });
  await word.fill('检查点文字');
  await word.blur();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('检查点已保存')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByText('恢复的草稿.ttml')).toBeVisible();
  await expect(page.getByRole('textbox', { name: '词 检查点文字', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.getByRole('textbox', { name: '词 今日', exact: true })).toBeVisible();
});

test('new local document clears the previous checkpoint', async ({ page }) => {
  await upload(page);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('检查点已保存')).toBeVisible();
  await page.getByRole('button', { name: '新建' }).click();
  await expect(page.getByText('未命名.ttml')).toBeVisible();
  let prompted = false;
  page.on('dialog', (dialog) => { prompted = true; void dialog.dismiss(); });
  await page.reload();
  await expect(page.getByText('未命名.ttml')).toBeVisible();
  expect(prompted).toBe(false);
});

test('reorders words and grouped background lines through buttons and keyboard with undo', async ({ page }) => {
  await upload(page);
  const firstLine = page.locator('[data-line-id="L1"]');
  await page.getByRole('textbox', { name: '词 今日', exact: true }).focus();
  await expect(firstLine.locator('[data-word-id]').first()).toHaveClass(/selectedWord/);
  await page.getByRole('button', { name: '词后移 今日' }).click();
  await expect(firstLine.locator('[data-word-id]').first().getByRole('textbox', { name: '词 も歌う', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(firstLine.locator('[data-word-id]').first().getByRole('textbox', { name: '词 今日', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '词 今日', exact: true }).press('Alt+ArrowRight');
  await expect(firstLine.locator('[data-word-id]').first().getByRole('textbox', { name: '词 も歌う', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /行下移.*今日/ }).click();
  await expect(page.locator('[data-line-id]').first()).toHaveAttribute('data-line-id', 'L2');
  await expect(page.locator('[data-line-id]').last()).toHaveAttribute('data-line-id', 'L1:bg');
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.locator('[data-line-id]').first()).toHaveAttribute('data-line-id', 'L1');
  await expect(firstLine.getByRole('textbox', { name: '读音 今日' }).first()).toHaveValue('きょ');
});

test('copies timed Ruby words and background line groups with one-step undo', async ({ page }) => {
  await upload(page);
  const firstLine = page.locator('[data-line-id="L1"]');
  await page.getByRole('textbox', { name: '词 今日', exact: true }).focus();
  await page.getByRole('button', { name: '复制', exact: true }).click();
  await page.getByRole('button', { name: '粘贴', exact: true }).click();
  await expect(firstLine.getByRole('textbox', { name: '词 今日', exact: true })).toHaveCount(2);
  await expect(firstLine.getByRole('textbox', { name: '读音 今日', exact: true })).toHaveCount(4);
  const ids = await firstLine.locator('[data-word-id]').evaluateAll((items) => items.map((item) => item.getAttribute('data-word-id')));
  expect(new Set(ids).size).toBe(ids.length);
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(firstLine.getByRole('textbox', { name: '词 今日', exact: true })).toHaveCount(1);

  await page.getByRole('button', { name: '1 今日 も歌う' }).click();
  await page.getByRole('button', { name: '复制', exact: true }).click();
  await page.getByRole('button', { name: '粘贴', exact: true }).click();
  await expect(page.locator('[data-line-id]')).toHaveCount(5);
  const copied = page.locator('[data-line-id]').nth(2);
  const copiedBackground = page.locator('[data-line-id]').nth(3);
  await expect(copied.getByRole('textbox', { name: '翻译 1' })).toHaveValue('今天 也唱歌');
  await expect(copiedBackground.getByRole('textbox', { name: '词 響く', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.locator('[data-line-id]')).toHaveCount(3);
});

test('selects a word range, cuts it once, and restores it with undo', async ({ page }) => {
  await upload(page);
  const firstLine = page.locator('[data-line-id="L1"]');
  await firstLine.getByRole('textbox', { name: '词 今日', exact: true }).focus();
  await firstLine.locator('[data-word-id]').nth(1).click({ modifiers: ['Shift'] });
  await expect(page.getByText('词已选 2')).toBeVisible();
  await page.getByRole('button', { name: '剪切', exact: true }).click();
  await expect(firstLine.locator('[data-word-id]')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(firstLine.locator('[data-word-id]')).toHaveCount(2);
  await page.getByRole('button', { name: '1 今日 も歌う' }).click();
  await page.getByRole('button', { name: '粘贴', exact: true }).click();
  await expect(firstLine.locator('[data-word-id]')).toHaveCount(4);
});

test('widens a destination line for a timed Ruby word moved across lines', async ({ page }) => {
  await upload(page);
  await page.getByRole('textbox', { name: '词 今日', exact: true }).focus();
  await page.getByRole('button', { name: '词移下行' }).click();
  const background = page.locator('[data-line-id="L1:bg"]');
  await expect(background.getByRole('textbox', { name: '词 今日', exact: true })).toBeVisible();
  await expect(background.getByRole('textbox', { name: '读音 今日', exact: true })).toHaveCount(2);
  await expect(page.getByRole('textbox', { name: '行 L1:bg开始秒数' })).toHaveValue('1');
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.locator('[data-line-id="L1"]').getByRole('textbox', { name: '词 今日', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '行 L1:bg开始秒数' })).toHaveValue('1.5');
});

test('drags words and grouped lines to reorder, and Ctrl-drag copies a word', async ({ page }) => {
  await upload(page);
  await page.setViewportSize({ width: 1440, height: 1400 });
  const firstLine = page.locator('[data-line-id="L1"]');
  await page.getByRole('button', { name: /拖动词 今日/ }).dragTo(firstLine.locator('[data-word-id]').nth(1));
  await expect(firstLine.locator('[data-word-id]').first().getByRole('textbox', { name: '词 も歌う', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(firstLine.locator('[data-word-id]').first().getByRole('textbox', { name: '词 今日', exact: true })).toBeVisible();

  await page.keyboard.down('Control');
  await page.getByRole('button', { name: /拖动词 今日/ }).dragTo(firstLine.locator('[data-word-id]').nth(1));
  await page.keyboard.up('Control');
  await expect(firstLine.locator('[data-word-id]')).toHaveCount(3);
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(firstLine.locator('[data-word-id]')).toHaveCount(2);

  await page.getByRole('button', { name: /拖动行 今日/ }).dragTo(page.locator('[data-line-id="L2"]'));
  await expect(page.locator('[data-line-id]').first()).toHaveAttribute('data-line-id', 'L2');
  await expect(page.locator('[data-line-id]').last()).toHaveAttribute('data-line-id', 'L1:bg');
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.locator('[data-line-id]').first()).toHaveAttribute('data-line-id', 'L1');
  await page.keyboard.down('Control');
  await page.getByRole('button', { name: /拖动行 今日/ }).dragTo(page.locator('[data-line-id="L2"]'));
  await page.keyboard.up('Control');
  await expect(page.locator('[data-line-id]')).toHaveCount(5);
  await expect(page.locator('[data-line-id]').last().getByRole('textbox', { name: '词 響く', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.locator('[data-line-id]')).toHaveCount(3);
});
