import { expect, test } from '@playwright/test';
import { performanceTtml } from '../fixtures/phase3';
import { writeFile } from 'node:fs/promises';

for (const count of [20, 80, 81, 2000]) test(`timeline phase2 return measurement ${count}`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const tasks: { start: number; duration: number }[] = [];
    (window as any).switchTasks = tasks;
    new PerformanceObserver(list => tasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration })))).observe({ type: 'longtask' });
  });
  test.setTimeout(60000);
  await page.goto('/projects/no-music/edit');
  await page.getByRole('button', { name: '歌词获取', exact: true }).click();
  const rows: unknown[] = [];
  const start = await page.evaluate(() => performance.now());
  await page.locator('input[type=file]').setInputFiles({ name: 'switch.ttml', mimeType: 'application/xml', buffer: Buffer.from(performanceTtml(count)) });
  await page.getByRole('button', { name: '确认导入并替换歌词' }).click();
  await expect(page.locator('[data-outline-drag]')).toHaveCount(count);
  rows.push(await page.evaluate(began => ({ kind: 'first', ms: performance.now() - began, nodes: document.querySelectorAll('main *').length, tasks: (window as any).switchTasks.filter((t: any) => t.start >= began) }), start));
  await page.locator('[data-outline-drag]').last().click();
  await page.waitForTimeout(500);
  for (let run = 0; run < 3; run++) {
    await page.getByRole('button', { name: '音频处理', exact: true }).click();
    const began = await page.evaluate(() => performance.now());
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.waitForFunction(() => !!document.querySelector('main [data-line-id]'));
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const ready = await page.evaluate(() => performance.now());
    await page.waitForTimeout(350);
    rows.push(await page.evaluate(({ began, ready, run }) => {
      const scroller = document.querySelector('[aria-label="歌词列表"]')!;
      const selected = document.querySelector('main [data-line-id="p' + (document.querySelectorAll('[data-outline-drag]').length - 1) + '"]');
      const box = selected?.getBoundingClientRect(), view = scroller.getBoundingClientRect();
      return { kind: 'return', run, ms: ready - began, nodes: document.querySelectorAll('main *').length, mountedRows: document.querySelectorAll('main [data-line-id]').length, deviation: box ? Math.abs((box.top + box.bottom - view.top - view.bottom) / 2) : null, tasks: (window as any).switchTasks.filter((t: any) => t.start >= began) };
    }, { began, ready, run }));
  }
  await writeFile(test.info().outputPath('switch.json'), JSON.stringify({ count, rows }, null, 2));
});
