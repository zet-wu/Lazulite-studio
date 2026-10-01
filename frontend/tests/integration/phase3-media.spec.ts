import { expect, test } from '@playwright/test';

test('P3-05/11 saves a background relation through FastAPI and reopens its stable ID', async ({ page }) => {
  await page.goto('/projects/phase3-media/edit');
  await page.locator('[data-outline-drag]').nth(1).click();
  await page.getByLabel('背景歌词', { exact: true }).check();
  await expect(page.getByLabel('所属主行')).toHaveValue('media-0');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  const saved = await (await page.request.get('/api/v1/projects/phase3-media/document')).json();
  expect(saved.document.ttml).toContain('x-bg');
  await page.reload();
  await page.locator('[data-outline-drag]').nth(1).click();
  await expect(page.getByLabel('背景歌词', { exact: true })).toBeChecked();
  await expect(page.getByLabel('所属主行')).toHaveValue('media-0');
  const reopened = await (await page.request.get('/api/v1/projects/phase3-media/document')).json();
  expect(reopened.document.ttml).toBe(saved.document.ttml);
});

test('P3-01/02/09 uses proxy sample zero with nonzero source PTS and plays a precise loop', async ({ page }) => {
  await page.goto('/projects/phase3-media/edit');
  const project = await (await page.request.get('/api/v1/projects/phase3-media')).json();
  expect(project.asset.source_start_ms).toBeGreaterThan(1_900_000);
  expect(project.asset.proxy_offset_ms).toBe(0);
  await page.locator('[data-outline-drag]').first().click();
  await page.getByRole('button', { name: '循环当前行' }).click();
  await expect(page.getByRole('slider', { name: '循环 A 边界' })).toHaveAttribute('aria-valuenow', '1.123');
  await expect(page.getByRole('slider', { name: '循环 B 边界' })).toHaveAttribute('aria-valuenow', '3.985');
  const audio = page.locator('audio');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(() => audio.evaluate(a => (a as HTMLAudioElement).paused)).toBe(false);
  await audio.evaluate(a => { (a as HTMLAudioElement).currentTime = 3.97; });
  await expect.poll(() => audio.evaluate(a => (a as HTMLAudioElement).currentTime)).toBeLessThan(2);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByLabel('时间轴图层').getByRole('button', { name: '声谱图', exact: true }).click();
  const spectrum = page.locator('[data-spectrum-ready]');
  await expect.poll(async () => (await spectrum.getAttribute('data-spectrum-ready')) === (await spectrum.getAttribute('data-spectrum-wanted'))).toBe(true);
  await expect(page.getByText('声谱图加载中…')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('real-service-offset-spectrum.png') });
});
