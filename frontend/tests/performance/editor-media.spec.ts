import { expect, test } from '@playwright/test';
import { SPECTRUM_CACHE_LIMIT } from '../../src/features/spectrum-cache';

test('production spectrum cache stays bounded until actual eviction', async ({ page }) => {
  await page.goto('/projects/synthetic/edit');
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: '放大波形' }).click();
  await page.getByLabel('时间轴图层').getByRole('button', { name: '声谱图', exact: true }).click();
  const spectrum = page.locator('[data-spectrum-ready]');
  const ready = () => expect.poll(async () => {
    const wanted = await spectrum.getAttribute('data-spectrum-wanted');
    return wanted !== null && wanted === await spectrum.getAttribute('data-spectrum-ready');
  }, { timeout: 15_000 }).toBe(true);
  const stats = async () => JSON.parse((await spectrum.getAttribute('data-spectrum-stats'))!) as { cacheSize: number; evictions: number; completed: number };
  await ready();
  await expect(spectrum).not.toHaveAttribute('data-spectrum-stats');
  await page.evaluate(() => { (window as Window & {studioSpectrumDiagnostics?:boolean}).studioSpectrumDiagnostics=true; });
  await page.getByLabel('时间轴图层').getByRole('button', {name:'声谱图',exact:true}).click();
  await page.getByLabel('时间轴图层').getByRole('button', {name:'声谱图',exact:true}).click();
  await ready();
  const wave = page.getByRole('slider', { name: '波形进度' });
  // Stop once real fetch/compute has crossed capacity; full-song sampling is manual.
  for (let step = 0; step <= SPECTRUM_CACHE_LIMIT; step++) {
    const current = await stats();
    expect(current.cacheSize).toBeLessThanOrEqual(SPECTRUM_CACHE_LIMIT);
    if (current.evictions > 0) break;
    const box = (await wave.boundingBox())!;
    await page.mouse.move(box.x + box.width * .9, box.y + 30); await page.mouse.down();
    await page.mouse.move(box.x + box.width * .1, box.y + 30, { steps: 3 }); await page.mouse.up();
    await ready();
  }
  const final = await stats();
  expect(final.cacheSize).toBeLessThanOrEqual(SPECTRUM_CACHE_LIMIT);
  expect(final.completed).toBeGreaterThan(SPECTRUM_CACHE_LIMIT);
  expect(final.evictions).toBeGreaterThan(0);
});
