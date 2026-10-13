import { importLyrics } from '../fixtures/import-lyrics';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function importTtml(page: Page, name = 'reference-apple-metadata') {
  await page.goto('/projects/sample-project/edit?scenario=no-music');
  const source = await readFile(`../tests/fixtures/ttml/${name}.ttml`);
  await importLyrics(page, { name: `${name}.ttml`, mimeType: 'application/xml', buffer: source });
}

async function openMenu(page: Page, title: string) {
  if (title === '文件') { await page.getByRole('button', { name: '文件打包', exact: true }).click(); return; }
  const summary = page.locator('summary').filter({ hasText: title }).first();
  if (await summary.locator('..').getAttribute('open') === null) await summary.click();
}

test('edits and exports a rich local draft with canvas undo and redo', async ({ page }) => {
  await importTtml(page);
  const word = page.getByRole('textbox', { name: '词 今日', exact: true });
  await word.dblclick();
  await word.fill('今日改');
  await word.blur();
  const line = page.locator('main section[data-line-id="L1"]');
  await line.focus();
  await page.keyboard.press('ControlOrMeta+Z');
  await expect(page.getByRole('textbox', { name: '词 今日', exact: true })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Shift+Z');
  await expect(page.getByRole('textbox', { name: '词 今日改', exact: true })).toBeVisible();
  await openMenu(page, '歌词设置');
  await page.getByRole('button', { name: '歌手管理', exact: true }).click();
  await page.getByLabel('歌手 v1 type').selectOption('person');
  await page.getByLabel('歌手 v2 type').selectOption('person');
  await page.getByRole('button', { name: '关闭歌手管理' }).click();
  await openMenu(page, '文件');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载歌词' }).click();
  const xml = await readFile(await (await download).path(), 'utf8');
  expect(xml).toContain('今日改');
  expect(xml).toContain('きょ');
  expect(xml).toContain('今天 也唱歌');
});

test('restores a local project checkpoint without persisting the undo stack', async ({ page }) => {
  await importTtml(page);
  const word = page.getByRole('textbox', { name: '词 今日', exact: true });
  await word.dblclick();
  await word.fill('检查点文字');
  await word.blur();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('已保存')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByRole('textbox', { name: '词 检查点文字', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '撤销' })).toBeDisabled();
});

test('moves a word through its context menu and by direct mouse drag', async ({ page }) => {
  await importTtml(page);
  const line = page.locator('main section[data-line-id="L1"]');
  const words = line.locator('[data-word-id]');
  await words.first().click({ button: 'right', position: { x: 2, y: 2 } });
  await expect(page.getByRole('menu', { name: '词操作' })).toBeVisible();
  await page.getByRole('menuitem', { name: '词后移' }).click();
  await expect(words.first().getByRole('textbox', { name: '词  も歌う', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(words.first().getByRole('textbox', { name: '词 今日', exact: true })).toBeVisible();
  const targetBox = (await words.nth(1).boundingBox())!;
  await words.first().dragTo(words.nth(1), { sourcePosition: { x: 2, y: 2 }, targetPosition: { x: targetBox.width - 2, y: 2 } });
  await expect(words.first().getByRole('textbox', { name: '词  も歌う', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(words.first().getByRole('textbox', { name: '词 今日', exact: true })).toBeVisible();
});

test('selects and reorders 注音 independently of its base word', async ({ page }) => {
  await importTtml(page);
  const word = page.locator('main section[data-line-id="L1"] [data-word-id]').first();
  const rubies = word.locator('[data-ruby-id]');
  await rubies.first().click();
  await expect(page.getByText('注音已选 1')).toBeVisible();
  await rubies.first().click({ button: 'right', position: { x: 2, y: 2 } });
  await page.getByRole('menuitem', { name: '向后移动' }).click();
  await expect(rubies.first().getByRole('textbox', { name: '读音 今日', exact: true })).toHaveValue('う');
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(rubies.first().getByRole('textbox', { name: '读音 今日', exact: true })).toHaveValue('きょ');
});

test('edits a transliteration unit without changing the main word', async ({ page }) => {
  await importTtml(page, 'multitrack');
  const line = page.locator('main section[data-line-id="line-a"]');
  const unit = line.locator('[data-romanization-content-id]').first().getByRole('textbox', { name: '音译单元 1', exact: true });
  await unit.fill('fuu ');
  await unit.blur();
  await expect(unit).toHaveValue('fuu ');
  await expect(line.getByRole('textbox', { name: '词 二人', exact: true })).toHaveValue('二人');
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(unit).toHaveValue('fu ');
});
