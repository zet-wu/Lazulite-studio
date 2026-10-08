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

test('large validation mounts bounded details and supports keyboard location', async ({ page }) => {
  const words = Array.from({length:1200},(_,i)=>`<span>word${i}</span>`).join('');
  await page.goto('/projects/sample-project/edit?scenario=no-music');
  await importLyrics(page, {name:'large.ttml',mimeType:'application/xml',buffer:Buffer.from(`<tt xmlns="http://www.w3.org/ns/ttml"><body><p xml:id="line">${words}</p></body></tt>`)});
  await page.getByRole('button',{name:'文件打包',exact:true}).click();
  await page.getByRole('button',{name:'歌词校验',exact:true}).click();
  const rule = page.locator('details').filter({has:page.locator('summary').filter({hasText:/^缺少时间/})}).first();
  await expect(rule.locator('li')).toHaveCount(0);
  await rule.locator(':scope > summary').click();
  await expect(rule.locator('li')).toHaveCount(0);
  await rule.locator('details > summary').first().click();
  await expect(rule.locator('li')).toHaveCount(50);
  await rule.getByRole('button',{name:/再显示 50 项/}).click();
  await expect(rule.locator('li')).toHaveCount(100);
  const target = rule.getByRole('button',{name:/第 90 词：缺少/});
  await target.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox',{name:'词 word89',exact:true}).locator('xpath=ancestor::*[@data-word-id][1]')).toBeFocused();
});
