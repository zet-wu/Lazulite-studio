import { expect, test } from '@playwright/test';
import { importLyrics } from '../../fixtures/import-lyrics';

test('real saved editor snapshot streams a verified music file directly and does not reset history', async ({ page }) => {
  await page.goto('/projects/music-packaging/edit');
  await importLyrics(page, {
    name: 'packaging.ttml',
    mimeType: 'application/xml',
    buffer: Buffer.from(
      '<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="1" end="3"><span begin="1" end="2">合成</span><span> </span><span begin="2" end="3">测试</span></p></body></tt>',
    ),
  });
  await page.getByRole('button', { name: '文件打包', exact: true }).click();
  await page.getByRole('tab', { name: '音乐文件嵌入', exact: true }).click();
  await expect(page.locator('[data-packaging-source]')).toContainText('M4A');
  await page.getByRole('combobox', { name: 'LRC → 元数据标签', exact: true }).selectOption('lrc');
  const button = page.getByRole('button', { name: '下载嵌入音频', exact: true });
  await expect(button).toBeEnabled();
  const download = page.waitForEvent('download');
  await button.click();
  expect((await download).suggestedFilename()).toMatch(/\.(m4a|mp4)$/);
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '词 合成', exact: true })).toHaveCount(0);
});

test('MP4 keeps an explicit no-LRC preference and allows untimed STPP', async ({ page }) => {
  await page.goto('/projects/music-packaging/edit');
  await importLyrics(page, {
    name: 'untimed.ttml',
    mimeType: 'application/xml',
    buffer: Buffer.from('<tt xmlns="http://www.w3.org/ns/ttml"><body><p><span>未定时</span></p></body></tt>'),
  });
  await page.getByRole('button', { name: '文件打包', exact: true }).click();
  await page.getByRole('tab', { name: '音乐文件嵌入', exact: true }).click();
  await page.getByRole('combobox', { name: 'LRC → 元数据标签', exact: true }).selectOption('lrc');
  await page.getByRole('button', { name: '下载嵌入音频', exact: true }).click();
  await expect(page.locator('#validation-panel-lyrics [data-blocking=true]')).toHaveCount(1);
  await page.getByRole('combobox', { name: 'LRC → 元数据标签', exact: true }).selectOption('none');
  await expect(page.locator('#validation-panel-lyrics [data-blocking=true]')).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载嵌入音频', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.(m4a|mp4)$/);
  await page.reload();
  await page.getByRole('button', { name: '文件打包', exact: true }).click();
  await page.getByRole('tab', { name: '音乐文件嵌入', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'LRC → 元数据标签', exact: true })).toHaveValue('none');
});
