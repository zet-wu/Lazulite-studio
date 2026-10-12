import { expect, test } from '@playwright/test';
import { importLyrics } from '../fixtures/import-lyrics';
import { japaneseReadingTtml } from '../fixtures/japanese-reading';

test('multi-character ruby base stays horizontal below readings', async ({ page }) => {
  await page.goto('/projects/sample-project/edit?scenario=no-music');
  await importLyrics(page, { name: 'ruby.ttml', mimeType: 'application/xml', buffer: Buffer.from(japaneseReadingTtml) });
  await page.getByRole('button', { name: 'AMLL 预览', exact: true }).click();
  const body = page.getByRole('region', { name: 'AMLL 预览' }).locator('[class*="_wordBody"]').filter({ hasText: '学校' }).first();
  await expect(body).toBeVisible();
  await expect(body.locator(':scope > span')).toHaveCount(2);
  const boxes = await body.locator(':scope > span').evaluateAll(elements => elements.map(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; }));
  expect(boxes[1].x).toBeGreaterThan(boxes[0].x);
  expect(Math.abs(boxes[1].y - boxes[0].y)).toBeLessThan(2);
  const reading = await body.locator('..').locator('[class*="_rubyWord"]').boundingBox();
  expect(reading!.y).toBeLessThan(boxes[0].y);
});
