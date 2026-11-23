import { expect, test, type Page } from '@playwright/test';
import { importLyrics } from '../fixtures/import-lyrics';
import { performanceTtml } from '../fixtures/large-document';

async function display(page: Page, label: string) {
  const view = page.locator('[data-top-menu="view"]');
  await view.locator('summary').click();
  await view.getByRole('button', { name: label, exact: true }).click();
}
for (const count of [30, 80]) test(`advanced editor restores independent scroll memory and offscreen focus at ${count} lines`, async ({ page }, testInfo) => {
  await page.goto('/projects/sample-project/edit?scenario=no-music');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const began = Date.now();
  await importLyrics(page, { name: 'advanced.ttml', mimeType: 'application/xml', buffer: Buffer.from(performanceTtml(count)) });
  const rows = page.locator('main section[data-line-id]');
  await expect(rows.first()).toBeVisible();
  const mounted = await rows.count();
  expect(mounted).toBeLessThan(count);
  const scroller = page.getByLabel('歌词列表', { exact: true });
  await scroller.evaluate(el => { el.scrollTop = 900; });
  await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(800);
  // Clear selection so mode changes restore memory rather than locating an object.
  await page.locator('main').focus(); await page.keyboard.press('Escape');
  const advancedOffset = await scroller.evaluate(el => el.scrollTop);
  await display(page, '简洁模式');
  await scroller.evaluate(el => { el.scrollTop = 300; });
  await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBe(300);
  const switchBegan = Date.now();
  await display(page, '高级模式');
  await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBe(advancedOffset);
  const switchMs = Date.now() - switchBegan;
  await display(page, '简洁模式');
  await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBe(300);
  await display(page, '高级模式');
  await page.locator('[data-outline-drag]').nth(count - 1).click();
  const last = page.locator(`main section[data-line-id="p${count - 1}"]`);
  await expect(last).toBeInViewport();
  const input = last.locator('input[data-editor-field="word"]').first();
  await input.focus(); await input.fill('改'); await input.press('Enter');
  await expect(input).toHaveValue('改');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(input).toHaveValue('w0');
  await testInfo.attach('advanced-list-observation', { body: JSON.stringify({ lines: count, initiallyMounted: mounted, importAndScenarioMs: Date.now() - began, advancedReturnMs: switchMs, advancedOffset }), contentType: 'application/json' });
});
