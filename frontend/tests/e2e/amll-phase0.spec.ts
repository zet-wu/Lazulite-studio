import { expect, test } from '@playwright/test';
import { importLyrics } from '../fixtures/import-lyrics';
const xml = '<tt xmlns="http://www.w3.org/ns/ttml"><body><div>' + ['one','two','three','four'].map((text,i) => `<p xml:id="l${i}" begin="${i*2}" end="${i*2+1}"><span begin="${i*2}" end="${i*2+1}">${text}</span></p>`).join('') + '</div></body></tt>';
test('audio outline shares additive and range selections across modes', async ({page}) => {
  await page.goto('/projects/sample-project/edit');
  await importLyrics(page, { name:'test.ttml', mimeType:'application/xml', buffer:Buffer.from(xml) });
  await page.getByRole('button',{name:'音频处理',exact:true}).click();
  const rows = page.getByLabel('音频处理大纲').locator('[data-outline-drag]');
  await rows.nth(0).click(); await rows.nth(2).click({modifiers:['Control']});
  await expect(rows.nth(0)).toHaveAttribute('aria-pressed','true');
  await expect(rows.nth(1)).toHaveAttribute('aria-pressed','false');
  await expect(rows.nth(2)).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'编辑',exact:true}).click();
  await expect(page.locator('[data-outline-drag]').nth(2)).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'音频处理',exact:true}).click();
  await rows.nth(3).click({modifiers:['Shift']});
  await expect(rows.locator('[aria-pressed=false]')).toHaveCount(0);
  for (const row of await rows.all()) await expect(row).toHaveAttribute('aria-pressed','true');
});
