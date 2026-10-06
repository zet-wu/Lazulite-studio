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
  await expect(page.getByLabel('选中对象开始秒数')).toHaveValue(conflict?'0':'1.5');
  if(conflict) await expect.poll(()=>page.locator('audio').evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeCloseTo(.5,1);
  await page.keyboard.press('Delete'); await expect(page.locator('[data-ruby-id]')).toHaveCount(4);
});

test('Delete protects input, IME, menu, empty selection and clipboard',async({page})=>{
  await page.goto('/editor');await importLyrics(page,{name:'protect.ttml',mimeType:'application/xml',buffer:Buffer.from(phase7Ttml)});
  const words=page.locator('main [data-word-id]');
  await words.nth(1).click({position:{x:3,y:3}});await words.nth(1).focus();await page.locator('[data-top-menu="clipboard"] summary').click();await page.getByRole('button',{name:'复制',exact:true}).click();
  const input=page.getByLabel('词 しん',{exact:true});await input.focus();await page.keyboard.press('Home');await page.keyboard.press('Delete');
  await expect(words).toHaveCount(4);await expect(input).toHaveValue('ん');await page.keyboard.press('Escape');
  await words.nth(1).focus();await words.nth(1).dispatchEvent('keydown',{key:'Delete',code:'Delete',isComposing:true});await expect(words).toHaveCount(4);
  await words.nth(1).click({position:{x:3,y:3},button:'right'});await page.keyboard.press('Delete');await expect(words).toHaveCount(4);await page.keyboard.press('Escape');
  await words.nth(1).focus();await page.keyboard.press('Delete');await expect(words).toHaveCount(3);
  await page.keyboard.press('Control+z');await expect(words).toHaveCount(4);
  await words.last().click({position:{x:3,y:3},button:'right'});await page.getByRole('menuitem',{name:'粘贴',exact:true}).click();await expect(words).toHaveCount(5);
  await page.keyboard.press('Escape');await page.keyboard.press('Delete');await expect(words).toHaveCount(5);
});

test('track object focus selects its shared sync target and protects repeat and input',async({page})=>{
  await page.goto('/projects/sample-project/edit');await importLyrics(page,{name:'focus.ttml',mimeType:'application/xml',buffer:Buffer.from(phase7Ttml)});
  await page.locator('[data-ruby-id]').first().click({position:{x:3,y:3}});await page.getByRole('button',{name:'打轴',exact:true}).click();
  const track=page.getByRole('button',{name:'时间轴注音 こ',exact:true});await track.focus();
  await page.locator('audio').evaluate((a:HTMLAudioElement)=>{a.currentTime=.5;});await page.keyboard.press('s');
  await expect(page.getByLabel('选中对象开始秒数')).toHaveValue('0.5');
  await track.dispatchEvent('keydown',{key:'d',code:'KeyD',repeat:true});await expect(page.getByRole('region',{name:'连续打轴'})).toContainText('单元 3 / 4');
  await page.getByRole('spinbutton',{name:'BPM',exact:true}).focus();await page.keyboard.press('d');await expect(page.getByRole('region',{name:'连续打轴'})).toContainText('单元 3 / 4');
});
