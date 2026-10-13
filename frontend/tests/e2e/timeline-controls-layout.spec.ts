import { expect, test } from '@playwright/test';
import { importLyrics } from '../fixtures/import-lyrics';
import { xml } from '../fixtures/timeline-word-properties';

for (const copy of [false, true]) test(`sync drags whole selected word set with configuration, copy=${copy}`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/projects/sample-project/edit?scenario=no-music');
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
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/projects/sample-project/edit?scenario=no-music');
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
