import { expect, test } from '@playwright/test';
import { importLyrics } from '../fixtures/import-lyrics';
for (const project of [false, true]) for (const count of [40, 120]) for (const kind of ['line', 'word']) test(`drag start and outside scrolling ${count} ${kind} project=${project}`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(project ? '/projects/sample-project/edit' : '/editor');
  const rows = Array.from({ length: count }, (_, i) => `<p xml:id="l${i}" begin="${i*3}" end="${i*3+2}"><span begin="${i*3}" end="${i*3+2}">Row${i}</span></p>`).join('');
  await importLyrics(page, { name: 'scroll.ttml', mimeType: 'application/xml', buffer: Buffer.from(`<tt xmlns="http://www.w3.org/ns/ttml"><body><div>${rows}</div></body></tt>`) });
  await page.getByRole('button', { name: '打轴', exact: true }).click();
  const scroll = page.getByLabel('歌词列表', { exact: true });
  await scroll.evaluate(n => n.scrollTop = 1800); await page.waitForTimeout(350);
  const bounds = (await scroll.boundingBox())!;
  const source = await page.locator(kind === 'line' ? 'main [data-line-id]' : 'main [data-word-id]').evaluateAll((ns,b) => {
    const n = ns.find(n => {const r=n.getBoundingClientRect(); return r.top > b.y+150 && r.bottom < b.y+b.height-100;})!;
    const r=n.getBoundingClientRect(); return {x:r.x+3,y:r.y+3};
  },bounds);
  const before = await scroll.evaluate(n => n.scrollTop);
  await page.mouse.move(source.x,source.y); await page.mouse.down(); await page.waitForTimeout(200);
  expect(await scroll.evaluate(n => n.scrollTop)).toBe(before);
  await page.mouse.move(source.x+8,source.y+8); await expect(page.locator('[data-object-drag]')).toHaveCount(1);
  await page.waitForTimeout(350); expect(await scroll.evaluate(n => n.scrollTop)).toBe(before);
  // Keep scrolling when the captured pointer crosses the pane boundary.
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y - 30);
  await expect.poll(() => scroll.evaluate(n => n.scrollTop)).toBeLessThan(before - 100);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  const middle = await scroll.evaluate(n => n.scrollTop); await page.waitForTimeout(250); expect(await scroll.evaluate(n => n.scrollTop)).toBe(middle);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height + 30);
  await expect.poll(() => scroll.evaluate(n => n.scrollTop)).toBeGreaterThan(middle + 100);
  await page.mouse.move(1430, bounds.y + bounds.height + 30);
  const stopped = await scroll.evaluate(n => n.scrollTop); await page.waitForTimeout(250); expect(await scroll.evaluate(n => n.scrollTop)).toBe(stopped);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height + 30);
  await page.keyboard.press('Escape'); await page.mouse.up();
  await page.waitForTimeout(250); expect(await scroll.evaluate(n => n.scrollTop)).toBe(stopped);
});

test('outline drag does not issue the outline click locate', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/projects/sample-project/edit?scenario=no-music');
  const rows = Array.from({ length: 120 }, (_, i) => `<p xml:id="l${i}"><span>Row${i}</span></p>`).join('');
  await importLyrics(page, { name: 'outline.ttml', mimeType: 'application/xml', buffer: Buffer.from(`<tt xmlns="http://www.w3.org/ns/ttml"><body><div>${rows}</div></body></tt>`) });
  await page.getByRole('button', { name: '打轴', exact: true }).click();
  const scroll = page.getByLabel('歌词列表', { exact: true });
  const source = page.locator('[data-outline-drag]').nth(20); await source.scrollIntoViewIfNeeded();
  const b=(await source.boundingBox())!, before=await scroll.evaluate(n=>n.scrollTop);
  await page.mouse.move(b.x+10,b.y+10); await page.mouse.down(); await page.mouse.move(b.x+18,b.y+10);
  await page.waitForTimeout(800); expect(await scroll.evaluate(n=>n.scrollTop)).toBe(before);
  await page.keyboard.press('Escape'); await page.mouse.up();
  await source.click(); await expect.poll(()=>scroll.evaluate(n=>n.scrollTop)).toBeGreaterThan(1000);
});

for (const count of [40, 120]) test(`word ghost stays outside layout through drop and undo, ${count} rows`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/projects/sample-project/edit');
  const rows = Array.from({ length: count }, (_, i) => `<p xml:id="l${i}"><span studio:id="a${i}">Alpha</span><span studio:id="b${i}">Beta</span></p>`).join('');
  await importLyrics(page, { name: 'ghost.ttml', mimeType: 'application/xml', buffer: Buffer.from(`<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft"><body><div>${rows}</div></body></tt>`) });
  await page.getByRole('button', { name: '打轴', exact: true }).click();
  const scroll = page.getByLabel('歌词列表', { exact: true }); await scroll.evaluate(n => n.scrollTop = 1800); await page.waitForTimeout(350);
  const bounds = (await scroll.boundingBox())!;
  const id = await page.locator('main [data-line-id]').evaluateAll((ns, b) => ns.find(n => { const r = n.getBoundingClientRect(); return r.top > b.y + 100 && r.bottom < b.y + b.height - 100; })!.getAttribute('data-line-id')!, bounds);
  const row = page.locator(`main [data-line-id="${id}"]`), a = row.locator('[data-word-id]').first(), b = row.locator('[data-word-id]').nth(1);
  const box = (await a.boundingBox())!, target = (await b.boundingBox())!;
  const measure = () => scroll.evaluate(n => ({ top: n.scrollTop, height: n.scrollHeight, width: n.clientWidth, pageHeight: document.documentElement.scrollHeight, pageWidth: document.documentElement.clientWidth }));
  const before = await measure(), rowBefore = await row.boundingBox();
  await page.mouse.move(box.x + 3, box.y + 30); await page.mouse.down(); await page.mouse.move(box.x + 11, box.y + 30);
  const ghost = page.locator('body > [class*="dragGhost"]'); await expect(ghost).toHaveCount(1);
  // The clone retains syncWord's class; its structural position must not override the overlay.
  await expect(ghost).toHaveCSS('position', 'fixed');
  const ghostBox = (await ghost.boundingBox())!; expect(ghostBox.x).toBeCloseTo(box.x + 8, 0); expect(ghostBox.y).toBeCloseTo(box.y, 0);
  await page.waitForTimeout(250); expect(await measure()).toEqual(before); expect(await row.boundingBox()).toEqual(rowBefore);
  await page.mouse.move(target.x + target.width - 3, target.y + 30); await page.mouse.up();
  await expect(ghost).toHaveCount(0); await expect(row.locator('[data-word-id]').first()).toHaveText(/Beta/);
  await page.waitForTimeout(250); expect((await measure()).top).toBe(before.top); expect(await row.boundingBox()).toEqual(rowBefore);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(row.locator('[data-word-id]').first()).toHaveText(/Alpha/);
});
