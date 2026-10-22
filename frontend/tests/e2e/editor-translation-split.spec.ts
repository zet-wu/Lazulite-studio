import { importLyrics } from '../fixtures/import-lyrics';
import { expect, test, type Page } from '@playwright/test';
import { inlineEditingTtml } from '../fixtures/inline-editing';
import { japaneseReadingTtml as xml } from '../fixtures/japanese-reading';
async function load(page: Page, text = xml) {
  await page.goto('/projects/sample-project/edit?scenario=no-music');
  await importLyrics(page, { name: 'editor-translation-split.ttml', mimeType: 'application/xml', buffer: Buffer.from(text) });
}
test('range selection reaches the generation dialog and applies to selected lines', async ({ page }) => {
  await load(page);
  const outline = page.locator('[data-outline-drag]'); await expect(outline).toHaveCount(3);
  await outline.first().click(); await outline.last().click({ modifiers: ['Shift'] }); await outline.nth(1).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '生成日文罗马字音译' }).click();
  const dialog = page.getByRole('dialog', { name: '生成日文罗马字音译', exact: true });
  await expect(dialog).toContainText('生成 2 / 3 行');
  await dialog.getByRole('button', { name: '生成音译', exact: true }).click();
  await expect(page.getByLabel('音译单元 1', { exact: true })).toHaveCount(2);
});
test('split cancellation discards draft and translation target selection reaches apply', async ({ page }) => {
  await load(page, inlineEditingTtml());
  const outline = page.locator('[data-outline-drag]'); await outline.first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '拆分行' }).click();
  const dialog = page.getByRole('dialog', { name: '拆分歌词行', exact: true });
  await dialog.getByRole('button', { name: '在第 2 词前切分' }).click();
  await expect(dialog.getByLabel('拆分结果').locator('section')).toHaveCount(2);
  await dialog.getByLabel('翻译 2归属').selectOption({ label: '第 2 行' });
  await expect(dialog.getByLabel('拆分结果').locator('section').last()).toContainText('译文');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(outline).toHaveCount(3);
  await outline.first().click({ button: 'right' }); await page.getByRole('menuitem', { name: '拆分行' }).click();
  await dialog.getByRole('button', { name: '在第 2 词前切分' }).click();
  await dialog.getByLabel('翻译 2归属').selectOption({ label: '第 2 行' }); await dialog.getByRole('button', { name: '应用', exact: true }).click();
  await expect(outline).toHaveCount(4);
  const rows = page.locator('main section[data-line-id]');
  await expect(rows.nth(1).getByLabel('翻译 1', { exact: true })).toHaveValue('译文');
});
