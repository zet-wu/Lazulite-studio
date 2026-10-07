import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { importLyrics } from '../fixtures/import-lyrics';
import { xml } from '../fixtures/timeline-phase3';

test('word flags save to actual service, reopen and exchange formal TTML without changing text', async ({ page }) => {
  await page.goto('/projects/phase4-background/edit');
  // Formal export needs times on every line; omit the intentionally empty draft row.
  await importLyrics(page, { name: 'flag.ttml', mimeType: 'application/xml', buffer: Buffer.from(xml.replace('<p xml:id="empty"/>', '')) });
  await page.getByRole('button', { name: '打轴', exact: true }).click();
  for (const id of ['A', 'W', 'BG']) { await page.locator(`main [data-word-id="${id}"]`).click(); await page.getByLabel('不雅用语', { exact: true }).check(); }
  await page.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  const envelope = await (await page.request.get('/api/v1/projects/phase4-background/document')).json();
  expect(envelope.document.lyrics.draftTtml.match(/amll:obscene="true"/g)).toHaveLength(3);
  await page.reload(); await page.getByRole('button', { name: '打轴', exact: true }).click();
  for (const id of ['A', 'W', 'BG']) { await page.locator(`main [data-word-id="${id}"]`).click(); await expect(page.getByLabel('不雅用语', { exact: true })).toBeChecked(); }
  await page.getByRole('button', { name: '文件打包', exact: true }).click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '下载歌词', exact: true }).click();
  const file = await download; const output = await readFile((await file.path())!, 'utf8');
  expect(output.match(/amll:obscene="true"/g)).toHaveLength(3); expect(output).not.toContain('studio:');
  await importLyrics(page, { name: 'reopened.ttml', mimeType: 'application/xml', buffer: Buffer.from(output) });
  await page.getByRole('button', { name: '打轴', exact: true }).click();
  for (const text of ['Alpha', '今日', '背景']) {
    await page.locator('main [data-word-id]').filter({ has: page.locator('[class*="syncBody"]', { hasText: text }) }).click();
    await expect(page.getByLabel('不雅用语', { exact: true })).toBeChecked();
  }
});
