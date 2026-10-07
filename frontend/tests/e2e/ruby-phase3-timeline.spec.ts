import { expect, test, type Page, type Locator } from '@playwright/test';
import { loadTimeline } from '../fixtures/timeline-setup';

async function drag(page: Page, target: Locator, fraction: number) {
  await target.scrollIntoViewIfNeeded();
  const b = (await target.boundingBox())!, lane = (await target.locator('xpath=ancestor::*[@data-track-lane or @data-vocal-lane][1]').boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + lane.width * fraction, b.y + b.height / 2, { steps: 4 });
}
async function guides(page: Page, valid = true) {
  const values = await page.locator('[data-drag-guide]').evaluateAll(nodes => nodes.map(node => ({ ms: Number(node.getAttribute('data-preview-ms')), valid: node.getAttribute('data-valid'), x: node.getBoundingClientRect().x, height: node.getBoundingClientRect().height, parentHeight: node.parentElement!.getBoundingClientRect().height, pointer: getComputedStyle(node).pointerEvents, style: getComputedStyle(node).borderLeftStyle })));
  expect(values.length).toBeGreaterThanOrEqual(6);
  expect(new Set(values.map(v => v.ms)).size).toBe(1);
  expect(Math.max(...values.map(v => v.x)) - Math.min(...values.map(v => v.x))).toBeLessThan(1.1);
  for (const v of values) { expect(v.valid).toBe(String(valid)); expect(v.pointer).toBe('none'); expect(v.style).toBe('dashed'); expect(v.height).toBeCloseTo(v.parentHeight, 0); }
  return values[0].ms;
}
for (const audio of [true, false]) for (const theme of ['light', 'dark']) test(`shared playback and cross-track preview audio=${audio} ${theme}`, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(t => localStorage.setItem('lazulite-editor-theme', t), theme);
  await loadTimeline(page, audio);
  await page.locator('audio').evaluate((a: HTMLAudioElement) => { a.currentTime = 2; });
  await expect(page.getByRole('slider', { name: '波形进度' })).toHaveAttribute('aria-valuenow', '2');
  const heads = page.locator('[data-playhead]');
  await expect(heads).toHaveCount(audio ? 3 : 2);
  const measure = () => heads.evaluateAll(nodes => nodes.filter(node => node.parentElement!.getBoundingClientRect().height > 0).map(node => ({ x: node.getBoundingClientRect().x, width: node.getBoundingClientRect().width, color: getComputedStyle(node).backgroundColor, display: getComputedStyle(node).display })));
  const positions = await measure();
  expect(new Set(positions.map(p => p.color)).size).toBe(1);
  expect(positions.every(p => p.width === 2 && p.display === 'block')).toBe(true);
  expect(Math.max(...positions.map(p => p.x)) - Math.min(...positions.map(p => p.x))).toBeLessThan(1);
  await expect(page.locator('[data-vocal-lane] [data-playhead], [data-track-lane] [data-playhead]')).toHaveCount(0);
  await page.getByRole('button', { name: '波形', exact: true }).click();
  const before = (await measure())[0].x;
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(async () => (await measure())[0].x).toBeGreaterThan(before + 3);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const after = await measure(); expect(Math.max(...after.map(p => p.x)) - Math.min(...after.map(p => p.x))).toBeLessThan(1);
  await page.getByRole('button', { name: '波形', exact: true }).click();
  await drag(page, page.getByRole('button', { name: '时间轴词 上', exact: true }), -.02);
  await guides(page);
  await page.screenshot({ path: test.info().outputPath('cross-track.png') });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.locator('[data-drag-guide]')).toHaveCount(0);
});
test('lyric candidate matches committed snapped time and invalid/cancelled edits do not commit', async ({ page }) => {
  await loadTimeline(page, true);
  const word = page.getByRole('button', { name: '时间轴词 上', exact: true });
  await page.getByLabel('吸附', { exact: true }).check();
  await drag(page, word, .049);
  const time = await guides(page); await page.mouse.up();
  const lane = (await word.locator('..').boundingBox())!, b = (await word.boundingBox())!;
  const span = Number(await page.getByRole('slider', { name: '波形进度' }).getAttribute('aria-valuemax'))! / 8;
  expect((b.x - lane.x) / lane.width * span * 1000).toBeCloseTo(time, -1);
  await expect(page.locator('[data-drag-guide]')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  const end = page.getByLabel('时间轴行 L1结束边界', { exact: true });
  await drag(page, end, -.2); await guides(page, false);
  await expect(page.getByText('行边界不能排除词', { exact: true })).toBeVisible();
  await page.mouse.up(); await expect(page.locator('[data-drag-guide]')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '行 main结束秒数' })).toHaveCount(0); // audio mode has no inspector
  await drag(page, word, .05); await guides(page);
  await word.evaluate(el => { for (let id = 1; id < 5; id++) if (el.hasPointerCapture(id)) el.releasePointerCapture(id); });
  await page.mouse.up(); await expect(page.locator('[data-drag-guide]')).toHaveCount(0);
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.locator('[data-line-id="main"] > [data-outline-drag]').click();
  await expect(page.getByRole('textbox', { name: '行 main结束秒数' })).toHaveValue('9');
});
test('segment move and edges share the committed candidate and clear on capture loss', async ({ page }) => {
  await loadTimeline(page, true);
  const segment = page.locator('[data-segment-id="s1"]');
  for (const side of ['move', 'start', 'end']) {
    const target = side === 'move' ? segment : segment.locator('span').nth(side === 'start' ? 1 : 2);
    await drag(page, target, .049);
    const ms = await guides(page); await page.mouse.up();
    const label = (await segment.getAttribute('aria-label'))!, match = label.match(/(\d+)–(\d+)/)!;
    expect(Number(match[side === 'end' ? 2 : 1])).toBe(ms);
    await expect(page.locator('[data-drag-guide]')).toHaveCount(0);
    await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(segment).toHaveAttribute('aria-label', /1000–3000/);
  }
  await drag(page, segment, .03); await guides(page);
  await segment.evaluate(el => { for (let id = 1; id < 5; id++) if (el.hasPointerCapture(id)) el.releasePointerCapture(id); });
  await page.mouse.up(); await expect(page.locator('[data-drag-guide]')).toHaveCount(0);
  await expect(segment).toHaveAttribute('aria-label', /1000–3000/);
});

