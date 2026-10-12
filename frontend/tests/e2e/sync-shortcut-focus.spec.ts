import { expect, test } from '@playwright/test';
import { importLyrics } from '../fixtures/import-lyrics';
import { japaneseReadingTtml } from '../fixtures/japanese-reading';

for (const startKey of ['s', 'Shift+G']) test(`timing keys work after button clicks (${startKey})`, async ({ page }) => {
  await page.goto('/projects/sample-project/edit');
  await importLyrics(page, { name: 'ruby.ttml', mimeType: 'application/xml', buffer: Buffer.from(japaneseReadingTtml) });
  if (startKey !== 's') {
    await page.locator('[data-top-menu="settings"] summary').click();
    await page.getByRole('button', { name: '快捷键设置', exact: true }).click();
    await page.getByRole('textbox', { name: '起始轴快捷键' }).click();
    await page.keyboard.press(startKey);
    await page.keyboard.press('Escape');
  }
  await page.locator('[data-ruby-id]').first().click({ position: { x: 3, y: 3 } });
  await page.getByRole('button', { name: '打轴', exact: true }).click();
  await page.locator('audio').evaluate((a: HTMLAudioElement) => { a.currentTime = .25; });
  await page.keyboard.press(startKey);
  await expect(page.getByLabel('选中对象开始秒数')).toHaveValue('0.25');
  const panel = page.getByRole('region', { name: '连续打轴' });
  await panel.getByRole('button', { name: '起始轴', exact: true }).click();
  await page.locator('audio').evaluate((a: HTMLAudioElement) => { a.currentTime = .75; });
  await page.keyboard.press('d');
  await expect(page.getByLabel('选中对象开始秒数')).toHaveValue('0.75');
  await page.locator('audio').evaluate((a: HTMLAudioElement) => { a.currentTime = 1.25; });
  await page.keyboard.press('f');
  await expect(panel).toContainText('单元 3 / 4');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByLabel('读音 っ结束秒数')).toHaveValue('1.25');
  await page.getByRole('button', { name: '打轴', exact: true }).click();
  await page.getByRole('button', { name: /^A / }).click();
  await page.locator('audio').evaluate((a: HTMLAudioElement) => { a.currentTime = 2.25; });
  await page.keyboard.press(startKey);
  await expect(page.getByLabel('选中对象开始秒数')).toHaveValue('2.25');
  await panel.getByRole('button', { name: '上一单元', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(panel).toContainText('单元 2 / 4');
  await page.keyboard.press('ArrowRight');
  await expect(panel).toContainText('单元 3 / 4');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByLabel('选中对象开始秒数')).toHaveValue('2');
});

