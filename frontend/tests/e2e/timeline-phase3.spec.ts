import { expect, test, type Page } from '@playwright/test';
import { importLyrics } from '../fixtures/import-lyrics';
import { xml } from '../fixtures/timeline-phase3';
async function load(page: Page, sync = true, data = xml) {
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/editor');
  await importLyrics(page, { name: 'phase3.ttml', mimeType: 'application/xml', buffer: Buffer.from(data) });
  if (sync) await page.getByRole('button', { name: '打轴', exact: true }).click();
}
const word = (page: Page, id: string) => page.locator(`main [data-word-id="${id}"]`);
for (const sync of [false, true]) test(`stable geometry and hysteresis, invalid target cancels in ${sync ? 'sync' : 'edit'}`, async ({ page }) => {
  await load(page, sync);
  const a = word(page, 'A'), b = word(page, 'B'), ruby = page.locator('main [data-ruby-id="r1"]');
  const before = await b.boundingBox(), source = (await a.boundingBox())!;
  await page.mouse.move(source.x + 2, source.y + 2); await page.mouse.down();
  await page.waitForTimeout(300); await expect(page.locator('[data-object-drag]')).toHaveCount(0);
  await page.mouse.move(source.x + 3, source.y + 3); await page.waitForTimeout(250); await expect(page.locator('[data-object-drag]')).toHaveCount(0);
  const box = before!;
  await page.mouse.move(box.x + box.width / 2 - 5, box.y + 3, { steps: 4 });
  const mark = page.locator('[class*="dragInsertion"]'); await expect(mark).toBeVisible();
  const left = await mark.boundingBox();
  for (const dx of [1, -1, 2, -2, 1]) { await page.mouse.move(box.x + box.width / 2 + dx, box.y + 3); await page.waitForTimeout(40); expect(await mark.boundingBox()).toEqual(left); }
  expect(await b.boundingBox()).toEqual(before);
  await page.mouse.move(box.x + box.width / 2 + 5, box.y + 3); await expect.poll(async () => (await mark.boundingBox())?.x).not.toBe(left?.x);
  await page.waitForTimeout(250); expect(await b.boundingBox()).toEqual(before);
  await page.mouse.move(1430, 180); await expect(mark).toBeHidden(); await expect(page.locator('[data-drop-error]')).toHaveCount(1);
  await page.mouse.up(); expect(await page.locator('main [data-word-id]').evaluateAll(ns => ns.map(n => n.getAttribute('data-word-id')))).toEqual(['A', 'B', 'W', 'BG']);
  const r = (await ruby.boundingBox())!; await page.mouse.move(r.x + 2, r.y + 2); await page.mouse.down();
  await page.mouse.move(box.x + 5, box.y + 3, { steps: 4 }); await expect(mark).toBeVisible(); expect(await b.boundingBox()).toEqual(before);
  await page.keyboard.press('Escape'); await page.mouse.up(); await expect(mark).toHaveCount(0);
});
test('SVG colors, body add button, gutter, selection and native input selection', async ({ page }) => {
  await load(page);
  const a = word(page, 'A'); await a.click(); await a.click({ button: 'right' }); await page.getByRole('menuitem', { name: '添加空拍', exact: true }).click();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const colors = await a.evaluate(node => {
      const current = node.querySelector('[data-current] circle')!, ordinary = node.querySelector('rect')!;
      const probe = document.createElement('span'); node.append(probe); probe.style.color = 'var(--blue)'; const blue = getComputedStyle(probe).color; probe.style.color = 'var(--muted)'; const muted = getComputedStyle(probe).color; probe.remove();
      return { current: getComputedStyle(current).fill, ordinary: getComputedStyle(ordinary).fill, blue, muted, glow: getComputedStyle(current.parentElement!).filter };
    });
    expect(colors.current).toBe(colors.blue); expect(colors.ordinary).toBe(colors.muted); expect(colors.glow).toContain('drop-shadow');
    const line = page.locator('main [data-line-id="a"]'), plus = line.getByRole('button', { name: '添加词', exact: true });
    await expect(plus).toHaveAttribute('data-role', 'primary');
    const body = await a.locator('[class*="syncBody"]').boundingBox(), button = (await plus.boundingBox())!;
    expect(Math.abs(button.y + button.height / 2 - body!.y - body!.height / 2)).toBeLessThan(2);
    const style = await plus.evaluate(node => { const s = getComputedStyle(node); return [s.backgroundColor, s.borderTopColor, getComputedStyle(node.querySelector('svg')!).color]; });
    expect(style[0]).toBe(style[1]); expect(style[2]).not.toBe(style[0]);
    await page.screenshot({ path: test.info().outputPath(`compact-${theme}.png`) });
  }
  await word(page, 'B').click({ modifiers: ['Shift'] }); expect(await page.evaluate(() => getSelection()?.toString())).toBe('');
  await a.dblclick(); const input = page.getByRole('textbox', { name: '词 Alpha', exact: true }); await input.press('ControlOrMeta+A');
  expect(await input.evaluate((n: HTMLInputElement) => n.selectionEnd! - n.selectionStart!)).toBe(5);
  expect(await input.evaluate(n => getComputedStyle(n).userSelect)).toBe('text'); await input.press('Escape');
  const starts = await page.locator('main [class*="syncWords"]').evaluateAll(ns => ns.map(n => n.getBoundingClientRect().x)); expect(new Set(starts).size).toBe(1);
  await page.locator('main [data-line-id="bg"] [class*="syncOrdinal"]').click(); await expect(page.getByLabel('背景歌词', { exact: true })).toBeChecked();
});
test('edge dwell, middle and outside stop; stationary press never scrolls', async ({ page }) => {
  const rows = Array.from({ length: 120 }, (_, i) => `<p xml:id="l${i}"><span>Row${i}</span></p>`).join('');
  await load(page, true, `<tt xmlns="http://www.w3.org/ns/ttml"><body><div>${rows}</div></body></tt>`);
  const scroll = page.getByLabel('歌词列表', { exact: true }), box = (await scroll.boundingBox())!;
  const first = (await page.locator('main [data-line-id]').first().boundingBox())!;
  await page.mouse.move(first.x + 3, first.y + 3); await page.mouse.down();
  const initial = await scroll.evaluate(n => n.scrollTop); await page.waitForTimeout(500); expect(await scroll.evaluate(n => n.scrollTop)).toBe(initial);
  await page.mouse.move(box.x + 15, box.y + box.height - 5); await page.waitForTimeout(70); expect(await scroll.evaluate(n => n.scrollTop)).toBe(initial);
  await expect.poll(() => scroll.evaluate(n => n.scrollTop)).toBeGreaterThan(initial + 100);
  await page.mouse.move(box.x + 15, box.y + box.height / 2); const middle = await scroll.evaluate(n => n.scrollTop); await page.waitForTimeout(300); expect(await scroll.evaluate(n => n.scrollTop)).toBe(middle);
  await page.mouse.move(1430, box.y + box.height - 5); await page.waitForTimeout(250); expect(await scroll.evaluate(n => n.scrollTop)).toBe(middle);
  await page.keyboard.press('Escape'); await page.mouse.up(); await page.waitForTimeout(200); expect(await scroll.evaluate(n => n.scrollTop)).toBe(middle);
});
test('inspector only mounts fields for the effective object type', async ({ page }) => {
  await load(page);
  await word(page, 'A').click(); await expect(page.getByLabel('选中对象开始秒数')).toHaveValue('1'); await expect(page.getByLabel('跳过打轴', { exact: true })).toHaveCount(0); await expect(page.getByLabel('背景歌词', { exact: true })).toHaveCount(0);
  await page.locator('main [data-ruby-id="r1"]').click(); await expect(page.getByLabel('选中对象开始秒数')).toHaveValue('3'); await expect(page.getByLabel('背景歌词', { exact: true })).toHaveCount(0);
  await word(page, 'A').click(); await word(page, 'B').click({ modifiers: ['Control'] }); await expect(page.getByLabel('选中对象开始秒数')).toHaveCount(0); await expect(page.getByText('多对象时间可在时间轴整体平移；端点请单独调整。')).toBeVisible();
  await page.locator('main [data-line-id="a"] [class*="syncOrdinal"]').click(); await expect(page.getByLabel('跳过打轴', { exact: true })).toBeVisible(); await expect(page.getByLabel('行 a开始秒数')).toBeVisible();
});

