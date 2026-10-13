import { importLyrics } from '../fixtures/import-lyrics';
import { expect, test } from '@playwright/test';
import { performanceTtml } from '../fixtures/large-document';

test('UI production pointer preview with 2000 rich rows remains bounded', async ({ page }) => {
  await page.goto('/projects/no-music/edit');
  await importLyrics(page, { name: 'large.ttml', mimeType: 'application/xml', buffer: Buffer.from(performanceTtml()) });
  const outline = page.locator('[data-outline-drag]');
  await expect(outline).toHaveCount(2000);
  await outline.first().click();
  await expect(page.locator('main [data-line-id="p0"]')).toBeInViewport();
  const a = (await outline.first().boundingBox())!, b = (await outline.nth(3).boundingBox())!;
  await page.mouse.move(a.x + 5, a.y + 5); await page.mouse.down();
  await page.mouse.move(a.x + 30, b.y + b.height - 5, { steps: 8 });
  await expect(page.locator('main [data-drag-placeholder]')).toHaveCount(1);
  expect(await page.locator('main section[data-line-id]').count()).toBeLessThan(80);
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.locator('main [data-drag-placeholder]')).toHaveCount(0);
});
