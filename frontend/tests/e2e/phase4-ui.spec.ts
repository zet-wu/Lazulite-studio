import { importLyrics } from '../fixtures/import-lyrics';
import { expect, test, type Page, type Locator } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

async function load(page: Page, count = 3) {
  await page.goto('/projects/sample-project/edit?scenario=no-music');
  await importLyrics(page, { name: 'rows.txt', mimeType: 'text/plain', buffer: Buffer.from(Array.from({ length: count }, (_, i) => `行${i + 1}`).join('\n')) });
  await expect(page.locator('[data-outline-drag]')).toHaveCount(count);
}
async function begin(page: Page, from: Locator, to: Locator, after = true) {
  const a = (await from.boundingBox())!, b = (await to.boundingBox())!;
  await page.mouse.move(a.x + 3, a.y + 3); await page.mouse.down();
  await page.mouse.move(b.x + 3, b.y + (after ? b.height - 3 : 3), { steps: 8 });
}

test('UI append is empty, after the document, selected, reversible and keyboard accessible', async ({ page }) => {
  await load(page);
  await page.locator('[data-outline-drag]').first().click();
  const add = page.getByRole('button', { name: '新增歌词行', exact: true });
  await add.focus(); await add.press('Enter');
  await expect(page.locator('[data-outline-drag]')).toHaveCount(4);
  const last = page.locator('main section[data-line-id]').last();
  await expect(last).toHaveAttribute('aria-label', '歌词行 空行');
  await expect(page.locator('aside').filter({ has: page.getByRole('heading', { name: '属性' }) })).toContainText('L4');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.locator('[data-outline-drag]')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: '歌词编辑' })).toHaveCount(0);
  await page.locator('[data-top-menu="lyrics-settings"] summary').click();
  await page.getByRole('button', { name: '管理音译轨道…' }).click();
  await expect(page.getByRole('dialog', { name: '音译轨道管理' })).toBeVisible();
});

test('UI drag keeps source layout with an insertion line, commits once and cancels without history or selection residue', async ({ page }) => {
  await load(page);
  const rows = page.locator('main section[data-line-id]');
  const ids = await rows.evaluateAll(nodes => nodes.map(n => n.getAttribute('data-line-id')));
  await begin(page, rows.first(), rows.nth(1));
  await expect(page.locator('main [data-drag-placeholder]')).toHaveCount(1);
  await expect(page.locator('[aria-hidden="true"][inert]')).toHaveCount(1);
  expect(await page.evaluate(() => getSelection()?.toString())).toBe('');
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect(await rows.evaluateAll(nodes => nodes.map(n => n.getAttribute('data-line-id')))).toEqual(ids);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeEnabled();
  await begin(page, rows.first(), rows.nth(1));
  await expect(page.locator('main [data-drag-placeholder]')).toHaveCount(1);
  const preview = await rows.evaluateAll(nodes => nodes.map(n => n.getAttribute('data-line-id')));
  await page.mouse.up();
  expect(preview).toEqual(ids);
  expect(await rows.evaluateAll(nodes => nodes.map(n => n.getAttribute('data-line-id')))).toEqual([ids[1], ids[0], ids[2]]);
  await expect(page.locator('[data-drag-placeholder]')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await rows.evaluateAll(nodes => nodes.map(n => n.getAttribute('data-line-id')))).toEqual(ids);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeEnabled();
  const input = rows.first().getByRole('textbox', { name: '词 行1', exact: true });
  await input.dblclick(); await input.press('ControlOrMeta+A');
  expect(await input.evaluate((node: HTMLInputElement) => node.selectionEnd! - node.selectionStart!)).toBe(2);
});

test('UI copy keeps source, outline drag has the same placement and reduced motion works', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await load(page);
  const rows = page.locator('main section[data-line-id]');
  await page.keyboard.down('Alt'); await begin(page, rows.last(), rows.first(), false);
  await expect(rows).toHaveCount(3);
  await expect(rows.last()).toHaveAttribute('data-drag-placeholder', '');
  await page.mouse.up(); await page.keyboard.up('Alt');
  await expect(rows.first()).toHaveAttribute('aria-label', '歌词行 行3');
  await expect(rows.last()).toHaveAttribute('aria-label', '歌词行 行3');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  const outline = page.locator('[data-outline-drag]');
  await begin(page, outline.last(), outline.first(), false); await page.mouse.up();
  await expect(rows.first()).toHaveAttribute('aria-label', '歌词行 行3');
});

