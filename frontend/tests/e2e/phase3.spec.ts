import { expect, test } from '@playwright/test';
import { timelineTtml, listText, overlapTtml } from '../fixtures/phase3';

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
  await expect(page.getByRole('heading', { name: '歌词编辑' })).toBeVisible();
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
  page.once('dialog', d => d.accept());
  await page.reload();
  await page.locator('[data-outline-drag]').nth(1).click();
  await expect(page.getByLabel('所属主行')).toHaveValue('overlap-0');
});
