import { test, expect } from '@playwright/test';
import { importLyrics } from '../fixtures/import-lyrics';

test('automatic mora segmentation uses keyboard controls, applies once and supports undo', async ({ page }, testInfo) => {
  await page.goto('/projects/sample-project/edit?scenario=no-music');
  await importLyrics(page, { name: 'mora.txt', mimeType: 'text/plain', buffer: Buffer.from('しゃっティ') });
  await page.locator('[data-outline-drag]').first().click();
  await page.locator('[data-top-menu="tools"] summary').click();
  await page.getByRole('button', { name: '批处理', exact: true }).click();
  await page.getByRole('button', { name: '分词', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: '模式', exact: true }).selectOption('auto');
  const mora = dialog.getByRole('switch', { name: '按日语音拍合并小假名', exact: true });
  const cjk = dialog.getByRole('switch', { name: 'CJK 按字符切分', exact: true });
  await expect(mora).not.toBeChecked();
  await mora.focus(); await page.keyboard.press('Space'); await expect(mora).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('mora-light.png') });
  await cjk.uncheck(); await expect(mora).toBeDisabled();
  await cjk.check(); await expect(mora).toBeEnabled();
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await mora.focus();
  await page.screenshot({ path: testInfo.outputPath('mora-dark.png') });
  await dialog.getByRole('button', { name: '应用', exact: true }).click();
  await expect(page.locator('main [data-word-id]')).toHaveCount(3);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.locator('main [data-word-id]')).toHaveCount(1);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(page.locator('main [data-word-id]')).toHaveCount(3);
});
