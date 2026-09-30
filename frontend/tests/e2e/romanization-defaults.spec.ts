import { expect, test, type Page } from '@playwright/test';
import { phase7Ttml } from '../fixtures/phase7';

async function generate(page: Page) {
  await page.locator('[data-outline-drag]').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '生成日文罗马字音译…' }).click();
  return page.getByRole('dialog', { name: '生成日文罗马字音译', exact: true });
}

test('Local file mode survives reopening and reload, without sharing across filenames', async ({ page }) => {
  await page.goto('/editor');
  const load = (name: string) => page.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/xml', buffer: Buffer.from(phase7Ttml) });
  await load('first.ttml'); let dialog = await generate(page);
  await expect(dialog.getByLabel('输出', { exact: true })).toHaveValue('plain');
  await dialog.getByLabel('输出', { exact: true }).selectOption('timed');
  await dialog.getByLabel('L1单元 1音译').fill('discarded');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  dialog = await generate(page);
  await expect(dialog.getByLabel('输出', { exact: true })).toHaveValue('timed');
  await expect(dialog.getByLabel('L1单元 1音译')).toHaveValue('ga ');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await load('second.ttml'); dialog = await generate(page);
  await expect(dialog.getByLabel('输出', { exact: true })).toHaveValue('plain');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.reload(); await load('first.ttml'); dialog = await generate(page);
  await expect(dialog.getByLabel('输出', { exact: true })).toHaveValue('timed');
  await dialog.getByLabel('输出', { exact: true }).selectOption('plain');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  dialog = await generate(page);
  await expect(dialog.getByLabel('输出', { exact: true })).toHaveValue('plain');
});
