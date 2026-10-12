import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { performanceTtml } from '../fixtures/large-document';

test('production inline commits keep 2000 rich rows bounded and report actual latency', async ({ page }) => {
  await page.goto('/projects/no-music/edit');
  await page.locator('input[type=file]').setInputFiles({ name: 'large.ttml', mimeType: 'application/xml', buffer: Buffer.from(performanceTtml()) });
  await expect(page.locator('[data-outline-drag]')).toHaveCount(2000);
  await page.evaluate(() => {
    const metrics = { commits: [] as number[], longTasks: [] as number[], tracking: true };
    (window as unknown as { inlineMetrics: typeof metrics }).inlineMetrics = metrics;
    new PerformanceObserver(list => { if (metrics.tracking) metrics.longTasks.push(...list.getEntries().map(entry => entry.duration)); }).observe({ type: 'longtask' });
    window.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || (event.target as HTMLElement).getAttribute('aria-label') !== '添加词') return;
      const began = performance.now(); requestAnimationFrame(() => metrics.commits.push(performance.now() - began));
    }, true);
  });
  const first = page.locator('main section[data-line-id="p0"]');
  for (let i = 0; i < 12; i++) {
    await first.getByRole('button', { name: '添加词', exact: true }).click();
    await first.getByRole('textbox', { name: '添加词', exact: true }).fill(`追加${i}`);
    await first.getByRole('textbox', { name: '添加词', exact: true }).press('Enter');
    await expect(first.getByRole('textbox', { name: `词 追加${i}`, exact: true })).toBeVisible();
  }
  const metrics = await page.evaluate(() => {
    const data = (window as unknown as { inlineMetrics: { commits: number[]; longTasks: number[]; tracking: boolean } }).inlineMetrics;
    data.tracking = false; return { ...data, mountedRows: document.querySelectorAll('main section[data-line-id]').length };
  });
  expect(metrics.commits).toHaveLength(12); expect(metrics.mountedRows).toBeLessThan(80);
  for (let i = 0; i < 12; i++) await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  const sorted = [...metrics.commits].sort((a, b) => a - b);
  await writeFile(test.info().outputPath('inline-performance.json'), JSON.stringify({ ...metrics, commitP95Ms: sorted[Math.floor(sorted.length * .95)], scope: 'Production local editor, 2000 rows / 20000 rich words; 12 actual Enter submissions to next RAF. Long tasks include selector scrolling and all inline interaction; no platform acceptance or complete historical performance claim.' }, null, 2));
});
