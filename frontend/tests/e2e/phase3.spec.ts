import { expect, test } from '@playwright/test';
import { timelineTtml, listText, overlapTtml, performanceTtml } from '../fixtures/phase3';

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

for (const dpr of [1, 1.25, 2]) test(`P3-01 plot geometry and inverse pointer mapping DPR ${dpr}`, async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5174/projects/sample-project/edit');
  await page.locator('input[type=file]').last().setInputFiles({ name: 'synthetic.ttml', mimeType: 'application/xml', buffer: Buffer.from(timelineTtml()) });
  await expect(page.locator('[data-outline-drag]')).toHaveCount(4);
  await page.locator('[data-outline-drag]').first().click();
  await page.getByRole('button', { name: '循环当前行' }).click();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '放大波形' }).click();
  const wave = page.getByRole('slider', { name: '波形进度' });
  for (const width of [1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const w = (await wave.boundingBox())!;
    for (const lane of await page.locator('[data-track-lane]').all()) {
      const l = (await lane.boundingBox())!;
      expect(Math.abs(l.x - w.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(l.width - w.width)).toBeLessThanOrEqual(1);
    }
    const bar = (await page.getByRole('button', { name: '时间轴行 L1', exact: true }).boundingBox())!;
    const a = (await page.getByRole('slider', { name: '循环 A 边界' }).boundingBox())!;
    const b = (await page.getByRole('slider', { name: '循环 B 边界' }).boundingBox())!;
    expect(Math.abs(a.x + a.width / 2 - bar.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.x + b.width / 2 - bar.x - bar.width)).toBeLessThanOrEqual(1);
    const rects = await page.locator('[data-tick-us]').evaluateAll(nodes => nodes.map(n => ({ us: Number(n.getAttribute('data-tick-us')), x: n.getBoundingClientRect().x + n.getBoundingClientRect().width / 2 })));
    const span = 15; // sample asset duration 120 / 2^3
    for (const tick of rects) expect(Math.abs(tick.x - bar.x - (tick.us - 1_123_000) / (5_985_000 - 1_123_000) * bar.width)).toBeLessThanOrEqual(1);
    const canvas = page.locator('canvas').first();
    await expect.poll(() => canvas.evaluate((n: HTMLCanvasElement) => n.width)).toBe(Math.round(w.width * dpr));
    const boundary = page.getByRole('slider', { name: '循环 B 边界' });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(w.x + w.width / 2, b.y + b.height / 2, { steps: 5 });
    await page.mouse.up();
    expect(Number(await boundary.getAttribute('aria-valuenow'))).toBeCloseTo(1.123 + (w.x + w.width / 2 - bar.x) / bar.width * (5.985 - 1.123), 2);
    await page.getByRole('button', { name: '循环当前行' }).click();
  }
  await page.screenshot({ path: test.info().outputPath(`geometry-dpr-${dpr}.png`) });
  await context.close();
});

test('P3-04 constrains long inspector controls and aligns checkbox labels', async ({ page }) => {
  await page.goto('/editor');
  await page.locator('input[type=file]').setInputFiles({ name: 'long.ttml', mimeType: 'application/xml', buffer: Buffer.from(timelineTtml()) });
  await page.locator('[data-outline-drag]').first().click();
  const inspector = page.locator('aside').filter({ has: page.getByRole('heading', { name: '属性', exact: true }) });
  await expect.poll(() => inspector.evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
  await expect(page.getByLabel('所属主行').locator('option').nth(1)).toHaveText('L2');
  expect(await page.getByLabel('背景歌词').evaluate(e => getComputedStyle(e.parentElement!).display)).toBe('inline-flex');
});

for (const kind of ['行', '词', 'Ruby']) test(`P3-03 edits each overlapping ${kind} interval and undoes once`, async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  await page.locator('input[type=file]').last().setInputFiles({ name: 'overlap.ttml', mimeType: 'application/xml', buffer: Buffer.from(overlapTtml()) });
  await expect(page.locator('[data-outline-drag]')).toHaveCount(4);
  await page.locator('[data-outline-drag]').first().click();
  await page.getByLabel('吸附', { exact: true }).uncheck();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '放大波形' }).click();
  const bars = page.getByRole('button', { name: new RegExp(`^时间轴${kind} `) });
  await expect(bars).toHaveCount(4);
  const first = (await bars.nth(0).boundingBox())!, second = (await bars.nth(1).boundingBox())!;
  expect(Math.abs(first.y - second.y)).toBeGreaterThanOrEqual(22);
  const lane = (await bars.first().locator('..').boundingBox())!;
  for (const bar of await bars.all()) {
    const box = (await bar.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(lane.y + lane.height);
  }
  for (let i = 0; i < 3; i++) {
    const bar = bars.nth(i);
    for (const side of ['move', '开始边界', '结束边界']) {
      await bar.scrollIntoViewIfNeeded();
      const before = (await bar.boundingBox())!;
      const box = (await (side === 'move' ? bar : bar.getByLabel(new RegExp(side))).boundingBox())!;
      expect(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-timeline-key]'), { x: box.x + box.width / 2, y: box.y + box.height / 2 })).toBe(true);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + (side === '开始边界' ? -8 : 8), box.y + box.height / 2, { steps: 3 });
      await page.mouse.up();
      await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: '撤销', exact: true }).click();
      const restored = (await bar.boundingBox())!;
      expect(Math.abs(restored.x - before.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(restored.width - before.width)).toBeLessThanOrEqual(1);
    }
  }
  await page.screenshot({ path: test.info().outputPath(`overlap-${kind}.png`) });
});

