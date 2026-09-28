import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { performanceTtml } from '../fixtures/phase3';

const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] ?? null;

test('P3 production: five minutes, real audio, 2000 rows, 20000 words and bounded cache', async ({ page }) => {
  await page.addInitScript(() => {
    const measures = { longTasks: [] as number[], frames: [] as number[] };
    (window as unknown as { perfMeasures: typeof measures }).perfMeasures = measures;
    new PerformanceObserver(list => measures.longTasks.push(...list.getEntries().map(e => e.duration))).observe({ type: 'longtask', buffered: true });
    let previous = performance.now();
    const frame = (now: number) => { measures.frames.push(now - previous); previous = now; if (measures.frames.length > 20000) measures.frames.shift(); requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  });
  const report: Record<string, unknown> = { production: true, viewport: { width: 1440, height: 900 }, realMediaProvided: Boolean(process.env.STUDIO_PERF_AUDIO), sessions: [] };
  const sessions: unknown[] = [];
  const began = Date.now();
  for (const project of process.env.STUDIO_PERF_AUDIO ? ['real', 'synthetic'] : ['synthetic']) {
    await page.goto(`/projects/${project}/edit`);
    await expect(page.getByRole('slider', { name: '波形进度' })).toBeVisible();
    await page.locator('input[type=file]').last().setInputFiles({ name: 'performance.ttml', mimeType: 'application/xml', buffer: Buffer.from(performanceTtml()) });
    await expect(page.locator('[data-outline-drag]')).toHaveCount(2000, { timeout: 30_000 });
    expect(await page.locator('main section[data-line-id]').count()).toBeLessThan(80);
    const duration = Number(await page.getByRole('slider', { name: '波形进度' }).getAttribute('aria-valuemax'));
    for (let i = 0; i < 6; i++) await page.getByRole('button', { name: '放大波形' }).click();
    await page.getByLabel('时间轴图层').getByRole('button', { name: '声谱图', exact: true }).click();
    const spectrum = page.locator('[data-spectrum-ready]');
    const ready = async () => expect.poll(async () => (await spectrum.getAttribute('data-spectrum-ready')) === (await spectrum.getAttribute('data-spectrum-wanted')), { timeout: 15_000 }).toBe(true);
    await ready();
    const setupReadyMs = Date.now() - began;
    const compute: number[] = [], network: number[] = [], readiness: number[] = [];
    let stats: { cacheSize: number; evictions: number; completed: number; computeMs: number[]; requestMs: number[] };
    const wave = page.getByRole('slider', { name: '波形进度' });
    for (let step = 0; step < Math.ceil(duration / 4); step++) {
      const box = (await wave.boundingBox())!;
      const started = performance.now();
      await page.mouse.move(box.x + box.width * .9, box.y + 30); await page.mouse.down();
      await page.mouse.move(box.x + box.width * (.9 - 4 / (duration / 64)), box.y + 30, { steps: 3 }); await page.mouse.up();
      await ready(); readiness.push(performance.now() - started);
      stats = JSON.parse((await spectrum.getAttribute('data-spectrum-stats'))!);
      expect(stats.cacheSize).toBeLessThanOrEqual(128);
      if (step % 20 === 0) {
        await page.locator('[data-outline-drag]').nth(Math.min(1999, step * 10)).click();
        await page.getByRole('separator', { name: '属性栏宽度' }).focus(); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight');
      }
    }
    stats = JSON.parse((await spectrum.getAttribute('data-spectrum-stats'))!);
    compute.push(...stats.computeMs); network.push(...stats.requestMs);
    if (project === 'synthetic') { expect(stats.completed).toBeGreaterThan(128); expect(stats.evictions).toBeGreaterThan(0); }
    await page.getByRole('button', { name: '全曲', exact: true }).click();
    for (let i = 0; i < 6; i++) await page.getByRole('button', { name: '放大波形' }).click();
    await ready();
    sessions.push({ project, duration, setupReadyMs, stats, computeP50: percentile(compute, .5), computeP95: percentile(compute, .95), requestP95: percentile(network, .95), readyP95: percentile(readiness, .95) });
    await page.screenshot({ path: test.info().outputPath(`${project}-production.png`) });
  }
  // Continue keyboard resize and explicit locating for a total of at least five minutes.
  let i = 0;
  while (Date.now() - began < 300_000) {
    await page.locator('[data-outline-drag]').nth((i++ * 137) % 2000).click();
    await page.getByRole('separator', { name: '属性栏宽度' }).focus();
    await page.keyboard.press(i % 2 ? 'ArrowLeft' : 'ArrowRight');
    await page.waitForTimeout(500);
  }
  report.elapsedMs = Date.now() - began; report.sessions = sessions;
  report.measures = await page.evaluate(() => (window as unknown as { perfMeasures: unknown }).perfMeasures);
  await writeFile(test.info().outputPath('production-metrics.json'), JSON.stringify(report, null, 2));
  await test.info().attach('production-metrics.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
});

test('P3 production interaction latency on 2000 rows and 20000 words', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    const timings = { commits: [] as number[], dragFrames: [] as number[] };
    (window as unknown as { interactionTimings: typeof timings }).interactionTimings = timings;
    let dragging = false, previous = performance.now();
    document.addEventListener('pointerdown', event => { if ((event.target as Element).closest('[role=separator]')) dragging = true; }, true);
    document.addEventListener('pointerup', () => { dragging = false; }, true);
    document.addEventListener('focusout', event => {
      const target = event.target as HTMLInputElement;
      if (target instanceof HTMLInputElement && !target.readOnly && /^词 /.test(target.getAttribute('aria-label') ?? '')) {
        const began = performance.now(); requestAnimationFrame(() => timings.commits.push(performance.now() - began));
      }
    }, true);
    const frame = (now: number) => { if (dragging) timings.dragFrames.push(now - previous); previous = now; requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  });
  await page.goto('/projects/synthetic/edit');
  await page.locator('input[type=file]').last().setInputFiles({ name: 'latency.ttml', mimeType: 'application/xml', buffer: Buffer.from(performanceTtml()) });
  await expect(page.locator('[data-outline-drag]')).toHaveCount(2000, { timeout: 30_000 });
  const field = page.locator('main section[data-line-id]').first().locator('[data-word-id]').nth(1).locator('input').first();
  const profiler = process.env.STUDIO_CPU_PROFILE ? await page.context().newCDPSession(page) : null;
  if (profiler) { await profiler.send('Profiler.enable'); await profiler.send('Profiler.start'); }
  for (let i = 0; i < 20; i++) {
    await field.dblclick(); await field.fill(`改${i}`); await field.blur();
    // Finish the measured RAF before running the next accessibility selector in the page.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  }
  if (profiler) {
    const { profile } = await profiler.send('Profiler.stop');
    await writeFile(test.info().outputPath('editing.cpuprofile'), JSON.stringify(profile));
    await profiler.detach();
  }
  const separator = (await page.getByRole('separator', { name: '属性栏宽度' }).boundingBox())!;
  await page.mouse.move(separator.x + 3, separator.y + 20); await page.mouse.down();
  for (let i = 0; i < 60; i++) {
    await page.mouse.move(separator.x + 3 + Math.sin(i / 6) * 40, separator.y + 20);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  const timings = await page.evaluate(() => (window as unknown as { interactionTimings: { commits: number[]; dragFrames: number[] } }).interactionTimings);
  const report = { ...timings, commitP95: percentile(timings.commits, .95), dragFrameP95: percentile(timings.dragFrames, .95), scope: 'focusout capture to next RAF before the next automation action; frame intervals during separator drag; includes scheduling and layout' };
  expect(timings.commits.length).toBeGreaterThanOrEqual(20);
  await writeFile(test.info().outputPath('interaction-metrics.json'), JSON.stringify(report, null, 2));
});
