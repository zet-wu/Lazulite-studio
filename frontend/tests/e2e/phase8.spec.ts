import { expect, test, type Page } from '@playwright/test';
import { phase7Ttml } from '../fixtures/phase7';
import { phase6Ttml } from '../fixtures/phase6';
export async function load(page: Page, xml = phase7Ttml) {
  await page.goto('/editor');
  await page.locator('input[type=file]').setInputFiles({ name: 'phase8.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
}
async function edge(page: Page, selector: string, index: number, options: { button?: 'right'; modifiers?: ('Shift' | 'Control' | 'Meta')[] } = {}) {
  await page.locator(selector).nth(index).click({ position: { x: 3, y: 3 }, ...options });
}
test('P8 real Ruby range, passive right focus, batch delete and one undo', async ({ page }) => {
  await load(page);
  await edge(page, '[data-ruby-id]', 0); await edge(page, '[data-ruby-id]', 1, { modifiers: ['Shift'] });
  await expect(page.getByText('Ruby已选 2', { exact: true })).toBeVisible();
  await page.getByLabel('读音 学校', { exact: true }).nth(1).click({ button: 'right' });
  await expect(page.getByText('Ruby已选 2', { exact: true })).toBeVisible();
  await edge(page, '[data-ruby-id]', 0, { button: 'right' });
  await page.getByRole('menuitem', { name: '删除所选读音（2）' }).click();
  await expect(page.locator('[data-ruby-id]')).toHaveCount(2);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(page.locator('[data-ruby-id]')).toHaveCount(4);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
});
test('P8 cross-line word range, right-click outside and clipboard remains after direct deletion', async ({ page }) => {
  await load(page);
  const words = page.locator('main [data-word-id]');
  await words.nth(1).getByLabel('词 しん', { exact: true }).click();
  await page.locator('[data-top-menu="clipboard"] summary').click(); await page.getByRole('button', { name: '复制', exact: true }).click();
  await edge(page, 'main [data-word-id]', 0); await edge(page, 'main [data-word-id]', 1, { modifiers: ['Shift'] });
  await expect(page.getByText('词已选 2', { exact: true })).toBeVisible();
  await page.getByLabel('词 しん', { exact: true }).click({ button: 'right' }); await expect(page.getByText('词已选 2', { exact: true })).toBeVisible();
  await edge(page, 'main [data-word-id]', 0, { button: 'right' });
  await page.getByRole('menuitem', { name: '删除所选词（2）' }).click(); await expect(words).toHaveCount(2);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(words).toHaveCount(4);
  await edge(page, 'main [data-word-id]', 3, { button: 'right' }); await page.getByRole('menuitem', { name: '粘贴', exact: true }).click();
  await expect(page.getByLabel('词 しん', { exact: true })).toHaveCount(2);
  await page.locator('[data-top-menu="clipboard"] summary').click(); await page.getByRole('button', { name: '清空选择', exact: true }).click();
  await page.locator('[data-top-menu="clipboard"] summary').click(); await expect(page.getByRole('button', { name: '删除', exact: true })).toBeDisabled();
});
test('P8 Ctrl and Cmd toggle timed units and content delete preserves native typing', async ({ page }) => {
  await load(page, phase6Ttml());
  const units = 'main [data-line-id="english"] [data-romanization-unit-id]';
  await edge(page, units, 0); await edge(page, units, 1, { modifiers: ['Control'] });
  await expect(page.getByText('音译单元已选 2', { exact: true })).toBeVisible();
  await edge(page, units, 2, { modifiers: ['Meta'] }); await expect(page.getByText('音译单元已选 3', { exact: true })).toBeVisible();
  await edge(page, units, 1, { button: 'right' }); await page.getByRole('menuitem', { name: '删除所选单元（3）' }).click(); await expect(page.locator(units)).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(page.locator(units)).toHaveCount(3);
});