test('P3-03 renders all 2000 visible timed rows and keeps the canvas and loop controls usable', async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  await page.locator('input[type=file]').last().setInputFiles({ name: 'dense.ttml', mimeType: 'application/xml', buffer: Buffer.from(timelineTtml(2000)) });
  await expect(page.getByRole('button', { name: /^时间轴行 / })).toHaveCount(2000);
  await expect(page.getByRole('button', { name: '循环当前行' })).toBeVisible();
  await expect(page.getByLabel('歌词列表', { exact: true })).toBeVisible();
  expect(await page.locator('main section[data-line-id]').count()).toBeLessThan(80);
  const plots = page.locator('[data-track-lane]').first().locator('../..');
  expect(await plots.evaluate(e => e.scrollHeight)).toBeGreaterThan(300);
});

for (const count of [80, 81, 2000]) test(`P3-07 measured locate ${count} rows keeps other scrollers and focus`, async ({ page }) => {
  await page.goto('/editor');
  await page.locator('input[type=file]').setInputFiles({ name: 'rows.txt', mimeType: 'text/plain', buffer: Buffer.from(listText(count)) });
  const outline = page.locator('[data-outline-drag]');
  await expect(outline).toHaveCount(count);
  await outline.nth(count - 5).click();
  const id = await outline.nth(count - 5).evaluate(e => e.parentElement!.getAttribute('data-line-id'));
  const row = page.locator(`main section[data-line-id="${id}"]`);
  await expect(row).toBeVisible();
  const scroller = page.getByLabel('歌词列表');
  await expect.poll(async () => {
    const r = (await row.boundingBox())!, s = (await scroller.boundingBox())!;
    return Math.abs((r.y + r.height / 2) - (s.y + s.height / 2));
  }).toBeLessThan(3);
  await expect(outline.nth(count - 5)).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await outline.nth(2).click();
  await outline.nth(10).click();
  await expect.poll(() => row.isVisible()).toBe(count === 80);
  expect(await page.locator('main section[data-line-id]').count()).toBeLessThanOrEqual(80);
});

