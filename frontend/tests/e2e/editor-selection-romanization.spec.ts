import { importLyrics } from '../fixtures/import-lyrics';
import { expect, test, type Page } from '@playwright/test';
import { japaneseReadingTtml } from '../fixtures/japanese-reading';
import { inlineEditingTtml } from '../fixtures/inline-editing';
export async function load(page: Page, xml = japaneseReadingTtml) {
  await page.goto('/projects/sample-project/edit?scenario=no-music');
  await importLyrics(page, { name: 'editor-selection-romanization.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
}
async function edge(page: Page, selector: string, index: number, options: { button?: 'right'; modifiers?: ('Shift' | 'Control' | 'Meta')[] } = {}) {
  await page.locator(selector).nth(index).click({ position: { x: 3, y: 3 }, ...options });
}
test('real 注音 range, passive right focus, batch delete and one undo', async ({ page }) => {
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
test('cross-line word range, right-click outside and clipboard remains after direct deletion', async ({ page }) => {
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
test('Ctrl and Cmd toggle timed units and content delete preserves native typing', async ({ page }) => {
  await load(page, inlineEditingTtml());
  const units = 'main [data-line-id="english"] [data-romanization-unit-id]';
  await edge(page, units, 0); await edge(page, units, 1, { modifiers: ['Control'] });
  await expect(page.getByText('音译单元已选 2', { exact: true })).toBeVisible();
  await edge(page, units, 2, { modifiers: ['Meta'] }); await expect(page.getByText('音译单元已选 3', { exact: true })).toBeVisible();
  await edge(page, units, 1, { button: 'right' }); await page.getByRole('menuitem', { name: '删除所选单元（3）' }).click(); await expect(page.locator(units)).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(page.locator(units)).toHaveCount(3);
});
async function generate(page: Page) {
  await page.locator('[data-outline-drag]').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '生成日文罗马字音译' }).click();
  return page.getByRole('dialog', { name: '生成日文罗马字音译', exact: true });
}
test('active edits, Escape and IME stay within proposal', async ({ page }) => {
  await load(page); const dialog = await generate(page);
  await dialog.getByLabel('输出', { exact: true }).selectOption('plain');
  const plain = dialog.getByLabel('L1音译', { exact: true }); const original = await plain.inputValue();
  await plain.fill('manual'); await plain.press('Escape'); await expect(plain).toHaveValue(original); await expect(dialog).toBeVisible();
  await plain.dispatchEvent('compositionstart'); await plain.fill(' composing '); await plain.press('Enter'); await expect(plain).toBeFocused();
  const composingValue = await plain.inputValue(); await plain.press('Escape'); await expect(plain).toHaveValue(composingValue); await expect(dialog).toBeVisible();
  await plain.dispatchEvent('compositionend'); await plain.press('Enter');
  await plain.fill('not blurred'); await dialog.getByRole('button', { name: '生成音译', exact: true }).click();
  await expect(page.getByLabel('音译 ja-Latn', { exact: true })).toHaveValue('not blurred');
});
test('lyric settings menu dismisses and keyboard opens dialogs', async ({ page }) => {
  await load(page);
  const settings = page.locator('[data-top-menu="lyrics-settings"] summary');
  await settings.focus(); await settings.press('Enter'); await expect(settings).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: '歌词元数据', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '歌词元数据', exact: true })).toBeVisible(); await page.keyboard.press('Escape'); await expect(settings).toHaveAttribute('aria-expanded', 'false');
  for (const [entry, title] of [['歌手管理', '歌手管理'], ['管理音译轨道', '音译轨道管理']]) {
    await settings.click(); await page.getByRole('button', { name: entry, exact: true }).click(); await expect(page.getByRole('dialog', { name: title, exact: true })).toBeVisible(); await page.keyboard.press('Escape');
  }
  await settings.click(); await page.locator('[data-top-menu="tools"] summary').click(); await expect(settings).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: '管理音译轨道', exact: true })).toBeHidden();
  await page.getByRole('button', { name: '编辑', exact: true }).click(); await expect(settings).toHaveAttribute('aria-expanded', 'false');
});
test('line and content ranges delete fully and restore with one undo', async ({ page }) => {
  await load(page, inlineEditingTtml());
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
  }, japaneseReadingTtml);
  await importLyrics(page, { name: 'links.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  const outline = page.locator('[data-outline-drag]'); await outline.nth(1).click(); await outline.nth(2).click({ modifiers: ['Shift'] });
  await outline.nth(1).click({ button: 'right' }); await page.getByRole('menuitem', { name: '删除所选行（2）' }).click();
  await expect(outline).toHaveCount(1);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(outline).toHaveCount(3);
});

test('merging timed fragments preserves generated separator spaces and native text keys', async ({ page }) => {
  await load(page); const dialog = await generate(page); await dialog.getByLabel('输出', { exact: true }).selectOption('timed');
  await dialog.getByRole('button', { name: '生成音译', exact: true }).click();
  await edge(page, 'main [data-romanization-unit-id]', 0); await edge(page, 'main [data-romanization-unit-id]', 1, { modifiers: ['Shift'] }); await edge(page, 'main [data-romanization-unit-id]', 1, { button: 'right' }); await page.getByRole('menuitem', { name: '合并所选', exact: true }).click();
  const input = page.getByLabel('音译单元 1', { exact: true }); await expect(input).toHaveValue('ga k ');
  await expect(page.getByLabel('音译单元 1开始秒数')).toHaveValue('0'); await expect(page.getByLabel('音译单元 1结束秒数')).toHaveValue('2');
  await input.click(); await input.press('ControlOrMeta+A'); await input.press('Backspace'); await expect(input).toHaveValue('');
  await expect(page.locator('main [data-romanization-unit-id]')).toHaveCount(3);
  await input.press('Escape'); await expect(input).toHaveValue('ga k ');
});