test('word-only obscene toggles, undo and local recovery preserve plain/ruby/background words', async ({ page }) => {
  await load(page);
  for (const id of ['A', 'W', 'BG']) {
    await word(page, id).click(); const toggle = page.getByLabel('不雅用语', { exact: true }); await toggle.check();
    await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(toggle).not.toBeChecked();
    await page.getByRole('button', { name: '重做', exact: true }).click(); await expect(toggle).toBeChecked();
  }
  await page.locator('main [data-ruby-id="r1"]').click(); await expect(page.getByLabel('不雅用语', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.getByText('检查点已保存', { exact: true })).toBeVisible();
  page.on('dialog', d => d.accept()); await page.reload(); await page.getByRole('button', { name: '打轴', exact: true }).click();
  for (const id of ['A', 'W', 'BG']) { await word(page, id).click(); await expect(page.getByLabel('不雅用语', { exact: true })).toBeChecked(); }
  await expect(word(page, 'A')).toContainText('Alpha');
});

test('project canvas press on another visible row does not treat its own selection echo as a locate', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('/projects/sample-project/edit');
  const rows = Array.from({ length: 12 }, (_, i) => `<p xml:id="l${i}" begin="${i}" end="${i + 1}"><span studio:id="w${i}" begin="${i}" end="${i + 1}">Row${i}</span></p>`).join('');
  await importLyrics(page, { name: 'press.ttml', mimeType: 'application/xml', buffer: Buffer.from(`<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft"><body><div>${rows}</div></body></tt>`) });
  await page.getByRole('button', { name: '打轴', exact: true }).click();
  const scroll = page.getByLabel('歌词列表', { exact: true }); await scroll.evaluate(n => n.scrollTop = 90);
  const target = page.locator('main [data-word-id="w1"] [class*="syncBody"]');
  const box = (await target.boundingBox())!, before = await scroll.evaluate(n => n.scrollTop);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.waitForTimeout(800); expect(await scroll.evaluate(n => n.scrollTop)).toBe(before); await expect(page.locator('[data-object-drag]')).toHaveCount(0); await page.mouse.up();
  await page.locator('main [data-word-id="w2"] [class*="syncBody"]').dblclick();
  await expect(page.getByRole('textbox', { name: '词 Row2', exact: true })).toBeFocused();
});