test('P3-07 reduced motion and wheel cancel use only the lyric scroller', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/editor');
  await page.locator('input[type=file]').setInputFiles({ name: 'rows.txt', mimeType: 'text/plain', buffer: Buffer.from(listText(81)) });
  await page.locator('[data-outline-drag]').nth(60).click();
  const scroller = page.getByLabel('歌词列表');
  await expect.poll(() => scroller.evaluate(e => e.scrollTop)).toBeGreaterThan(1000);
  await scroller.hover();
  await page.mouse.wheel(0, -200);
  const top = await scroller.evaluate(e => e.scrollTop);
  await page.waitForTimeout(800);
  expect(Math.abs(await scroller.evaluate(e => e.scrollTop) - top)).toBeLessThan(250);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('P3-05 attaches, rebinds, detaches and restores a stable background relation', async ({ page }) => {
  await page.goto('/editor');
  await page.locator('input[type=file]').setInputFiles({ name: 'bg.ttml', mimeType: 'application/xml', buffer: Buffer.from(overlapTtml()) });
  const outline = page.locator('[data-outline-drag]');
  await outline.first().click();
  const background = page.getByLabel('背景歌词', { exact: true });
  const parent = page.getByLabel('所属主行');
  await expect(parent).toBeDisabled();
  await background.click();
  await expect(background).not.toBeChecked();
  await expect(page.getByRole('alert')).toContainText('之前没有主行');
  await outline.nth(1).click();
  await background.check();
  await expect(background).toBeChecked();
  await expect(parent).toBeEnabled();
  await expect(parent).toHaveValue('overlap-0');
  await expect(parent.locator('option:checked')).toHaveText('L1');
  await parent.selectOption('overlap-2');
  await expect(parent).toHaveValue('overlap-2');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(parent).toHaveValue('overlap-0');
  await background.uncheck();
  await expect(parent).toBeDisabled();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(parent).toHaveValue('overlap-0');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(background).not.toBeChecked();
  await background.check();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('检查点已保存', { exact: true })).toBeVisible();
  page.once('dialog', d => d.accept());
  await page.reload();
  await page.locator('[data-outline-drag]').nth(1).click();
  await expect(page.getByLabel('所属主行')).toHaveValue('overlap-0');
});

test('P3-06 columns resize independently, cancel, reset and persist outside lyric history', async ({ page }) => {
  await page.goto('/editor');
  const outline = page.getByRole('separator', { name: '大纲宽度' });
  const inspector = page.getByRole('separator', { name: '属性栏宽度' });
  await outline.focus(); await page.keyboard.press('ArrowRight');
  await expect(outline).toHaveAttribute('aria-valuenow', '198');
  await inspector.focus(); await page.keyboard.press('Shift+ArrowLeft');
  await expect(inspector).toHaveAttribute('aria-valuenow', '282');
  const saved = await page.evaluate(() => localStorage.getItem('lazulite-editor-columns'));
  const box = (await outline.boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + 20); await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 20);
  expect(await page.evaluate(() => localStorage.getItem('lazulite-editor-columns'))).toBe(saved);
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(outline).toHaveAttribute('aria-valuenow', '198');
  await outline.dblclick();
  await expect(outline).toHaveAttribute('aria-valuenow', '190');
  let separators = 2;
  for (const [name, expected] of [['显示大纲', 1], ['显示属性栏', 0], ['显示大纲', 1], ['显示属性栏', 2]] as const) {
    const view = page.locator('summary').filter({ hasText: '视图' });
    if (await view.locator('..').getAttribute('open') === null) await view.click();
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('separator')).toHaveCount(expected);
  }
  await expect(page.getByRole('separator')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.reload();
  await expect(inspector).toHaveAttribute('aria-valuenow', '282');
  await page.setViewportSize({ width: 900, height: 800 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('lazulite-editor-columns')))!).inspectorWidth).toBe(282);
});


test('P3-04 inspector remains usable at its 200px minimum with long text', async ({ page }) => {
  await page.goto('/editor');
  await page.locator('input[type=file]').setInputFiles({ name: 'long.ttml', mimeType: 'application/xml', buffer: Buffer.from(timelineTtml()) });
  const separator = page.getByRole('separator', { name: '属性栏宽度' });
  await separator.focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  await expect(separator).toHaveAttribute('aria-valuenow', '200');
  const inspector = page.locator('aside').filter({ has: page.getByRole('heading', { name: '属性', exact: true }) });
  expect(await inspector.evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: test.info().outputPath('inspector-minimum.png') });
});

