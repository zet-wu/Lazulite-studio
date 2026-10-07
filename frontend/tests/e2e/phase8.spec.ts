import { importLyrics } from '../fixtures/import-lyrics';
import { expect, test, type Page } from '@playwright/test';
import { phase7Ttml } from '../fixtures/phase7';
import { phase6Ttml } from '../fixtures/phase6';
export async function load(page: Page, xml = phase7Ttml) {
  await page.goto('/projects/sample-project/edit?scenario=no-music');
  await importLyrics(page, { name: 'phase8.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
}
async function edge(page: Page, selector: string, index: number, options: { button?: 'right'; modifiers?: ('Shift' | 'Control' | 'Meta')[] } = {}) {
  await page.locator(selector).nth(index).click({ position: { x: 3, y: 3 }, ...options });
}
test('P8 real 注音 range, passive right focus, batch delete and one undo', async ({ page }) => {
  await load(page);
  await edge(page, '[data-ruby-id]', 0); await edge(page, '[data-ruby-id]', 1, { modifiers: ['Shift'] });
  await expect(page.getByText('注音已选 2', { exact: true })).toBeVisible();
  await page.getByLabel('读音 学校', { exact: true }).nth(1).click({ button: 'right' });
  await expect(page.getByText('注音已选 2', { exact: true })).toBeVisible();
  await edge(page, '[data-ruby-id]', 0, { button: 'right' });
  await page.getByRole('menuitem', { name: '删除所选读音（2）' }).click();
  await expect(page.locator('[data-ruby-id]')).toHaveCount(2);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(page.locator('[data-ruby-id]')).toHaveCount(4);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeEnabled();
});
test('P8 cross-line word range, right-click outside and clipboard remains after direct deletion', async ({ page }) => {
  await load(page);
  const words = page.locator('main [data-word-id]');
  await words.nth(1).getByLabel('词 しん', { exact: true }).click();
  await page.locator('[data-top-menu="clipboard"] summary').click(); await page.getByRole('button', { name: '复制', exact: true }).click();
  await edge(page, 'main [data-word-id]', 0); await edge(page, 'main [data-word-id]', 1, { modifiers: ['Shift'] });
  await expect(page.getByText('词已选 2', { exact: true })).toBeVisible();
  await page.getByLabel('词 しん', { exact: true }).click({ button: 'right' }); await expect(page.getByText('词已选 2', { exact: true })).toBeVisible();
  await edge(page, 'main [data-word-id]', 0, { button: 'right' });
  await page.getByRole('menuitem', { name: '删除所选词（2）' }).click(); await expect(words).toHaveCount(2);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(words).toHaveCount(4);
  await edge(page, 'main [data-word-id]', 3, { button: 'right' }); await page.getByRole('menuitem', { name: '粘贴', exact: true }).click();
  await expect(page.getByLabel('词 しん', { exact: true })).toHaveCount(2);
  await page.locator('[data-top-menu="clipboard"] summary').click(); await page.getByRole('button', { name: '清空选择', exact: true }).click();
  await page.locator('[data-top-menu="clipboard"] summary').click(); await expect(page.getByRole('button', { name: '删除', exact: true })).toBeDisabled();
});
test('P8 Ctrl and Cmd toggle timed units and content delete preserves native typing', async ({ page }) => {
  await load(page, phase6Ttml());
  const units = 'main [data-line-id="english"] [data-romanization-unit-id]';
  await edge(page, units, 0); await edge(page, units, 1, { modifiers: ['Control'] });
  await expect(page.getByText('音译单元已选 2', { exact: true })).toBeVisible();
  await edge(page, units, 2, { modifiers: ['Meta'] }); await expect(page.getByText('音译单元已选 3', { exact: true })).toBeVisible();
  await edge(page, units, 1, { button: 'right' }); await page.getByRole('menuitem', { name: '删除所选单元（3）' }).click(); await expect(page.locator(units)).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(page.locator(units)).toHaveCount(3);
});
async function generate(page: Page) {
  await page.locator('[data-outline-drag]').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '生成日文罗马字音译…' }).click();
  return page.getByRole('dialog', { name: '生成日文罗马字音译', exact: true });
}
test('P8 mode regenerates once; unfocused and active edits, Escape and IME stay within proposal', async ({ page }) => {
  await load(page); const dialog = await generate(page);
  await dialog.getByLabel('输出', { exact: true }).selectOption('plain');
  const plain = dialog.getByLabel('L1音译', { exact: true }); await expect(plain).toHaveValue('ga k ko u');
  await plain.fill('manual'); await plain.press('Escape'); await expect(plain).toHaveValue('ga k ko u'); await expect(dialog).toBeVisible();
  await plain.dispatchEvent('compositionstart'); await plain.fill(' composing '); await plain.press('Enter'); await expect(plain).toBeFocused();
  const composingValue = await plain.inputValue(); await plain.press('Escape'); await expect(plain).toHaveValue(composingValue); await expect(dialog).toBeVisible();
  await plain.dispatchEvent('compositionend'); await plain.press('Enter');
  await dialog.getByLabel('输出', { exact: true }).selectOption('timed');
  const first = dialog.getByLabel('L1单元 1音译'); await expect(first).toHaveValue('ga ');
  await first.fill(' changed  '); await dialog.getByLabel('目标轨道').selectOption(''); await expect(first).toHaveValue(' changed  ');
  await dialog.getByLabel('输出', { exact: true }).selectOption('plain'); await expect(plain).toHaveValue('ga k ko u');
  await plain.fill('not blurred'); await dialog.getByRole('button', { name: '生成音译', exact: true }).click();
  await expect(page.getByLabel('音译 ja-Latn', { exact: true })).toHaveValue('not blurred');
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(page.getByLabel('音译 ja-Latn', { exact: true })).toHaveCount(0);
});
test('P8 placeholders and special fragments stay nonblocking; manual blank preserves a timed unit', async ({ page }) => {
  await load(page); await page.locator('[data-outline-drag]').last().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '生成日文罗马字音译…' }).click();
  const dialog = page.getByRole('dialog', { name: '生成日文罗马字音译', exact: true });
  await dialog.getByLabel('输出', { exact: true }).selectOption('timed'); const input = dialog.getByLabel('L3单元 1音译');
  await expect(input).toHaveValue(' '); expect(await input.evaluate(e => getComputedStyle(e).borderTopStyle)).toBe('dashed');
  await input.focus(); await input.blur(); expect(await input.evaluate(e => getComputedStyle(e).borderTopStyle)).toBe('dashed');
  await expect(dialog.getByRole('button', { name: '生成音译', exact: true })).toBeEnabled();
  await input.fill('kanji'); expect(await input.evaluate(e => getComputedStyle(e).borderTopStyle)).toBe('solid');
  await input.fill(''); await dialog.getByRole('button', { name: '生成音译', exact: true }).click();
  await expect(page.getByLabel('音译单元 1', { exact: true })).toHaveValue(' ');
  await expect(page.getByLabel('音译单元 1开始秒数')).toHaveValue('6'); await expect(page.getByLabel('音译单元 1结束秒数')).toHaveValue('8');
});
for (const width of [1280, 1440, 1920]) for (const theme of ['light', 'dark']) test(`P8 static proposal layout at ${width} ${theme}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.addInitScript(theme => localStorage.setItem('lazulite-editor-theme', theme), theme);
  await load(page); const dialog = await generate(page); await dialog.getByLabel('输出', { exact: true }).selectOption('timed');
  await expect(dialog.locator('[data-source-word]')).toHaveCount(1); await expect(dialog.getByRole('textbox')).toHaveCount(4);
  const input = dialog.getByLabel('L1单元 1音译'); await page.mouse.move(1, 1);
  const before = await input.boundingBox(); expect(await input.evaluate(e => getComputedStyle(e).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await input.focus(); await page.mouse.move(1, 1); expect(await input.evaluate(e => getComputedStyle(e).borderTopColor)).not.toBe('rgba(0, 0, 0, 0)');
  expect(await input.boundingBox()).toEqual(before);
  await input.fill('very long editable romanization '.repeat(20));
  const overflow = await dialog.evaluate(e => e.scrollWidth > e.clientWidth); expect(overflow).toBe(false);
  await input.blur(); await dialog.getByLabel('输出', { exact: true }).selectOption('plain');
  await dialog.getByLabel('输出', { exact: true }).selectOption('plain');
  const area = dialog.getByLabel('L1音译', { exact: true }), initial = (await area.boundingBox())!.height;
  expect((await area.boundingBox())!.width).toBeGreaterThan((await dialog.locator('[data-roman-proposal]').boundingBox())!.width * .9);
  await area.fill('very long ordinary romanization '.repeat(100)); expect((await area.boundingBox())!.height).toBeGreaterThan(initial * 2);
  expect(await area.evaluate(e => e.scrollHeight > e.clientHeight + 2)).toBe(false);
  await dialog.getByLabel('输出', { exact: true }).selectOption('timed'); await page.mouse.move(1, 1);
  await page.screenshot({ path: test.info().outputPath(`romanization-${width}-${theme}.png`) });
});
test('P8 lyric settings are unique in edit mode, menus dismiss and keyboard reaches all dialogs', async ({ page }) => {
  await load(page);
  await expect(page.locator('[data-top-menu="settings"]')).toHaveCount(1);
  const settings = page.locator('[data-top-menu="lyrics-settings"] summary');
  await settings.focus(); await settings.press('Enter'); await expect(settings).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: '歌词元数据', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '歌词元数据', exact: true })).toBeVisible(); await page.keyboard.press('Escape'); await expect(settings).toHaveAttribute('aria-expanded', 'false');
  for (const [entry, title] of [['歌手管理', '歌手管理'], ['管理音译轨道…', '音译轨道管理']]) {
    await settings.click(); await page.getByRole('button', { name: entry, exact: true }).click(); await expect(page.getByRole('dialog', { name: title, exact: true })).toBeVisible(); await page.keyboard.press('Escape');
  }
  await settings.click(); await page.locator('[data-top-menu="tools"] summary').click(); await expect(settings).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: '管理音译轨道…', exact: true })).toBeHidden();
  for (const mode of ['打轴', '预览']) {
    await page.getByRole('button', { name: mode, exact: true }).click(); await expect(settings).toHaveCount(0);
  }
  await page.getByRole('button', { name: '编辑', exact: true }).click(); await expect(settings).toHaveAttribute('aria-expanded', 'false');
});
test('P8 line and content ranges delete fully and restore with one undo', async ({ page }) => {
  await load(page, phase6Ttml());
  const content = 'main [data-line-id="english"] [data-romanization-content-id]';
  await edge(page, content, 0); await edge(page, content, 1, { modifiers: ['Shift'] });
  await expect(page.getByText('音译内容已选 2', { exact: true })).toBeVisible();
  await edge(page, content, 0, { button: 'right' }); await page.getByRole('menuitem', { name: '删除所选内容（2）' }).click(); await expect(page.locator(content)).toHaveCount(1);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(page.locator(content)).toHaveCount(3);
  const outline = page.locator('[data-outline-drag]'); await outline.first().click(); await outline.nth(1).click({ modifiers: ['Shift'] });
  await outline.first().click({ button: 'right' }); await page.getByRole('menuitem', { name: '删除所选行（2）' }).click(); await expect(outline).toHaveCount(1);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(outline).toHaveCount(3);
});
test('multi-row deletion preserves unrelated endpoints and restores rows on undo', async ({ page }) => {
  await page.goto('/projects/sample-project/edit?scenario=no-music');
  const xml = await page.evaluate(async xml => {
    const path = '/src/adapters/ttml/lyric-codec.ts'; const codec = await import(path) as typeof import('../../src/adapters/ttml/lyric-codec');
    const doc = codec.parseLyricTtml(xml); doc.lines[0].endMs = 6e3;
    return codec.serializeLyricTtml(doc, { draft: true });
  }, phase7Ttml);
  await importLyrics(page, { name: 'links.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  const outline = page.locator('[data-outline-drag]'); await outline.nth(1).click(); await outline.nth(2).click({ modifiers: ['Shift'] });
  await outline.nth(1).click({ button: 'right' }); await page.getByRole('menuitem', { name: '删除所选行（2）' }).click();
  await expect(outline).toHaveCount(1);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(outline).toHaveCount(3);
});

test('P8 merging timed fragments preserves generated separator spaces and native text keys', async ({ page }) => {
  await load(page); const dialog = await generate(page); await dialog.getByLabel('输出', { exact: true }).selectOption('timed');
  await dialog.getByRole('button', { name: '生成音译', exact: true }).click();
  await edge(page, 'main [data-romanization-unit-id]', 1, { button: 'right' }); await page.getByRole('menuitem', { name: '合并前一单元', exact: true }).click();
  const input = page.getByLabel('音译单元 1', { exact: true }); await expect(input).toHaveValue('ga k ');
  await expect(page.getByLabel('音译单元 1开始秒数')).toHaveValue('0'); await expect(page.getByLabel('音译单元 1结束秒数')).toHaveValue('2');
  await input.click(); await input.press('ControlOrMeta+A'); await input.press('Backspace'); await expect(input).toHaveValue('');
  await expect(page.locator('main [data-romanization-unit-id]')).toHaveCount(3);
  await input.press('Escape'); await expect(input).toHaveValue('ga k ');
});
