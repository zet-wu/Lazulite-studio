import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { largeKana, longRuby } from '../fixtures/phase8';
test('P8 production 2000 proposals retain focused input and edits across virtual remounts', async ({ page }) => {
  await page.goto('/editor'); await page.locator('input[type=file]').setInputFiles({ name: 'large.ttml', mimeType: 'application/xml', buffer: Buffer.from(largeKana()) });
  const outline = page.locator('[data-outline-drag]'); await expect(outline).toHaveCount(2000);
  await outline.first().click(); await outline.last().click({ modifiers: ['Shift'] }); await page.locator('[data-top-menu="tools"] summary').click();
  const start = Date.now(); await page.getByRole('button', { name: '生成日文罗马字音译…' }).click();
  const dialog = page.getByRole('dialog', { name: '生成日文罗马字音译', exact: true }); await expect(dialog.getByLabel('L1音译', { exact: true })).toHaveValue('ka ka ka ka ka ka ka ka ka ka');
  const openedMs = Date.now() - start, mounted = await dialog.locator('[data-roman-proposal]').count(); expect(mounted).toBeLessThan(30);
  const modeStart = Date.now(); await dialog.getByLabel('输出', { exact: true }).selectOption('timed'); await expect(dialog.getByLabel('L1单元 1音译')).toHaveValue('ka '); const modeMs = Date.now() - modeStart;
  const input = dialog.getByLabel('L1单元 1音译'); await input.fill('manual  ');
  const scroll = dialog.locator('[data-proposal-count]'); await scroll.evaluate(e => { e.scrollTop = e.scrollHeight; });
  await expect(input).toBeFocused(); await expect(input).toHaveValue('manual  '); await expect(dialog.getByLabel('L2000单元 1音译')).toHaveValue('ka ');
  const pinnedMounts = await dialog.locator('[data-roman-proposal]').count(); expect(pinnedMounts).toBeLessThan(30);
  await dialog.getByLabel('L2000单元 1音译').fill('tail'); await expect(input).toHaveCount(0);
  await scroll.evaluate(e => { e.scrollTop = 0; }); await expect(input).toHaveValue('manual  ');
  const applyStart = Date.now(); await dialog.getByRole('button', { name: '生成音译', exact: true }).click(); await expect(dialog).toHaveCount(0); const appliedMs = Date.now() - applyStart;
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await writeFile(test.info().outputPath('phase8-performance.json'), JSON.stringify({ openedMs, modeMs, appliedMs, mounted, pinnedMounts, sourceRows: 2000, sourceUnits: 20000, scope: 'Production Linux Chromium; Playwright action-to-visible wall time, not next-RAF latency or closure of historical budgets.' }, null, 2));
});
test('P8 production one long word retains all 512 注音-derived inputs without horizontal dialog overflow', async ({ page }) => {
  await page.goto('/editor'); await page.locator('input[type=file]').setInputFiles({ name: 'long.ttml', mimeType: 'application/xml', buffer: Buffer.from(longRuby()) });
  await page.locator('[data-outline-drag]').first().click({ button: 'right' }); const start = Date.now(); await page.getByRole('menuitem', { name: '生成日文罗马字音译…' }).click();
  const dialog = page.getByRole('dialog', { name: '生成日文罗马字音译', exact: true }); await dialog.getByLabel('输出', { exact: true }).selectOption('timed');
  await expect(dialog.getByRole('textbox')).toHaveCount(512); await expect(dialog.locator('[data-source-word]')).toHaveCount(1);
  expect((await dialog.getByText('長い正文', { exact: true }).boundingBox())!.height).toBeLessThan(40);
  const openedMs = Date.now() - start; await dialog.getByLabel('L1单元 512音译').fill('tail');
  const alignment = await dialog.locator('[data-source-word]').evaluate(word => {
    const center = (element: Element) => { const box = element.getBoundingClientRect(); return box.x + box.width / 2; };
    const sources = Array.from(word.querySelectorAll('[data-source-unit]'));
    const inputs = new Map(Array.from(word.querySelectorAll('[data-generated-unit]')).map(input => [input.getAttribute('data-generated-unit'), input.firstElementChild!]));
    const body = document.createRange(); body.selectNodeContents(word.querySelector('[class*=romanPreviewBody]')!);
    const box = body.getBoundingClientRect();
    return {
      maxUnitCenterDifference: Math.max(...sources.map(source => Math.abs(center(source.firstElementChild!) - center(inputs.get(source.getAttribute('data-source-unit'))!)))),
      bodyCenterDifference: Math.abs(box.x + box.width / 2 - center(word)),
      maxSourceInputDistance: Math.max(...sources.map(source => inputs.get(source.getAttribute('data-source-unit'))!.getBoundingClientRect().top - source.getBoundingClientRect().top)),
    };
  });
  expect(alignment.maxUnitCenterDifference).toBeLessThan(1); expect(alignment.bodyCenterDifference).toBeLessThan(1);
  expect(alignment.maxSourceInputDistance).toBeLessThan(100);
  const geometry = await dialog.evaluate(e => ({ width: e.clientWidth, scroll: e.scrollWidth })); expect(geometry.scroll).toBeLessThanOrEqual(geometry.width);
  await page.screenshot({ path: test.info().outputPath('long-proposal.png') });
  await dialog.locator('[class*=dialogBody]').evaluate(e => { e.scrollTop = 0; });
  await page.screenshot({ path: test.info().outputPath('long-proposal-top.png') });
  await dialog.getByRole('button', { name: '生成音译', exact: true }).click(); await expect(page.getByLabel('音译单元 512', { exact: true })).toHaveValue('tail');
  await writeFile(test.info().outputPath('long-proposal.json'), JSON.stringify({ openedMs, sourceWords: 1, sourceUnits: 512, geometry, alignment }, null, 2));
});