test('P3-08 top menus are mutually exclusive and dismiss with pointer, outside, command and Escape', async ({ page }) => {
  await page.goto('/editor');
  const menu = (id: string) => page.locator(`[data-top-menu="${id}"]`);
  await menu('clipboard').locator('summary').click();
  await expect(menu('clipboard')).toHaveAttribute('open', '');
  await menu('tools').locator('summary').click();
  await expect(page.locator('[data-top-menu][open]')).toHaveCount(1);
  await expect(menu('clipboard')).not.toHaveAttribute('open');
  const trigger = (await menu('tools').locator('summary').boundingBox())!;
  await page.mouse.move(trigger.x + 10, trigger.y + trigger.height + 3);
  await page.waitForTimeout(80);
  await page.mouse.move(trigger.x + 10, trigger.y + 10);
  await expect(menu('tools')).toHaveAttribute('open', '');
  await page.mouse.move(2, 2);
  await expect(menu('tools')).not.toHaveAttribute('open');
  await menu('file').locator('summary').click();
  await page.getByLabel('导出格式').focus();
  await page.getByLabel('导出格式').selectOption('txt');
  await page.mouse.move(2, 2); await page.waitForTimeout(250);
  await expect(menu('file')).toHaveAttribute('open', ''); // select retains keyboard focus
  await page.keyboard.press('Escape');
  await expect(menu('file')).not.toHaveAttribute('open');
  await expect(menu('file').locator('summary')).toBeFocused();
  await menu('lyrics-settings').locator('summary').click();
  await page.getByRole('button', { name: '元数据编辑' }).click();
  await expect(page.locator('[data-top-menu][open]')).toHaveCount(0);
  await page.getByRole('button', { name: '关闭元数据编辑' }).click();
  await menu('view').locator('summary').click();
  await page.getByLabel('歌词列表', { exact: true }).click();
  await expect(page.locator('[data-top-menu][open]')).toHaveCount(0);
});

test('P3-08 file input survives cancellation, same-file reselection and format export', async ({ page }) => {
  await page.goto('/editor');
  const summary = page.locator('[data-top-menu="file"] summary');
  await summary.click();
  await page.locator('input[type=file]').dispatchEvent('cancel');
  await expect(page.locator('[data-top-menu][open]')).toHaveCount(0);
  for (let i = 0; i < 2; i++) {
    await page.locator('input[type=file]').setInputFiles({ name: 'same.txt', mimeType: 'text/plain', buffer: Buffer.from('合成歌词') });
    await expect(page.getByRole('textbox', { name: '词 合成歌词', exact: true })).toBeVisible();
    expect(await page.locator('input[type=file]').inputValue()).toBe('');
  }
  await summary.click();
  await page.getByLabel('导出格式').selectOption('txt');
  await expect(page.locator('[data-top-menu="file"]')).toHaveAttribute('open', '');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出所选格式' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.txt$/);
  await expect(page.locator('[data-top-menu][open]')).toHaveCount(0);
});

for (const dpr of [1, 1.25, 2]) test(`P3-09 spectrum has no unloaded seam DPR ${dpr}`, async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: dpr });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5174/projects/sample-project/edit');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '放大波形' }).click();
  await page.getByLabel('时间轴图层').getByRole('button', { name: '声谱图', exact: true }).click();
  const spectrum = page.locator('[data-spectrum-ready]');
  await expect.poll(() => spectrum.getAttribute('data-spectrum-ready')).toBe('4');
  const canvas = page.getByLabel('声谱图', { exact: true });
  const pixels = await canvas.evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')!;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let background = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] === 16 && data[i + 1] === 22 && data[i + 2] === 34 || data[i] === 36 && data[i + 1] === 53 && data[i + 2] === 75) background++;
    return background;
  });
  expect(pixels).toBe(0);
  const wave = (await page.getByRole('slider', { name: '波形进度' }).boundingBox())!, plot = (await canvas.boundingBox())!;
  expect(Math.abs(wave.x - plot.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(wave.width - plot.width)).toBeLessThanOrEqual(1);
  const stats = JSON.parse((await spectrum.getAttribute('data-spectrum-stats'))!);
  await test.info().attach('spectrum-stats.json', { body: JSON.stringify({ dpr, stats }), contentType: 'application/json' });
  await page.screenshot({ path: test.info().outputPath(`spectrum-dpr-${dpr}.png`) });
  await context.close();
});

