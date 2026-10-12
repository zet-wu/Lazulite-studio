import { importLyrics } from '../fixtures/import-lyrics';
import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { performanceTtml } from '../fixtures/large-document';

test('production large 注音 proposals and native playing response', async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    const longTasks: number[] = [];
    (window as unknown as { proposalLongTasks: number[] }).proposalLongTasks = longTasks;
    new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => e.duration))).observe({ type: 'longtask', buffered: true });
  });
  await page.goto(process.env.STUDIO_PERF_AUDIO ? '/projects/real/edit' : '/projects/synthetic/edit');
  const xml = performanceTtml().replace(/<text for="p(\d+)"><span begin="[^"]*" end="[^"]*">rom<\/span><\/text>/g, (_, i) =>
    `<text for="p${i}"><span begin="${(Number(i) * .3).toFixed(3)}" end="${(Number(i) * .3 + .024).toFixed(3)}">ko</span></text>`);
  await importLyrics(page, { name: 'ruby-performance.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await expect(page.locator('[data-outline-drag]')).toHaveCount(2000, { timeout: 30_000 });
  await page.locator('[data-outline-drag]').first().click();
  await page.locator('[data-top-menu="clipboard"] summary').click();
  await page.getByRole('button', { name: '全选', exact: true }).click();
  await page.locator('[data-top-menu="tools"] summary').click();
  const began = performance.now();
  await page.getByRole('button', { name: '从音译生成 注音…', exact: true }).click();
  const dialog = page.locator('[role=dialog]');
  const rowContainer = dialog.locator('[class*="rubyGenerationRows"]').first();
  const virtualized = await rowContainer.getAttribute('data-proposal-count') !== null;
  if (virtualized) {
    await expect(rowContainer).toHaveAttribute('data-proposal-count', '2000');
    expect(await dialog.getByLabel('目标词').count()).toBeLessThan(80);
  } else await expect(dialog.getByLabel('目标词')).toHaveCount(2000);
  const proposalOpenMs = performance.now() - began;
  await dialog.getByLabel('目标词').first().selectOption({ label: '1 · w0 · 时间重叠' });
  let started = performance.now();
  await dialog.getByLabel('字符输出').selectOption('katakana');
  await expect(dialog.getByLabel('目标 注音').first()).toHaveValue('コ');
  const outputChangeMs = performance.now() - started;
  const skipChangeMs = await dialog.evaluate(async e => {
    const checkbox = Array.from(e.querySelectorAll('label')).find(label => /跳过生成|此单元不生成/.test(label.textContent ?? ''))!.querySelector('input')!;
    const began = performance.now();
    checkbox.click();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    return performance.now() - began;
  });
  await writeFile(test.info().outputPath('ruby-proposal-response.json'), JSON.stringify({ proposalOpenMs, outputChangeMs, skipChangeMs, mountedProposalRows: await dialog.getByLabel('目标词').count(), scope: '2000 logical proposals; automation to visible values, skip event to next RAF' }, null, 2));
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('[data-outline-drag]').first().click();
  await page.locator('footer button[aria-label="播放"]').click();
  const seekFrames: number[] = [];
  for (let i = 0; i < 20; i++) {
    seekFrames.push(await page.locator('audio').evaluate(async (e: HTMLAudioElement, i) => {
      const began = performance.now();
      e.currentTime = i * .3 + .012;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      return performance.now() - began;
    }, i));
  }
  await page.locator('footer button[aria-label="暂停"]').click();
  const longTasks = await page.evaluate(() => (window as unknown as { proposalLongTasks: number[] }).proposalLongTasks);
  const sorted = [...seekFrames].sort((a, b) => a - b);
  await writeFile(test.info().outputPath('playback-response.json'), JSON.stringify({ rows: 2000, words: 20000, proposals: 2000, realMedia: Boolean(process.env.STUDIO_PERF_AUDIO), proposalOpenMs, outputChangeMs, skipChangeMs, seekFrames, seekRafP95: sorted[Math.floor(sorted.length * .95)], longTasks, scope: 'automation action to visible proposal/input; native seek to next RAF; long tasks include navigation/import' }, null, 2));
});
