import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const largeKana = () => `<tt xmlns="http://www.w3.org/ns/ttml"><body><div>${Array.from({ length: 2000 }, (_, i) => {
  const a = i * .3;
  return `<p xml:id="k${i}" begin="${a.toFixed(3)}" end="${(a + .29).toFixed(3)}">${Array.from({ length: 10 }, (_, j) => `<span begin="${(a + j * .025).toFixed(3)}" end="${(a + j * .025 + .024).toFixed(3)}">か</span>`).join('')}${i === 0 ? '<span ttm:role="x-translation" xml:lang="zh-Hans">短</span>' : ''}</p>`;
}).join('')}</div></body></tt>`.replace('<tt xmlns=', '<tt xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns=');

test('production 2000-row translation draft and kana proposal keep bounded mounts and preserve one history', async ({ page }) => {
  await page.goto('/projects/no-music/edit'); await page.locator('input[type=file]').setInputFiles({ name: 'large-kana.ttml', mimeType: 'application/xml', buffer: Buffer.from(largeKana()) });
  const outline = page.locator('[data-outline-drag]'); await expect(outline).toHaveCount(2000);
  const text = page.locator('main section[data-line-id="k0"]').getByLabel('翻译 1', { exact: true });
  await text.fill('很长翻译 '.repeat(100));
  const main = page.locator('main'); await main.evaluate(e => { e.scrollTop = e.scrollHeight; });
  await expect(text).toBeFocused(); await expect(text).toHaveValue('很长翻译 '.repeat(100));
  expect(await page.locator('main section[data-line-id]').count()).toBeLessThan(80);
  await text.press('Escape'); await main.evaluate(e => { e.scrollTop = 0; });
  await outline.first().click(); await outline.last().click({ modifiers: ['Shift'] });
  await page.locator('[data-top-menu="tools"] summary').click();
  const began = Date.now(); await page.getByRole('button', { name: '生成日文罗马字音译…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '生成日文罗马字音译', exact: true }); await expect(dialog).toContainText('生成 2000 / 2000 行');
  const openedMs = Date.now() - began;
  const mounted = await page.locator('[data-roman-proposal]').count(); expect(mounted).toBeGreaterThan(0); expect(mounted).toBeLessThan(30);
  await dialog.locator('[data-proposal-count]').evaluate(e => { e.scrollTop = e.scrollHeight; });
  await expect(dialog.getByLabel('L2000音译')).toHaveValue('ka ka ka ka ka ka ka ka ka ka');
  await dialog.getByRole('button', { name: '取消', exact: true }).click(); await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await page.locator('[data-top-menu="tools"] summary').click(); await page.getByRole('button', { name: '生成日文罗马字音译…', exact: true }).click();
  const applied = Date.now(); await dialog.getByRole('button', { name: '生成音译', exact: true }).click();
  await expect(dialog).toHaveCount(0); const appliedMs = Date.now() - applied;
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await writeFile(test.info().outputPath('ruby-romanization-generation-performance.json'), JSON.stringify({ openedMs, appliedMs, mountedProposals: mounted, sourceRows: 2000, sourceWords: 20000, scope: 'Production build; Playwright interaction-to-visible-result wall time, not domain or next-RAF latency; no historical budget closure.' }, null, 2));
});
