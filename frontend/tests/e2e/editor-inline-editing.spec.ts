import { importLyrics } from '../fixtures/import-lyrics';
import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { inlineEditingTtml } from '../fixtures/inline-editing';

async function load(page: Page, xml = inlineEditingTtml()) {
  await page.goto('/projects/sample-project/edit?scenario=no-music');
  await importLyrics(page, { name: 'editor-inline-editing.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await expect(page.locator('main [data-line-id="english"]')).toBeVisible();
}
const row = (page: Page, id = 'english') => page.locator(`main section[data-line-id="${id}"]`);

test('注音 main-row right click preserves multi-selection and updates content/track coverage', async ({ page }) => {
  await load(page);
  const outline = page.locator('[data-outline-drag]');
  await outline.first().click(); await outline.last().click({ modifiers: ['Shift'] });
  await outline.first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '从音译生成 注音…' }).click();
  const dialog = page.getByRole('dialog', { name: '从音译生成 注音' });
  await expect(dialog).toContainText('生成 2 / 3 行');
  await expect(dialog.getByLabel('目标词')).toHaveCount(2);
  await expect(dialog.getByText('空单元', { exact: true })).toHaveCount(0);
  await dialog.getByLabel('字符输出').selectOption('roman');
  await dialog.getByLabel('音译轨道').selectOption({ label: '轨道 2 · ja' });
  await expect(dialog).toContainText('生成 1 / 3 行');
  await dialog.getByLabel('跳过生成', { exact: true }).check();
  await expect(dialog.getByRole('status')).toHaveText('所有单元均跳过，无需生成');
  await expect(dialog.getByRole('button', { name: '生成 注音', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await outline.nth(1).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '从音译生成 注音…' }).click();
  await expect(dialog).toContainText('生成 2 / 3 行');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await outline.last().click(); await outline.first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '从音译生成 注音…' }).click();
  await expect(dialog).toContainText('L1');
});

