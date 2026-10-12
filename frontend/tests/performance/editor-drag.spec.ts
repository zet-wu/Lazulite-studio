import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { performanceTtml } from '../fixtures/large-document';

test('UI production pointer preview with 2000 rich rows remains bounded', async ({ page }) => {
  await page.goto('/projects/no-music/edit');
  await page.locator('input[type=file]').setInputFiles({ name: 'large.ttml', mimeType: 'application/xml', buffer: Buffer.from(performanceTtml()) });
  const outline = page.locator('[data-outline-drag]');
  await expect(outline).toHaveCount(2000);
  await page.evaluate(() => {
    const metrics = { frames: [] as number[], events: [] as number[], maxPlaceholders: 0, tracking: true };
    (window as unknown as { dragMetrics: typeof metrics }).dragMetrics = metrics;
    let previous = performance.now();
    const frame = (now: number) => {
      if (!metrics.tracking) return;
      metrics.frames.push(now - previous); previous = now;
      metrics.maxPlaceholders = Math.max(metrics.maxPlaceholders, document.querySelectorAll('main [data-drag-placeholder]').length);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    window.addEventListener('pointermove', () => {
      if (!metrics.tracking) return;
      const began = performance.now();
      requestAnimationFrame(() => requestAnimationFrame(() => metrics.events.push(performance.now() - began)));
    }, true);
  });
  const a = (await outline.first().boundingBox())!, b = (await outline.nth(3).boundingBox())!;
  await page.mouse.move(a.x + 5, a.y + 5); await page.mouse.down();
  for (let i = 0; i < 6; i++) await page.mouse.move(a.x + 5, i % 2 ? a.y + 5 : b.y + b.height - 5, { steps: 8 });
  await page.waitForTimeout(50);
  const result = await page.evaluate(() => {
    const metrics = (window as unknown as { dragMetrics: { frames: number[]; events: number[]; maxPlaceholders: number; tracking: boolean } }).dragMetrics;
    metrics.tracking = false;
    return { ...metrics, mounted: document.querySelectorAll('main section[data-line-id]').length };
  });
  await page.keyboard.press('Escape'); await page.mouse.up();
  const p95 = (values: number[]) => values.slice().sort((a, b) => a - b)[Math.floor(values.length * .95)];
  expect(result.mounted).toBeLessThan(80); expect(result.maxPlaceholders).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await writeFile(test.info().outputPath('ui-drag-performance.json'), JSON.stringify({ ...result, frameP95Ms: p95(result.frames), pointerToTwoRafP95Ms: p95(result.events), scope: 'Production local editor, 2000 rows/20000 words with 注音 and timed romanization; real Playwright mouse through outline, pointer event to two RAF; no media; not OS/DPR acceptance' }, null, 2));
});