test('P3-10 limits PCM concurrency and stops requests on hide', async ({ page }) => {
  let requests = 0;
  page.on('request', r => { if (r.url().includes('/pcm?')) requests++; });
  await page.addInitScript(() => {
    const fetch = window.fetch;
    const counters = { active: 0, peak: 0 };
    (window as unknown as { pcmCounters: typeof counters }).pcmCounters = counters;
    window.fetch = async (...args) => {
      if (!String(args[0]).includes('/pcm?')) return fetch(...args);
      let active = true;
      const finish = () => { if (active) { active = false; counters.active--; } };
      counters.active++; counters.peak = Math.max(counters.peak, counters.active);
      args[1]?.signal?.addEventListener('abort', finish, { once: true });
      try { return await fetch(...args); } finally { finish(); }
    };
  });
  await page.goto('/projects/sample-project/edit');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '放大波形' }).click();
  const toggle = page.getByLabel('时间轴图层').getByRole('button', { name: '声谱图', exact: true });
  await toggle.click();
  await expect.poll(() => page.locator('[data-spectrum-ready]').getAttribute('data-spectrum-ready')).toBe('4');
  expect(await page.evaluate(() => (window as unknown as { pcmCounters: { peak: number } }).pcmCounters.peak)).toBeLessThanOrEqual(2);
  await toggle.click();
  const before = requests;
  await page.getByRole('button', { name: '后移窗口' }).click();
  await page.waitForTimeout(300);
  expect(requests).toBe(before);
  await toggle.click();
  await expect(page.locator('[data-spectrum-ready]')).toBeVisible();
});

test('P3-01 canvases rebuild when DPR changes without a CSS resize', async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '放大波形' }).click();
  await page.getByLabel('时间轴图层').getByRole('button', { name: '声谱图', exact: true }).click();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 2, mobile: false });
  for (const canvas of await page.locator('canvas').all()) {
    await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => Math.abs(c.width - Math.round(c.getBoundingClientRect().width * devicePixelRatio)))).toBeLessThanOrEqual(1);
  }
  await cdp.detach();
});

test('P4-06 narrow blocks use existing zoom then normal endpoints without adding height', async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  await page.locator('input[type=file]').last().setInputFiles({ name: 'narrow.ttml', mimeType: 'application/xml', buffer: Buffer.from('<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p xml:id="narrow" begin="2" end="2.001"><span begin="2" end="2.001">窄</span></p></div></body></tt>') });
  const bar = page.getByRole('button', { name: '时间轴行 L1', exact: true });
  await expect(bar).toBeVisible();
  expect((await bar.locator('[data-time-color]').boundingBox())!.width).toBeLessThan(1);
  const height = (await page.locator('footer').boundingBox())!.height;
  await bar.focus();
  await bar.press('Enter');
  expect((await page.locator('footer').boundingBox())!.height).toBe(height);
  await expect(page.getByLabel('选中区间边界')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '放大选中区间' })).toHaveCount(0);
  await page.locator('audio').evaluate((e: HTMLAudioElement) => { e.currentTime = 2; e.dispatchEvent(new Event('seeked')); });
  for (let i = 0; i < 14; i++) await page.getByRole('button', { name: '放大波形' }).click();
  await page.getByLabel('吸附', { exact: true }).uncheck();
  const begin = bar.getByLabel('时间轴行 L1开始边界');
  const end = bar.getByLabel('时间轴行 L1结束边界');
  await expect(begin).toBeVisible(); await expect(end).toBeVisible();
  const a = (await begin.boundingBox())!, b = (await end.boundingBox())!;
  expect(a.x + a.width).toBeLessThan(b.x);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 - 12, a.y + a.height / 2, { steps: 3 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.getByRole('textbox', { name: '行 narrow开始秒数', exact: true })).toHaveValue('2');
  for (const side of ['开始边界', '结束边界']) {
    const box = (await bar.getByLabel('时间轴行 L1' + side).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + (side === '开始边界' ? -12 : 12), box.y + box.height / 2, { steps: 3 }); await page.mouse.up();
    await page.getByRole('button', { name: '撤销', exact: true }).click();
  }
  await expect(page.getByRole('textbox', { name: '行 narrow开始秒数', exact: true })).toHaveValue('2');
  await expect(page.getByRole('textbox', { name: '行 narrow结束秒数', exact: true })).toHaveValue('2.001');
  await page.screenshot({ path: test.info().outputPath('narrow-existing-zoom.png') });
});

