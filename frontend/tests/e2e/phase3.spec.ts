import { expect, test } from '@playwright/test';
import { timelineTtml, listText } from '../fixtures/phase3';

test('P3-01 uses the same physical plot for waveform and lyric tracks', async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  await page.locator('input[type=file]').last().setInputFiles({ name: 'synthetic.ttml', mimeType: 'application/xml', buffer: Buffer.from(timelineTtml()) });
  const wave = page.getByRole('slider', { name: '波形进度' });
  await expect(page.getByRole('button', { name: '时间轴行 L1', exact: true })).toBeVisible();
  const w = (await wave.boundingBox())!, lane = (await page.locator('[data-track-lane]').first().boundingBox())!;
  await page.screenshot({ path: test.info().outputPath('plot.png') });
  expect(Math.abs(w.x - lane.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(w.width - lane.width)).toBeLessThanOrEqual(1);
});

test('P3-07 locates the last row of a normal list', async ({ page }) => {
  await page.goto('/editor');
  await page.locator('input[type=file]').setInputFiles({ name: '80.txt', mimeType: 'text/plain', buffer: Buffer.from(listText(80)) });
  await page.locator('[data-outline-drag]').last().click();
  await expect.poll(() => page.getByLabel('歌词列表').evaluate(e => e.scrollTop)).toBeGreaterThan(0);
});
