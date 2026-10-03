import { expect, test, type Page, type Locator } from '@playwright/test';
import { importLyrics } from '../fixtures/import-lyrics';
const ruby=(text:string,readings:string[])=>`<span begin="0" end="1" xmlns:tts="http://www.w3.org/ns/ttml#styling" tts:ruby="container"><span tts:ruby="base">${text}</span><span tts:ruby="textContainer">${readings.map((r,i)=>`<span tts:ruby="text" begin="${i/10}" end="${(i+1)/10}">${r}</span>`).join('')}</span></span>`;
export const dragXml=`<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><p xml:id="main" begin="0" end="4">${ruby('元',['あ','い','う'])}<span begin="2" end="3">先</span>${ruby('隣',['え','お'])}<span ttm:role="x-bg" begin="0" end="4">${ruby('背',['か'])}<span begin="2" end="3">景</span></span></p><p xml:id="other" begin="4" end="8"><span begin="4" end="8">別</span></p></body></tt>`;
async function load(page:Page,xml=dragXml){await page.goto('/editor');await importLyrics(page,{name:'cross.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});}
async function move(page:Page,source:Locator,target:Locator,finish=true,side='body'){
 const a=(await source.boundingBox())!,b=(await target.boundingBox())!;
 await page.mouse.move(a.x+2,a.y+2);await page.mouse.down();
 await page.mouse.move(side==='after'?b.x+b.width-2:b.x+2,b.y+2,{steps:8});await page.waitForTimeout(180);
 if(finish)await page.mouse.up();
}
test('empty target receives selected group, preserves IDs/times, focus, undo and redo',async({page})=>{
 await load(page);const source=page.getByLabel('词 元',{exact:true}).locator('xpath=ancestor::*[@data-word-id]'),target=page.getByLabel('词 先',{exact:true}).locator('xpath=ancestor::*[@data-word-id]');
 const units=source.locator('[data-ruby-id]');const ids=await units.evaluateAll(es=>es.map(e=>e.getAttribute('data-ruby-id')));
 await units.first().click({position:{x:2,y:2}});await units.nth(1).click({modifiers:['Shift'],position:{x:2,y:2}});await expect(page.getByText('注音已选 2')).toBeVisible();
 await move(page,units.first(),target,false);await expect(target.locator('[data-drag-placeholder]')).toHaveCount(2);await page.mouse.up();
 await expect(target.locator('[data-ruby-id]')).toHaveCount(2);expect(await target.locator('[data-ruby-id]').evaluateAll(es=>es.map(e=>e.getAttribute('data-ruby-id')))).toEqual(ids.slice(0,2));
 await expect(target.locator('[data-ruby-id]').first()).toBeFocused();await expect(page.getByText('注音已选 2')).toBeVisible();await expect(source.locator('[data-ruby-id]')).toHaveCount(1);
 await expect(target.getByLabel('读音 あ开始秒数')).toHaveValue('0');await expect(target.getByLabel('读音 い结束秒数')).toHaveValue('0.2');
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(source.locator('[data-ruby-id]')).toHaveCount(3);await expect(target.locator('[data-ruby-id]')).toHaveCount(0);
 await page.getByRole('button',{name:'重做',exact:true}).click();await expect(target.locator('[data-ruby-id]')).toHaveCount(2);
 // Selecting/typing in the moved unit uses its new word identity.
 const input=target.getByLabel('读音 先',{exact:true}).first();await input.fill('や');await input.blur();await expect(input).toHaveValue('や');
});
test('populated targets accept first, middle and last insertion; last unit can leave source',async({page})=>{
 for(const position of ['first','middle','last']){
  await load(page);const source=page.getByLabel('词 元',{exact:true}).locator('xpath=ancestor::*[@data-word-id]'),target=page.getByLabel('词 隣',{exact:true}).locator('xpath=ancestor::*[@data-word-id]');
  await move(page,source.locator('[data-ruby-id]').first(),target.locator('[data-ruby-id]').nth(position==='last'?1:0),true,position==='first'?'body':'after');
  expect(await target.getByLabel('读音 隣',{exact:true}).evaluateAll(es=>es.map(e=>(e as HTMLInputElement).value))).toEqual(position==='first'?['あ','え','お']:position==='middle'?['え','あ','お']:['え','お','あ']);
 }
 const source=page.getByLabel('词 背',{exact:true}).locator('xpath=ancestor::*[@data-word-id]'),target=page.getByLabel('词 景',{exact:true}).locator('xpath=ancestor::*[@data-word-id]');
 await move(page,source.locator('[data-ruby-id]'),target);await expect(source.locator('[data-ruby-id]')).toHaveCount(0);await expect(target.getByLabel('读音 景',{exact:true})).toHaveValue('か');
});
test('cross lyric lines, background transfer, Esc and original position add no move history',async({page})=>{
 await load(page);const source=page.getByLabel('词 元',{exact:true}).locator('xpath=ancestor::*[@data-word-id]');
 for(const label of ['词 別','词 景']){const target=page.getByLabel(label,{exact:true}).locator('xpath=ancestor::*[@data-word-id]');await move(page,source.locator('[data-ruby-id]').first(),target);await expect(source.locator('[data-ruby-id]')).toHaveCount(3);await expect(target.locator('[data-ruby-id]')).toHaveCount(0);}
 const target=page.getByLabel('词 先',{exact:true}).locator('xpath=ancestor::*[@data-word-id]');await move(page,source.locator('[data-ruby-id]').first(),target,false);await page.keyboard.press('Escape');await page.mouse.up();await expect(target.locator('[data-ruby-id]')).toHaveCount(0);
 await move(page,source.locator('[data-ruby-id]').first(),source.locator('[data-ruby-id]').first());await expect(source.locator('[data-ruby-id]')).toHaveCount(3);
 // One undo is still the import, proving none of the attempted moves made history.
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.getByLabel('词 元',{exact:true})).toHaveCount(0);
});
test('same lyric line allows moving across wrapped visual rows in both themes',async({page})=>{
 for(const theme of ['light','dark']){
  await page.addInitScript(t=>localStorage.setItem('lazulite-editor-theme',t),theme);await page.setViewportSize({width:1280,height:900});
  await load(page,`<tt xmlns="http://www.w3.org/ns/ttml"><body><p xml:id="main">${ruby('元',['あ'])}${Array.from({length:12},(_,i)=>`<span>かな${i}</span>`).join('')}<span>末</span></p></body></tt>`);
  const source=page.getByLabel('词 元',{exact:true}).locator('xpath=ancestor::*[@data-word-id]'),target=page.getByLabel('词 末',{exact:true}).locator('xpath=ancestor::*[@data-word-id]');
  expect((await target.boundingBox())!.y).toBeGreaterThan((await source.boundingBox())!.y+20);
  await move(page,source.locator('[data-ruby-id]'),target);await expect(target.getByLabel('读音 末',{exact:true})).toHaveValue('あ');
  await page.screenshot({path:`/tmp/ruby-cross-word-${theme}.png`});
 }
});
