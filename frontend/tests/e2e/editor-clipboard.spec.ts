import { expect, test, type Page } from '@playwright/test';
import { importLyrics } from '../fixtures/import-lyrics';
import { japaneseReadingTtml } from '../fixtures/japanese-reading';
async function load(page: Page) {
  await page.goto('/projects/sample-project/edit?scenario=no-music');
  await importLyrics(page, { name: 'clipboard.ttml', mimeType: 'application/xml', buffer: Buffer.from(japaneseReadingTtml) });
}
test('page text copy and cut preserve lyrics; hidden object selection cannot paste', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await load(page);
  await page.locator('[data-outline-drag]').first().click();
  const count = await page.locator('[data-outline-drag]').count();
  await page.getByRole('button', { name: '项目辅助', exact: true }).click();
  await page.getByRole('heading', { name: '项目辅助' }).evaluate(e => {
    const range = document.createRange(); range.selectNodeContents(e);
    getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
  });
  await page.keyboard.press('Control+c');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('项目辅助');
  await page.keyboard.press('Control+x');
  await page.evaluate(() => getSelection()!.removeAllRanges());
  await page.keyboard.press('Control+v');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.locator('[data-outline-drag]')).toHaveCount(count);
  const input = page.getByLabel('词 しん', { exact: true });
  await input.fill('native'); await input.press('Control+a'); await input.press('Control+c');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('native');
});
test('object multi-cut is one undo; repeated keyboard undo and redo from outline and canvas', async ({ page }) => {
  await load(page);
  const rows = page.locator('[data-outline-drag]');
  const count = await rows.count();
  for (let attempt = 0; attempt < 4; attempt++) {
    await rows.nth(0).click(); await rows.nth(1).click({ modifiers: ['Shift'] });
    await page.keyboard.press('Control+x');
    await expect(rows).toHaveCount(count - 2);
    await page.keyboard.press('Control+z'); await expect(rows).toHaveCount(count);
    await rows.first().focus();
    await page.keyboard.press('Control+Shift+z'); await expect(rows).toHaveCount(count - 2);
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeEnabled();
    await page.keyboard.press('Control+z'); await expect(rows).toHaveCount(count);
  }
});