test('inline addition, native text selection, IME, cancellation and one history entry', async ({ page }) => {
  await load(page);
  const line = row(page), add = line.getByRole('button', { name: '添加词', exact: true });
  await add.click(); let input = line.getByRole('textbox', { name: '添加词', exact: true });
  await expect(input).toBeFocused();
  await input.dispatchEvent('compositionstart'); await input.fill('新增'); await input.press('Enter');
  await expect(line.locator('[data-word-id]')).toHaveCount(7);
  await page.mouse.move(5, 5); await expect(input).toHaveValue('新增');
  await input.dispatchEvent('compositionend'); await input.press('Enter');
  await expect(line.getByRole('textbox', { name: '词 新增', exact: true })).toBeVisible();
  await expect(page.getByText('词已选 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(line.getByRole('textbox', { name: '词 新增', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeEnabled();
  await add.click(); input = line.getByRole('textbox', { name: '添加词', exact: true });
  await input.fill('cancel'); await input.press('Escape');
  await add.click(); input = line.getByRole('textbox', { name: '添加词', exact: true });
  await input.blur();
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeEnabled();
  const word = line.getByRole('textbox', { name: '词 still', exact: true });
  await word.click(); await word.press('ControlOrMeta+A');
  expect(await word.evaluate((e: HTMLInputElement) => e.selectionEnd! - e.selectionStart!)).toBe(5);
  await word.fill('always'); await word.press('Enter');
  await expect(line.getByRole('textbox', { name: '词 always', exact: true })).toBeVisible();
  await expect(page.locator('[data-drag-placeholder]')).toHaveCount(0);
  const content = line.locator('[data-romanization-content-id]').first();
  await content.getByRole('button', { name: '添加音译单元', exact: true }).click();
  await content.getByRole('textbox', { name: '添加音译单元', exact: true }).fill('new unit');
  await content.getByRole('textbox', { name: '添加音译单元', exact: true }).blur();
  await expect(content.getByLabel('音译单元 4', { exact: true })).toHaveValue('new unit');
  await expect(content.getByLabel('音译单元 4开始秒数')).toHaveValue('');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(content.locator('[data-romanization-unit-id]')).toHaveCount(3);
});

test('translation languages, trash, clear, background and singer mixed editing preserve history', async ({ page }) => {
  await load(page);
  const line = row(page);
  await page.locator('[data-top-menu=lyrics-settings] summary').click();
  await page.getByRole('button', { name: '管理翻译轨道…' }).click();
  const manager = page.getByRole('dialog', { name: '翻译轨道管理' });
  await manager.getByLabel('翻译轨道 1语言').fill('en_MS'); await manager.getByRole('button', { name: '应用', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '语言标签格式无效' })).toBeVisible();
  await manager.getByLabel('翻译轨道 1语言').fill('ja'); await manager.getByRole('button', { name: '应用', exact: true }).click();
  await line.getByRole('button', { name: '删除翻译', exact: true }).first().click();
  await expect(line.getByLabel('翻译 1', { exact: true })).toHaveValue('译文');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(line.getByLabel('翻译 1', { exact: true })).toHaveValue('song');
  const candidate = row(page, 'empty');
  await candidate.getByLabel('翻译 1', { exact: true }).fill(''); await candidate.getByLabel('翻译 1', { exact: true }).press('Enter');
  await page.locator('[data-outline-drag]').last().click(); await page.getByLabel('背景歌词', { exact: true }).check();
  await expect(page.getByLabel('所属主行')).toHaveValue('cjk');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  const outline = page.locator('[data-outline-drag]'); await outline.first().click();
  await expect(page.getByLabel('歌手 主唱', { exact: true })).toBeChecked();
  await expect(page.getByLabel('歌手 另一歌手', { exact: true })).toBeChecked();
  await outline.nth(1).click({ modifiers: ['ControlOrMeta'] });
  await expect(page.getByLabel('歌手 主唱', { exact: true })).toHaveAttribute('aria-checked', 'mixed');
  await page.getByLabel('歌手 主唱', { exact: true }).check();
  await outline.nth(1).click();
  await expect(page.getByLabel('歌手 主唱', { exact: true })).toBeChecked();
  await expect(page.getByLabel('歌手 另一歌手', { exact: true })).toBeChecked();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByLabel('歌手 主唱', { exact: true })).not.toBeChecked();
});

test('AMLL receives real whitespace text nodes with visible word gaps', async ({ page }) => {
  await load(page);
  await page.getByRole('button', { name: 'AMLL 预览', exact: true }).click();
  const player = page.locator('.amll-lyric-player');
  await expect(player).toContainText('I still love you');
  const spaces = await player.evaluate(e => {
    const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); const result: { text: string; width: number }[] = [];
    while (walker.nextNode()) if (walker.currentNode.textContent === ' ') {
      const range = document.createRange(); range.selectNode(walker.currentNode);
      result.push({ text: walker.currentNode.textContent, width: range.getBoundingClientRect().width });
    }
    return result;
  });
  expect(spaces.filter(item => item.width > 0).length).toBeGreaterThanOrEqual(3);
  await page.screenshot({ path: test.info().outputPath('preview-spaces.png') });
  await page.getByRole('checkbox', { name: '音译', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: '翻译', exact: true }).uncheck();
  await expect(player).toContainText('I still love you');
  await writeFile(test.info().outputPath('preview-spaces.json'), JSON.stringify(spaces));
});

