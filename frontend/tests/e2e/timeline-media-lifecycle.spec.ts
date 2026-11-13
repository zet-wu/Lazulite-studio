import { expect, test } from '@playwright/test';
import { loadTimeline } from '../fixtures/timeline-setup';

test('waveform redraws after hidden zoom and remount', async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  const pixels = () => page.locator('[role=slider] canvas').evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    return data.filter((_, i) => i % 4 === 3 && data[i] > 0).length;
  });
  await expect.poll(pixels).toBeGreaterThan(0);
  const toggle = page.getByRole('button', { name: '波形', exact: true });
  await toggle.click();
  await page.getByRole('button', { name: '放大波形', exact: true }).click();
  await toggle.click();
  await expect.poll(pixels).toBeGreaterThan(0);
  await page.locator('[aria-controls="timeline-plots"]').click();
  await expect(page.locator('[role=slider] canvas')).toHaveCount(0);
  await page.locator('[aria-controls="timeline-plots"]').click();
  await expect.poll(pixels).toBeGreaterThan(0);
});

test('hidden wave leaves every plot and lyric button zoomable without editing', async ({ page }) => {
  await loadTimeline(page, true);
  await page.getByRole('button', { name: '波形', exact: true }).click();
  const range = page.locator('span').filter({ hasText: /^视窗\s*\d/ }).first();
  const undo = page.getByRole('button', { name: '撤销', exact: true });
  const history = await undo.isEnabled();
  const plots = page.locator('[data-wheel-zoom]');
  for (let i = 0; i < await plots.count(); i++) {
    const plot = plots.nth(i), box = await plot.boundingBox();
    if (!box || box.height === 0) continue;
    const before = await range.textContent();
    await plot.dispatchEvent('wheel', { deltaY: -60, clientX: box.x + box.width / 2 });
    await expect(range).not.toHaveText(before!);
  }
  await page.getByRole('button', { name: '全曲', exact: true }).click();
  const word = page.getByRole('button', { name: '时间轴词 上', exact: true });
  const selected = await word.getAttribute('aria-pressed');
  for (const deltaMode of [0, 1, 2]) {
    await page.getByRole('button', { name: '全曲', exact: true }).click();
    const before = await range.textContent();
    await word.dispatchEvent('wheel', { deltaY: deltaMode === 0 ? -100 : -1, deltaMode, clientX: 500 });
    await expect(range).not.toHaveText(before!);
  }
  await page.getByRole('button', { name: '全曲', exact: true }).click();
  expect(await word.getAttribute('aria-pressed')).toBe(selected);
  expect(await undo.isEnabled()).toBe(history);
  const before = await range.textContent();
  await page.getByRole('spinbutton').first().dispatchEvent('wheel', { deltaY: -100 });
  await expect(range).toHaveText(before!);
});
