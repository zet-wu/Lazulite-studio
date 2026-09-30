import { importLyrics } from '../fixtures/import-lyrics';
import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { phase7Ttml } from '../fixtures/phase7';
test('P7 native extreme and normal rates keep media highlight and precise A/B loop synchronized', async ({ page }) => {
  await page.goto('/projects/phase3-media/edit'); await importLyrics(page, { name: 'phase7.ttml', mimeType: 'application/xml', buffer: Buffer.from(phase7Ttml) });
  await page.locator('[data-outline-drag]').first().click(); await page.getByRole('button', { name: '循环当前行', exact: true }).click();
  const historyBefore = await page.getByRole('button', { name: '撤销', exact: true }).isEnabled();
  const audio = page.locator('audio'), results = [];
  for (const rate of [.1, 1, 2]) {
    await page.getByRole('slider', { name: '播放速度', exact: true }).evaluate((el: HTMLInputElement, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, String(value)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    }, rate);
    await audio.evaluate((el: HTMLAudioElement) => { el.currentTime = 3.99; });
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => !el.paused && el.currentTime < .5)).toBe(true);
    await expect(page.getByRole('button', { name: '时间轴行 L1', exact: true })).toHaveClass(/trackPlaying/);
    await expect(page.getByRole('button', { name: '时间轴词 学校', exact: true })).toHaveClass(/trackPlaying/);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    results.push(await audio.evaluate((el: HTMLAudioElement) => ({ rate: el.playbackRate, position: el.currentTime, paused: el.paused, preservesPitch: el.preservesPitch })));
    await expect(page.getByRole('slider', { name: '循环 A 边界' })).toHaveAttribute('aria-valuenow', '0');
    await expect(page.getByRole('slider', { name: '循环 B 边界' })).toHaveAttribute('aria-valuenow', '4');
  }
  expect(await page.getByRole('button', { name: '撤销', exact: true }).isEnabled()).toBe(historyBefore);
  await writeFile(test.info().outputPath('speed-sync.json'), JSON.stringify(results, null, 2));
});
