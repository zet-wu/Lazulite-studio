import { expect, test, type Page } from '@playwright/test';
import { importLyrics } from '../fixtures/import-lyrics';
import { xml } from '../fixtures/timeline-word-properties';
async function load(page: Page, sync = true, data = xml) {
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/projects/sample-project/edit?scenario=no-music');
  await importLyrics(page, { name: 'timeline-word-properties.ttml', mimeType: 'application/xml', buffer: Buffer.from(data) });
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
  const ghost = page.locator('body > [class*="dragGhost"]');
  const checkInvalid = async () => {
    const valid = (await ghost.boundingBox())!;
    await page.mouse.move(1430, 180); await expect(mark).toBeHidden(); await expect(ghost).toHaveAttribute('data-drop-error');

    const invalid = (await ghost.boundingBox())!; expect(invalid.width).toBe(valid.width); expect(invalid.height).toBe(valid.height);
  };
  const left = await mark.boundingBox();
  for (const dx of [1, -1, 2, -2, 1]) { await page.mouse.move(box.x + box.width / 2 + dx, box.y + 3); await page.waitForTimeout(40); expect(await mark.boundingBox()).toEqual(left); }
  expect(await b.boundingBox()).toEqual(before);
  await page.mouse.move(box.x + box.width / 2 + 5, box.y + 3); await expect.poll(async () => (await mark.boundingBox())?.x).not.toBe(left?.x);
  await page.waitForTimeout(250); expect(await b.boundingBox()).toEqual(before);
  await checkInvalid();
  await page.mouse.up(); expect(await page.locator('main [data-word-id]').evaluateAll(ns => ns.map(n => n.getAttribute('data-word-id')))).toEqual(['A', 'B', 'W', 'BG']);
  const r = (await ruby.boundingBox())!; await page.mouse.move(r.x + 2, r.y + 2); await page.mouse.down();
  await page.mouse.move(box.x + 5, box.y + 3, { steps: 4 }); await expect(mark).toBeVisible(); expect(await b.boundingBox()).toEqual(before);
  await checkInvalid();
  await page.mouse.move(box.x + 5, box.y + 3); await expect(mark).toBeVisible(); await expect(ghost).not.toHaveAttribute('data-drop-error');

  await page.keyboard.press('Escape'); await page.mouse.up(); await expect(mark).toHaveCount(0);
});
test('edge dwell, middle and outside stop; stationary press never scrolls', async ({ page }) => {
  const rows = Array.from({ length: 120 }, (_, i) => `<p xml:id="l${i}"><span>Row${i}</span></p>`).join('');
  await load(page, true, `<tt xmlns="http://www.w3.org/ns/ttml"><body><div>${rows}</div></body></tt>`);
  const scroll = page.getByLabel('歌词列表', { exact: true }), box = (await scroll.boundingBox())!;
  const first = (await page.locator('main [data-line-id]').first().boundingBox())!;
  await page.mouse.move(first.x + 3, first.y + 3); await page.mouse.down();
  const initial = await scroll.evaluate(n => n.scrollTop); await page.waitForTimeout(500); expect(await scroll.evaluate(n => n.scrollTop)).toBe(initial);
  // Time dwell in the browser: the mouse command round trip can itself exceed 180ms.
  await scroll.evaluate(node => {
    window.addEventListener('pointermove', () => {
      const entered = performance.now();
      node.addEventListener('scroll', () => { node.dataset.firstEdgeScroll = String(performance.now() - entered); }, { once: true });
    }, { once: true });
  });
  await page.mouse.move(box.x + 15, box.y + box.height - 5);
  await expect.poll(() => scroll.evaluate(n => n.scrollTop)).toBeGreaterThan(initial + 100);
  expect(Number(await scroll.getAttribute('data-first-edge-scroll'))).toBeGreaterThanOrEqual(170);
  await page.mouse.move(box.x + 15, box.y + box.height / 2); const middle = await scroll.evaluate(n => n.scrollTop); await page.waitForTimeout(300); expect(await scroll.evaluate(n => n.scrollTop)).toBe(middle);
  await page.mouse.move(1430, box.y + box.height - 5); await page.waitForTimeout(250); expect(await scroll.evaluate(n => n.scrollTop)).toBe(middle);
  await page.keyboard.press('Escape'); await page.mouse.up(); await page.waitForTimeout(200); expect(await scroll.evaluate(n => n.scrollTop)).toBe(middle);
});

test('word-only obscene toggles and undo preserve plain/ruby/background words', async ({ page }) => {
  await load(page);
  for (const id of ['A', 'W', 'BG']) {
    await word(page, id).click(); const toggle = page.getByLabel('不雅用语', { exact: true }); await toggle.check();
    await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(toggle).not.toBeChecked();
    await page.getByRole('button', { name: '重做', exact: true }).click(); await expect(toggle).toBeChecked();
  }
  await page.locator('main [data-ruby-id="r1"]').click(); await expect(page.getByLabel('不雅用语', { exact: true })).toHaveCount(0);
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