test('segment end snapping projects the moved start and group bounds clamp every member', async ({ page }) => {
  await loadTimeline(page, true, [{ id: 's1', beginMs: 1000, endMs: 3270 }, { id: 's2', beginMs: 7000, endMs: 14000 }]);
  const first = page.locator('[data-segment-id="s1"]'), second = page.locator('[data-segment-id="s2"]');
  await drag(page, first, .014);
  expect(await guides(page)).toBe(1230); await page.mouse.up();
  await expect(first).toHaveAttribute('aria-label', /1230–3500/);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await first.click(); await second.click({ modifiers: ['Control'] });
  await drag(page, second, -.25); expect(await guides(page)).toBe(6000); await page.mouse.up();
  await expect(first).toHaveAttribute('aria-label', /0–2270/); await expect(second).toHaveAttribute('aria-label', /6000–13000/);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(first).toHaveAttribute('aria-label', /1000–3270/); await expect(second).toHaveAttribute('aria-label', /7000–14000/);
});

test('pointer cancel, hidden source and mode unmount clear a pending preview without editing', async ({ page }) => {
  await loadTimeline(page, true);
  const segment = page.locator('[data-segment-id="s1"]');
  await drag(page, segment, .03); await guides(page);
  await segment.dispatchEvent('pointercancel', { pointerId: 1 }); await page.mouse.up();
  await expect(page.locator('[data-drag-guide]')).toHaveCount(0); await expect(segment).toHaveAttribute('aria-label', /1000–3000/);
  await drag(page, segment, .03); await guides(page);
  await page.getByRole('button', { name: '片段', exact: true }).evaluate((el: HTMLButtonElement) => el.click()); await page.mouse.up();
  await expect(page.locator('[data-drag-guide]')).toHaveCount(0);
  await page.getByRole('button', { name: '片段', exact: true }).click(); await expect(segment).toHaveAttribute('aria-label', /1000–3000/);
  await drag(page, segment, .03); await guides(page);
  await page.getByRole('button', { name: '编辑', exact: true }).evaluate((el: HTMLButtonElement) => el.click()); await page.mouse.up();
  await expect(page.locator('[data-drag-guide]')).toHaveCount(0);
  await page.getByRole('button', { name: '音频处理', exact: true }).click(); await expect(segment).toHaveAttribute('aria-label', /1000–3000/);
});
