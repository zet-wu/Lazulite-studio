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
  await page.getByRole('button', { name: '歌词获取', exact: true }).click();
  await page.getByRole('heading', { name: '歌词获取', exact: true }).evaluate(e => {
    const range = document.createRange(); range.selectNodeContents(e);
    getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
  });
  await page.keyboard.press('Control+c');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('歌词获取');
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

test('cross-line ruby paste into a word clears timing and one undo restores the empty reading', async ({ page }) => {
  const { continuousBoundariesTtml } = await import('../fixtures/continuous-boundaries');
  const xml = continuousBoundariesTtml.replace('</div></body>', '<p xml:id="destination" begin="8" end="9"><span begin="8" end="9">丁</span></p></div></body>');
  await page.goto('/projects/sample-project/edit?scenario=no-music');
  await importLyrics(page, { name: 'ruby-paste.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await page.locator('main [data-ruby-id]').first().click({ position: { x: 3, y: 3 } });
  await page.keyboard.press('Control+c');
  const destination = page.locator('main [data-line-id="destination"]');
  await destination.locator('[data-word-id]').click({ position: { x: 3, y: 3 } });
  await page.keyboard.press('Control+v');
  await expect(destination.locator('[data-ruby-id]')).toHaveCount(1);
  await expect(destination.getByRole('textbox', { name: '读音 丁', exact: true })).toHaveValue('こう');
  for (const input of await destination.locator('[data-ruby-id] input').all()) {
    if ((await input.getAttribute('aria-label')) !== '读音 丁') await expect(input).toHaveValue('');
  }
  await page.locator('[data-outline-drag]').nth(1).click();
  await expect(page.getByLabel('行 2开始秒数', { exact: true })).toHaveValue('8');
  await expect(page.getByLabel('行 2结束秒数', { exact: true })).toHaveValue('9');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(destination.locator('[data-ruby-id]')).toHaveCount(0);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(destination.locator('[data-ruby-id]')).toHaveCount(1);
});