test('UI virtual append remains at the true end and long-document drag stays virtual', async ({ page }) => {
  test.setTimeout(60_000); await load(page, 2000);
  const rows = page.locator('main section[data-line-id]');
  await expect(rows.first()).toBeVisible();
  const start = Date.now(); await begin(page, rows.first(), rows.nth(1));
  await expect(page.locator('main [data-drag-placeholder]')).toHaveCount(1);
  const previewMs = Date.now() - start;
  expect(await rows.count()).toBeLessThan(80); await page.mouse.up();
  const scroll = page.getByLabel('歌词列表', { exact: true });
  await scroll.evaluate(node => node.scrollTop = node.scrollHeight);
  const add = page.getByRole('button', { name: '新增歌词行', exact: true });
  await add.click();
  await expect(page.locator('[data-outline-drag]')).toHaveCount(2001);
  await expect(rows.last()).toHaveAttribute('aria-label', '歌词行 空行');
  await expect(rows.last()).toBeInViewport(); expect(await rows.count()).toBeLessThan(80);
  await writeFile(test.info().outputPath('virtual.json'), JSON.stringify({ previewIncludingMouseStepsMs: previewMs, mounted: await rows.count() }));
});

for (const theme of ['light', 'dark']) for (const width of [1280, 1440, 1920]) test(`UI surfaces ${theme} ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await page.goto('/projects/sample-project/edit?scenario=no-music');
  await importLyrics(page, { name: 'ruby.ttml', mimeType: 'application/xml', buffer: await readFile('../tests/fixtures/ttml/phase2-multitrack.ttml') });
  await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
  await page.screenshot({ path: test.info().outputPath('editor.png') });
  await page.locator('[data-top-menu="tools"] summary').click();
  await page.getByRole('button', { name: '从音译生成 注音…' }).click();
  const dialog = page.getByRole('dialog', { name: '从音译生成 注音' });
  await expect(dialog.getByRole('button', { name: '生成 注音', exact: true })).toBeInViewport();
  await expect(dialog.getByText(/与正文相同|时间包络|原音译轨道会保留|切换字符输出将/)).toHaveCount(0);
  expect(await dialog.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: test.info().outputPath('ruby.png') });
});

test('UI empty document and background tail append both remain usable after undo', async ({ page }) => {
  await load(page, 1);
  await page.locator('main section[data-line-id]').click({ button: 'right', position: { x: 3, y: 3 } });
  await page.getByRole('menuitem', { name: '删除行', exact: true }).click();
  await expect(page.locator('[data-outline-drag]')).toHaveCount(0);
  const add = page.getByRole('button', { name: '新增歌词行', exact: true });
  await add.click(); await expect(page.locator('[data-outline-drag]')).toHaveCount(1);
  await expect(page.locator('main section[data-line-id] [data-word-id]')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.locator('[data-outline-drag]')).toHaveCount(0); await expect(add).toBeVisible();
  await add.click(); await add.click();
  await page.getByLabel('背景歌词', { exact: true }).check();
  await expect(page.locator('[data-outline-drag]').last()).toContainText('背景');
  await add.click(); await expect(page.locator('[data-outline-drag]')).toHaveCount(3);
  await expect(page.locator('[data-outline-drag]').last()).toHaveText('L2空行');
  await expect(page.getByLabel('背景歌词', { exact: true })).not.toBeChecked();
});

test('UI word to empty line, 注音 and romanization drags use the same insertion slots', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/projects/sample-project/edit?scenario=no-music');
  await importLyrics(page, { name: 'ruby.ttml', mimeType: 'application/xml', buffer: await readFile('../tests/fixtures/ttml/phase2-multitrack.ttml') });
  const line = page.locator('main section[data-line-id="line-a"]'), units = line.locator('[data-romanization-content-id]').first().locator('[data-romanization-unit-id]');
  const ids = await units.evaluateAll(nodes => nodes.map(n => n.getAttribute('data-romanization-unit-id')));
  const a = (await units.last().boundingBox())!, b = (await units.first().boundingBox())!;
  await page.mouse.move(a.x + 2, a.y + 2); await page.mouse.down(); await page.mouse.move(b.x + 2, b.y + 2, { steps: 5 });
  await expect(line.locator('[data-drag-placeholder]')).toHaveCount(1); await page.mouse.up();
  expect(await units.evaluateAll(nodes => nodes.map(n => n.getAttribute('data-romanization-unit-id')))).toEqual([ids[2], ids[0], ids[1]]);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  // Contents remain within their existing track; an out-of-track target is invalid.
  const contents = line.locator('[data-romanization-content-id]');
  await begin(page, contents.first(), contents.nth(1)); await page.mouse.up();
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeEnabled();
  await contents.first().getByText('音译 · ja-Latn').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '从音译生成 注音…' }).click();
  await page.getByRole('button', { name: '生成 注音', exact: true }).click();
  const rubies = line.locator('[data-ruby-id]');
  const r = (await rubies.last().boundingBox())!, t = (await rubies.first().boundingBox())!;
  await page.mouse.move(r.x + 2, r.y + 2); await page.mouse.down(); await page.mouse.move(t.x + 2, t.y + 2, { steps: 5 });
  await expect(line.locator('[data-drag-placeholder]')).toHaveCount(1); await page.mouse.up();
  await expect(rubies.first().getByRole('textbox').first()).toHaveValue('り');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(rubies.first().getByRole('textbox').first()).toHaveValue('ふ');
  // Preserve the source singer when moving to a line without an inherited singer.
  await page.locator('[data-top-menu=settings] > summary').click();
  await page.getByRole('switch', { name: '禁用词级歌手', exact: true }).uncheck();
  await page.keyboard.press('Escape');
  // Add a real empty container and move its predecessor's word into it.
  const add = page.getByRole('button', { name: '新增歌词行', exact: true }); await add.click();
  const rows = page.locator('main section[data-line-id]');
  const emptyId = await rows.last().getAttribute('data-line-id');
  await page.locator('[data-outline-drag]').nth(1).click();
  const source = page.locator('main section[data-line-id="line-b"] [data-word-id]').first();
  await expect(source).toBeVisible();
  const empty = page.locator(`main section[data-line-id="${emptyId}"]`);
  await empty.scrollIntoViewIfNeeded(); await source.scrollIntoViewIfNeeded();
  await begin(page, source, empty, false);
  await expect(source).toHaveAttribute('data-drag-placeholder', ''); await page.mouse.up();
  await expect(empty.locator('[data-word-id]')).toHaveCount(1);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(empty.locator('[data-word-id]')).toHaveCount(0);
});

test('UI pointercancel and lost capture restore layout, modifiers preserve object selection', async ({ page }) => {
  await load(page);
  const rows = page.locator('main section[data-line-id]');
  for (const event of ['pointercancel', 'lostpointercapture']) {
    await begin(page, rows.first(), rows.nth(1));
    await expect(page.locator('main [data-drag-placeholder]')).toHaveCount(1);
    await page.locator('[data-object-drag]').dispatchEvent(event, { pointerId: 1 }); await page.mouse.up();
    await expect(page.locator('[data-drag-placeholder]')).toHaveCount(0);
    await expect(rows.first()).toHaveAttribute('aria-label', '歌词行 行1');
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeEnabled();
  }
  const outline = page.locator('[data-outline-drag]');
  await outline.first().click(); await outline.last().click({ modifiers: ['Shift'] });
  await expect(page.getByText('行已选 3', { exact: true })).toBeVisible();
  await outline.nth(1).click({ modifiers: ['ControlOrMeta'] });
  await expect(page.getByText('行已选 2', { exact: true })).toBeVisible();
});

test('UI wrapped words preview their actual first slot and virtual edge scrolling cleans up', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('/projects/sample-project/edit?scenario=no-music');
  const xml = `<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p xml:id="wrap">${Array.from({ length: 9 }, (_, i) => `<span>词${i}</span>`).join('')}</p></div></body></tt>`;
  await importLyrics(page, { name: 'wrap.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  const words = page.locator('main [data-word-id]'); await expect(words).toHaveCount(9);
  const a = (await words.last().boundingBox())!, b = (await words.first().boundingBox())!;
  expect(a.y).toBeGreaterThan(b.y);
  await page.mouse.move(a.x + 2, a.y + 2); await page.mouse.down(); await page.mouse.move(b.x + 2, b.y + 2, { steps: 6 });
  await expect(words.last()).toHaveAttribute('data-drag-placeholder', '');
  await page.mouse.up(); await expect(words.first().getByRole('textbox', { name: '词 词8', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(words.first().getByRole('textbox', { name: '词 词0', exact: true })).toBeVisible();
  await load(page, 2000);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  const rows = page.locator('main section[data-line-id]'), scroll = page.getByLabel('歌词列表', { exact: true });
  const source = (await page.locator('[data-outline-drag]').first().boundingBox())!, box = (await scroll.boundingBox())!;
  await page.mouse.move(source.x + 3, source.y + 3); await page.mouse.down();
  await page.mouse.move(box.x + 12, box.y + box.height - 8, { steps: 8 });
  await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBeGreaterThan(200);
  expect(await rows.count()).toBeLessThan(80);
  await page.keyboard.press('Escape'); await page.mouse.up();
  const top = await scroll.evaluate(node => node.scrollTop);
  await page.waitForTimeout(100); expect(await scroll.evaluate(node => node.scrollTop)).toBe(top);
  await expect(page.locator('[data-drag-placeholder]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeEnabled();
});
