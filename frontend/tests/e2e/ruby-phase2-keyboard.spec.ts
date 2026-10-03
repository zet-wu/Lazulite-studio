import { expect, test } from '@playwright/test';
import { importLyrics } from '../fixtures/import-lyrics';
import { phase7Ttml } from '../fixtures/phase7';
import { phase6Ttml } from '../fixtures/phase6';

for (const kind of ['lines', 'words', 'ruby', 'content', 'unit']) for (const count of [1, 2]) test(`Delete ${kind} ${count}: atomic history and focus`, async ({ page }) => {
  await page.goto('/editor');
  await importLyrics(page, { name: 'delete.ttml', mimeType: 'application/xml', buffer: Buffer.from(['content','unit'].includes(kind) ? phase6Ttml() : phase7Ttml) });
  const selector = { lines: '[data-outline-drag]', words: 'main [data-word-id]', ruby: 'main [data-ruby-id]', content: 'main [data-line-id="english"] [data-romanization-content-id]', unit: 'main [data-line-id="english"] [data-romanization-unit-id]' }[kind]!;
  const items = page.locator(selector), before = await items.count();
  await items.first().click({ position: {x:3,y:3} });
  if (count === 2) await items.nth(1).click({ position: {x:3,y:3}, modifiers:['Shift'] });
  await items.nth(count-1).focus();
  await page.keyboard.press('Delete');
  await expect(items).toHaveCount(before-count);
  await expect(page.locator('main')).toBeFocused();
  await page.locator('main').dispatchEvent('keydown', {key:'Delete',code:'Delete',repeat:true});
  await expect(items).toHaveCount(before-count);
  await page.keyboard.press('Control+z'); await expect(items).toHaveCount(before);
  await page.keyboard.press('Control+Shift+z'); await expect(items).toHaveCount(before-count);
});

for (const conflict of [false,true]) test(`bottom timeline stamp and seek ownership ${conflict}`, async ({page}) => {
  await page.goto('/projects/sample-project/edit');
  await importLyrics(page,{name:'sync.ttml',mimeType:'application/xml',buffer:Buffer.from(phase7Ttml)});
  if (conflict) {
    await page.locator('[data-top-menu="settings"] summary').click();
    await page.getByRole('button',{name:'快捷键设置',exact:true}).click();
    await page.getByRole('textbox',{name:'后退 1 秒快捷键'}).click(); await page.keyboard.press('s'); await page.keyboard.press('Escape');
  }
  await page.locator('[data-ruby-id]').first().click({position:{x:3,y:3}});
  await page.getByRole('button',{name:'打轴',exact:true}).click();
  const wave=page.getByRole('slider',{name:'波形进度'});
  await wave.click({position:{x:10,y:10}});
  await page.locator('audio').evaluate((a:HTMLAudioElement)=>{a.currentTime=1.5;});
  await page.keyboard.press('s');
  await expect(page.getByLabel('读音 が开始秒数')).toHaveValue(conflict?'0':'1.5');
  if(conflict) await expect.poll(()=>page.locator('audio').evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeCloseTo(.5,1);
  await page.keyboard.press('Delete'); await expect(page.locator('[data-ruby-id]')).toHaveCount(4);
});