for (const theme of ['light', 'dark']) for (const width of [1280, 1440, 1920]) test(`selection surfaces ${theme} ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await load(page);
  await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
  const contents = row(page).locator('[data-romanization-content-id]');
  await contents.first().locator('strong').click(); await contents.nth(1).locator('strong').click({ modifiers: ['ControlOrMeta'] });
  const expected = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--blue-soft').trim());
  for (const content of [contents.first(), contents.nth(1)]) {
    await expect(content).toHaveClass(/selectedRomanization/);
    expect(await content.evaluate(e => getComputedStyle(e).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  }
  const unit = contents.first().locator('[data-romanization-unit-id]').first();
  await page.screenshot({ path: test.info().outputPath('content-selection.png') });
  await unit.click({ position: { x: 3, y: 3 } }); await expect(unit).toHaveClass(/selectedWord/);
  await unit.getByLabel('音译单元 1', { exact: true }).focus();
  await page.screenshot({ path: test.info().outputPath('unit-focus.png') });
  await page.keyboard.press('Tab'); await unit.focus(); expect(await unit.evaluate(e => getComputedStyle(e).outlineStyle)).toBe('solid');
  await expect(contents.first()).not.toHaveClass(/selectedRomanization/);
  const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(width);
  await writeFile(test.info().outputPath('geometry.json'), JSON.stringify({ ...geometry, expected }));
});

test('virtual input survives scrolling and remounts new untimed words without disabling bounded mounting', async ({ page }) => {
  test.setTimeout(60_000);
  const extra = Array.from({ length: 1997 }, (_, i) => `<p xml:id="extra${i}">行${i}</p>`).join('');
  await load(page, inlineEditingTtml().replace('</div></body>', extra + '</div></body>'));
  const line = row(page); await line.getByRole('button', { name: '添加词', exact: true }).click();
  const input = line.getByRole('textbox', { name: '添加词', exact: true }); await input.fill('保留草稿');
  const scroll = page.getByLabel('歌词列表', { exact: true }); await scroll.evaluate(e => e.scrollTop = e.scrollHeight);
  await expect(input).toHaveValue('保留草稿');
  expect(await page.locator('main [data-line-id]').count()).toBeLessThan(80);
  await input.press('Enter');
  await scroll.evaluate(e => e.scrollTop = 0);
  await expect(line.getByRole('textbox', { name: '词 保留草稿', exact: true })).toBeVisible();
  await expect(line.getByLabel('词 保留草稿开始秒数')).toHaveValue('');
  await scroll.evaluate(e => e.scrollTop = e.scrollHeight); await page.getByRole('button', { name: '撤销', exact: true }).click();
  await scroll.evaluate(e => e.scrollTop = 0); await expect(line.getByRole('textbox', { name: '词 保留草稿', exact: true })).toHaveCount(0);
});


test('western splitting and inline space-only words preserve independent whitespace through history and export', async ({ page }) => {
  await load(page); const line = row(page, 'cjk');
  const input = line.getByRole('textbox', { name: '词 中文 é', exact: true });
  await input.click(); await input.fill('I still love you'); await input.press('Enter');
  await line.locator('[data-word-id]').first().click({ button: 'right', position: { x: 3, y: 3 } });
  await page.getByRole('menuitem', { name: '拆分词', exact: true }).click();
  await expect(line.locator('[data-word-id]')).toHaveCount(7);
  expect(await line.locator('[data-word-id] > div[class*="wordMain"] input').evaluateAll(nodes => nodes.map(node => (node as HTMLInputElement).value))).toEqual(['I', ' ', 'still', ' ', 'love', ' ', 'you']);
  await line.getByRole('button', { name: '添加词', exact: true }).click();
  await line.getByRole('textbox', { name: '添加词', exact: true }).fill('  '); await line.getByRole('textbox', { name: '添加词', exact: true }).press('Enter');
  await expect(line.locator('[data-word-id]')).toHaveCount(8);
  await expect(line.locator('[data-word-id]').last().locator('[class*="wordMain"] input')).toHaveValue('  ');
  await page.getByRole('button', { name: '文件打包', exact: true }).click(); const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载歌词', exact: true }).click();
  const xml = await (await import('node:fs/promises')).readFile(await (await download).path(), 'utf8');
  expect(xml).toContain('  '); expect(xml).not.toContain('studio:');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(line.locator('[data-word-id]')).toHaveCount(7);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(line.locator('[data-word-id]')).toHaveCount(1);
});
