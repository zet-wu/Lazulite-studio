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

test('generates 注音 explicitly from one track and preserves source content on undo', async ({ page }) => {
  await importTtml(page, 'phase2-multitrack');
  const line = page.locator('main section[data-line-id="line-a"]');
  await expect(line.locator('[data-romanization-content-id]')).toHaveCount(3);
  await line.locator('[data-romanization-content-id]').first().getByText('音译 · ja-Latn').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '从音译生成 注音…' }).click();
  const dialog = page.getByRole('dialog', { name: '从音译生成 注音' });
  await expect(dialog).toContainText('fu');
  await expect(dialog).toContainText('0.999s');
  await expect(dialog.getByRole('button', { name: '生成 注音', exact: true })).toBeEnabled();
  await expect(dialog.getByLabel('确认同时扩展上述词/行时间')).toHaveCount(0);
  await dialog.getByRole('button', { name: '生成 注音', exact: true }).click();
  await expect(line.getByRole('textbox', { name: '读音 二人' })).toHaveCount(3);
  await expect(line.locator('[data-romanization-content-id]')).toHaveCount(3);
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(line.getByRole('textbox', { name: '读音 二人' })).toHaveCount(0);
  await expect(line.locator('[data-romanization-content-id]')).toHaveCount(3);
});

test('opens lyric metadata and singers in edit mode and keeps the auxiliary page', async ({ page }) => {
  await importTtml(page);
  await openMenu(page, '歌词设置');
  await page.getByRole('button', { name: '歌词元数据' }).click();
  await expect(page.getByRole('dialog', { name: '歌词元数据' })).toBeVisible();
  await page.getByRole('button', { name: '关闭元数据编辑' }).click();
  await openMenu(page, '歌词设置');
  await page.getByRole('button', { name: '歌手管理' }).click();
  await expect(page.getByRole('dialog', { name: '歌手管理' })).toBeVisible();
  await page.getByRole('button', { name: '关闭歌手管理' }).click();
  await page.getByRole('button', { name: '项目辅助' }).click();
  await expect(page.getByRole('heading', { name: '项目辅助' })).toBeVisible();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByLabel('歌词列表', { exact: true })).toBeVisible();
});

test('shows one lyric scroller at 80 and 81 lines without horizontal page overflow', async ({ page }) => {
  await page.goto('/projects/sample-project/edit?scenario=no-music');
  for (const count of [80, 81]) {
    const text = Array.from({ length: count }, (_, index) => `${index + 1} ${'长词'.repeat(24)}`).join('\n');
    await importLyrics(page, { name: `rows-${count}.txt`, mimeType: 'text/plain', buffer: Buffer.from(text) });
    await expect(page.locator('[data-outline-drag]')).toHaveCount(count);
    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 800 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    const scroller = page.getByLabel('歌词列表');
    await expect(scroller).toHaveCount(1);
    const before = await scroller.evaluate((element) => element.scrollTop);
    await scroller.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    expect(await scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(before);
  }
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

test('virtualizes 2000 lines and locates the last line from the outline', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/projects/sample-project/edit?scenario=no-music');
  const text = Array.from({ length: 2000 }, (_, index) => `词${index} ${'長'.repeat(index % 6)}`).join('\n');
  await importLyrics(page, { name: 'long.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
  await expect(page.locator('[data-outline-drag]')).toHaveCount(2000);
  expect(await page.locator('main section[data-line-id]').count()).toBeLessThan(80);
  await page.locator('[data-outline-drag]').last().click();
  await expect(page.getByRole('textbox', { name: '词 词1999 長', exact: true })).toBeVisible();
  expect(await page.locator('main section[data-line-id]').count()).toBeLessThan(80);
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
  await importTtml(page, 'phase2-multitrack');
  const line = page.locator('main section[data-line-id="line-a"]');
  const unit = line.locator('[data-romanization-content-id]').first().getByRole('textbox', { name: '音译单元 1', exact: true });
  await unit.fill('fuu ');
  await unit.blur();
  await expect(unit).toHaveValue('fuu ');
  await expect(line.getByRole('textbox', { name: '词 二人', exact: true })).toHaveValue('二人');
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(unit).toHaveValue('fu ');
});
