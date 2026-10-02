import { test, expect } from '@playwright/test';
import { importLyrics } from '../fixtures/import-lyrics';
import { phase7Ttml } from '../fixtures/phase7';

test('inline annotation and bounded timing survive real save, reopen, undo and redo', async ({ page }) => {
  await page.goto('/projects/phase4-background/edit');
  await importLyrics(page, { name: 'phase2.ttml', mimeType: 'application/xml', buffer: Buffer.from(phase7Ttml) });
  await page.locator('[data-ruby-id]').first().click({ button: 'right', position: { x: 3, y: 3 } });
  await page.getByRole('menuitem', { name: '添加读音', exact: true }).click();
  await page.getByLabel('新增读音 学校').pressSequentially('test'); await page.keyboard.press('Enter');
  await expect(page.locator('[data-ruby-id]')).toHaveCount(5);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(page.locator('[data-ruby-id]')).toHaveCount(4);
  await page.getByRole('button', { name: '重做', exact: true }).click(); await expect(page.locator('[data-ruby-id]')).toHaveCount(5);
  await page.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByRole('textbox', { name: '读音 学校', exact: true }).nth(1)).toHaveValue('test');
  await expect(page.getByLabel('读音 test开始秒数')).toHaveValue('');
  await page.locator('[data-ruby-id]').last().click({ position: { x: 3, y: 3 } }); await page.getByRole('button', { name: '打轴', exact: true }).click();
  await page.getByLabel('打轴模式').selectOption('line');
  await page.locator('audio').evaluate((a: HTMLAudioElement) => { a.pause(); a.currentTime = 3.5; });
  await page.getByRole('button', { name: '连续轴', exact: true }).click(); await expect(page.getByText('本行已完成')).toBeVisible();
  await expect(page.getByLabel('词 しん开始秒数')).toHaveValue('4');
  await page.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByLabel('读音 う结束秒数')).toHaveValue('3.5');
  const xml = (await (await page.request.get('/api/v1/projects/phase4-background/document')).json()).document.lyrics.draftTtml;
  const values = await page.evaluate(async xml => {
    const path = '/src/adapters/ttml/lyric-codec.ts'; const codec = await import(path) as typeof import('../../src/adapters/ttml/lyric-codec');
    return codec.parseLyricTtml(xml).lines.map(line => ({ begin: line.beginMs, end: line.endMs }));
  }, xml);
  expect(values[0]).toEqual({ begin: 0, end: 4000 });
  expect(values[1]).toEqual({ begin: 4000, end: 6000 });
});