test('P3-10 rapid panning terminates obsolete worker jobs instead of queuing them', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const counts = { pending: 0, peak: 0, canceled: 0 };
    (window as unknown as { workerCounts: typeof counts }).workerCounts = counts;
    window.Worker = class extends NativeWorker {
      private jobs = new Map<number, ReturnType<typeof setTimeout>>();
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', event => {
          if (this.jobs.delete(event.data.token)) counts.pending--;
        });
      }
      postMessage(message: { token: number }, transfer: Transferable[] | StructuredSerializeOptions = []) {
        counts.pending++; counts.peak = Math.max(counts.peak, counts.pending);
        const transferables = Array.isArray(transfer) ? transfer : transfer.transfer ?? [];
        this.jobs.set(message.token, setTimeout(() => super.postMessage(message, transferables), 500));
      }
      terminate() {
        counts.canceled += this.jobs.size;
        counts.pending -= this.jobs.size;
        for (const timer of this.jobs.values()) clearTimeout(timer);
        this.jobs.clear(); super.terminate();
      }
    };
  });
  await page.goto('/projects/sample-project/edit');
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '放大波形' }).click();
  await page.getByLabel('时间轴图层').getByRole('button', { name: '声谱图', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { workerCounts: { pending: number } }).workerCounts.pending)).toBeGreaterThan(0);
  const wave = (await page.getByRole('slider', { name: '波形进度' }).boundingBox())!;
  await page.mouse.move(wave.x + wave.width * .8, wave.y + 25); await page.mouse.down();
  await page.mouse.move(wave.x + wave.width * .2, wave.y + 25, { steps: 4 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (window as unknown as { workerCounts: { canceled: number } }).workerCounts.canceled)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as unknown as { workerCounts: { peak: number } }).workerCounts.peak)).toBeLessThanOrEqual(2);
  const spectrum = page.locator('[data-spectrum-ready]');
  await expect.poll(async () => (await spectrum.getAttribute('data-spectrum-ready')) === (await spectrum.getAttribute('data-spectrum-wanted'))).toBe(true);
});


for (const count of [80, 83]) test(`P3-07 variable Ruby/transliteration height and background locate ${count} rows`, async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, recordVideo: { dir: test.info().outputPath('locate-video') } });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5174/editor');
  const bg = count - 1, parent = count - 2;
  let xml = performanceTtml(count).replace(new RegExp(`<text for="p${bg}">[\\s\\S]*?</text>`), '');
  xml = xml.replace(`<p xml:id="p${parent}" begin="${(parent * .3).toFixed(3)}" end="${(parent * .3 + .29).toFixed(3)}">`, `<p xml:id="p${parent}" begin="${(parent * .3).toFixed(3)}" end="${(bg * .3 + .29).toFixed(3)}">`);
  xml = xml.replace('</transliteration>', `${Array.from({ length: 12 }, (_, i) => `<text for="p40">合成变高附属${i}</text>`).join('')}</transliteration>`);
  await page.locator('input[type=file]').setInputFiles({ name: 'variable.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  const outline = page.locator('[data-outline-drag]');
  await expect(outline).toHaveCount(count);
  await outline.last().click(); await page.getByLabel('背景歌词', { exact: true }).check();
  await expect(page.getByLabel('背景歌词', { exact: true })).toBeChecked();
  const scroller = page.getByLabel('歌词列表');
  await outline.first().click();
  await expect.poll(() => scroller.evaluate(e => e.scrollTop)).toBeLessThan(2);
  await outline.nth(40).click();
  const tall = page.locator('main section[data-line-id="p40"]');
  await expect(tall).toBeVisible();
  expect((await tall.boundingBox())!.height).toBeGreaterThan((await scroller.boundingBox())!.height);
  await expect.poll(async () => Math.abs((await tall.boundingBox())!.y - (await scroller.boundingBox())!.y)).toBeLessThan(3);
  await expect(outline.nth(40)).toBeFocused();
  await outline.nth(60).click();
  const middle = page.locator('main section[data-line-id="p60"]');
  await expect(middle).toBeVisible();
  expect((await middle.boundingBox())!.height).toBeLessThan((await scroller.boundingBox())!.height);
  await expect.poll(async () => {
    const r = (await middle.boundingBox())!, v = (await scroller.boundingBox())!;
    return Math.abs(r.y + r.height / 2 - v.y - v.height / 2);
  }).toBeLessThan(3);
  await outline.last().click();
  const background = page.locator(`main section[data-line-id="p${bg}"]`);
  await expect(background).toBeVisible();
  await expect.poll(() => scroller.evaluate(e => Math.abs(e.scrollHeight - e.clientHeight - e.scrollTop))).toBeLessThan(3);
  await expect(outline.last()).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: test.info().outputPath(`background-locate-${count}.png`) });
  await context.close();
  await page.video()!.saveAs(test.info().outputPath(`variable-locate-${count}.webm`));
});
