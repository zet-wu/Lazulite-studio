import { expect, test } from '@playwright/test';
import { importLyrics } from '../fixtures/import-lyrics';
import { xml } from '../fixtures/timeline-phase3';

test('uniform three-digit gutters, scaled filled markers and body add controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/editor');
  const data = xml.replace('<p xml:id="empty"/>', Array.from({ length: 100 }, (_, i) => `<p xml:id="tail${i}"><span>尾${i}</span></p>`).join(''));
  await importLyrics(page, { name: 'gutter.ttml', mimeType: 'application/xml', buffer: Buffer.from(data) });
  await page.getByRole('button', { name: '打轴', exact: true }).click();
  const a = page.locator('main [data-word-id="A"]'); await a.click({ button: 'right' }); await page.getByRole('menuitem', { name: '添加空拍', exact: true }).click();
  for (const zoom of [1, 1.25, 1.5]) for (const theme of ['light', 'dark']) {
    await page.evaluate(({ zoom, theme }) => { document.body.style.zoom = String(zoom); document.documentElement.dataset.theme = theme; }, { zoom, theme });
    const starts = await page.locator('main [class*="syncWords"]').evaluateAll(ns => ns.map(n => n.getBoundingClientRect().x));
    expect(Math.max(...starts) - Math.min(...starts)).toBeLessThan(1);
    const beat = a.locator('[data-sync-marker="beat"]'), rect = await beat.locator('rect').boundingBox(), hit = await beat.boundingBox();
    expect(rect!.width).toBeCloseTo(3 * zoom, 1); expect(hit!.width).toBeGreaterThan(rect!.width * 3);
    const line = page.locator('main [data-line-id="a"]'), add = line.getByRole('button', { name: '添加词', exact: true });
    const body = await a.locator('[class*="syncBody"]').boundingBox(), plus = await add.boundingBox();
    // When wrapped, the next visual row retains the same three-layer grid.
    expect((plus!.y - body!.y) / zoom).toBeGreaterThanOrEqual(-1);
    await page.screenshot({ path: test.info().outputPath(`scaled-${theme}-${zoom}.png`) });
  }
});

test('menus and split boundaries use SVG while preserving state and original text', async ({ page }) => {
  await page.goto('/editor'); await importLyrics(page, { name: 'icons.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await page.locator('[data-top-menu="view"] summary').click();
  const outline = page.getByRole('button', { name: '显示大纲', exact: true }); await expect(outline).toHaveAttribute('aria-pressed', 'true'); await expect(outline.locator('svg')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.locator('main [data-word-id="A"]').click({ position: { x: 2, y: 2 } });
  await page.locator('[data-top-menu="tools"] summary').click(); await page.getByRole('button', { name: '分词…', exact: true }).click();
  const boundary = page.getByRole('button', { name: '切分边界 1', exact: true }); await expect(boundary.locator('circle')).toHaveCount(1); await boundary.click(); await expect(boundary.locator('rect')).toHaveCount(1); await expect(boundary).toHaveAttribute('aria-pressed', 'true');
  const parts = page.locator('[class*="segmentParts"]'); await expect(parts).toHaveText('Alpha'); await expect(parts.locator('svg')).toHaveCount(1);
});

for (const copy of [false, true]) test(`sync drags whole selected word set with configuration, copy=${copy}`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/editor');
  await importLyrics(page, { name: 'group.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await page.getByRole('button', { name: '打轴', exact: true }).click();
  const line = page.locator('main [data-line-id="a"]'), a = line.locator('[data-word-id="A"]'), b = line.locator('[data-word-id="B"]');
  await a.click({ button: 'right' }); await page.getByRole('menuitem', { name: '添加空拍', exact: true }).click();
  await a.click(); await page.getByLabel('不雅用语', { exact: true }).check(); await b.click({ modifiers: ['Shift'] });
  await expect(line.locator('[data-word-id][data-selected]')).toHaveCount(2);
  const source = (await a.boundingBox())!, target = (await line.locator('[data-word-id="W"]').boundingBox())!;
  if (copy) await page.keyboard.down('Alt');
  await page.mouse.move(source.x + 2, source.y + 2); await page.mouse.down(); await page.mouse.move(target.x + target.width - 1, target.y + 35, { steps: 8 });
  await expect(page.locator('[class*="dragInsertion"]')).toBeVisible();
  expect(await line.locator('[data-word-id]').evaluateAll(ns => ns.map(n => n.getAttribute('data-word-id')))).toEqual(['A', 'B', 'W']);
  await page.mouse.up(); if (copy) await page.keyboard.up('Alt');
  const words = line.locator('[data-word-id]'); await expect(words).toHaveCount(copy ? 5 : 3);
  const ids = await words.evaluateAll(ns => ns.map(n => n.getAttribute('data-word-id')));
  if (copy) { expect(ids.slice(0, 3)).toEqual(['A', 'B', 'W']); expect(ids[3]).not.toBe('A'); }
  else expect(ids).toEqual(['W', 'A', 'B']);
  const moved = words.nth(copy ? 3 : 1); await expect(moved.locator('[data-sync-marker="beat"]')).toHaveCount(1); await line.locator('[data-word-id="W"]').click(); await moved.click(); await expect(page.getByLabel('不雅用语', { exact: true })).toBeChecked();
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(words).toHaveCount(3);
  expect(await words.evaluateAll(ns => ns.map(n => n.getAttribute('data-word-id')))).toEqual(['A', 'B', 'W']);
  await expect(a.locator('[data-sync-marker="beat"]')).toHaveCount(1);
});

test('drag remeasures after virtual mounting and commits to the visible row', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/editor');
  const rows = Array.from({ length: 120 }, (_, i) => `<p xml:id="l${i}"><span>Row${i}</span></p>`).join('');
  await importLyrics(page, { name: 'virtual.ttml', mimeType: 'application/xml', buffer: Buffer.from(`<tt xmlns="http://www.w3.org/ns/ttml"><body><div>${rows}</div></body></tt>`) });
  await page.getByRole('button', { name: '打轴', exact: true }).click();
  const scroll = page.getByLabel('歌词列表', { exact: true }), box = (await scroll.boundingBox())!, first = (await page.locator('main [data-line-id="l0"]').boundingBox())!;
  await page.mouse.move(first.x + 3, first.y + 3); await page.mouse.down(); await page.mouse.move(box.x + 15, box.y + box.height - 3);
  await expect.poll(() => scroll.evaluate(n => n.scrollTop)).toBeGreaterThan(450);
  await page.mouse.move(box.x + 15, box.y + box.height / 2);
  const target = await page.locator('main [data-line-id]').evaluateAll((ns, bounds) => {
    const node = ns.find(n => { const r = n.getBoundingClientRect(); return r.top > bounds.y + 60 && r.bottom < bounds.y + bounds.height - 60; })!;
    const r = node.getBoundingClientRect(); return { id: node.getAttribute('data-line-id')!, x: r.x + 3, y: r.bottom - 3 };
  }, box);
  await page.mouse.move(target.x, target.y); await expect(page.locator('[class*="dragInsertion"]')).toBeVisible(); await page.mouse.up();
  const ids = await page.locator('[data-outline-drag]').evaluateAll(ns => ns.map(n => n.parentElement!.getAttribute('data-line-id')));
  expect(ids[ids.indexOf(target.id) + 1]).toBe('l0');
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(page.locator('[data-outline-drag]').first()).toContainText('Row0');
});
