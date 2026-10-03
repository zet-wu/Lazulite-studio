import { expect, test, type Page } from '@playwright/test';
import { importLyrics } from '../fixtures/import-lyrics';
const xml='<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><p xml:id="main" begin="0" end="4"><span begin="0" end="4">食べる</span><span ttm:role="x-bg" begin="0" end="4"><span begin="0" end="4">魂</span></span></p><p xml:id="second" begin="4" end="8"><span begin="4" end="8">今日</span></p></body></tt>';
async function load(page: Page, text=xml){await page.goto('/editor');await importLyrics(page,{name:'ruby.ttml',mimeType:'application/xml',buffer:Buffer.from(text)});}
async function mock(page: Page, fail=false){await page.addInitScript(fail=>{
 const original=window.fetch; (window as any).readingFailure=fail;
 window.fetch=async(input,init)=>{
  if(String(input).endsWith('/reading/analyze')){
   if((window as any).readingFailure)return new Response(JSON.stringify({message:'读音服务暂不可用'}),{status:503});
   const {lines}=JSON.parse(String(init?.body));return new Response(JSON.stringify({ranges:lines.map((l:{id:string;text:string})=>({line_id:l.id,base_start:0,base_end:Array.from(l.text).length,base:l.text,reading:({'食べる':'たべる','魂':'たましい','今日':'きょう'} as Record<string,string>)[l.text]??''}))}),{status:200});
  }return original(input,init);
 };
},fail);}
async function open(page:Page,index=0){await page.locator('[data-outline-drag]').nth(index).click({button:'right'});await page.getByRole('menuitem',{name:'生成日文注音…',exact:true}).click();const dialog=page.getByRole('dialog',{name:'生成日文注音',exact:true});await expect(dialog.getByText('正在分析日文正文…')).toHaveCount(0);return dialog;}
test('mixed selection, exact background scope, mora apply and undo',async({page})=>{
 await mock(page);await load(page);const outline=page.locator('[data-outline-drag]');await outline.first().click();await outline.nth(1).click({modifiers:['Control']});const dialog=await open(page);
 await expect(dialog.locator('[data-reading-row]')).toHaveCount(2);await expect(dialog.getByLabel('食完整读音')).toHaveValue('た');await expect(dialog.getByLabel('魂完整读音')).toHaveValue('たましい');
 await dialog.getByRole('button',{name:'应用',exact:true}).click();await expect(page.locator('main [data-ruby-id]')).toHaveCount(5);await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.locator('main [data-ruby-id]')).toHaveCount(0);
 await outline.nth(1).click();const bg=await open(page,1);await expect(bg.locator('[data-reading-row]')).toHaveCount(1);await expect(bg.getByLabel('魂完整读音')).toBeVisible();await bg.getByRole('button',{name:'取消',exact:true}).click();
});
test('unblurred reading, Escape, IME and resize preserve current field',async({page})=>{
 await mock(page);await load(page);const d=await open(page,2),input=d.getByLabel('今日完整读音');await input.fill('こんにち');await input.press('Escape');await expect(input).toHaveValue('きょう');await expect(d).toBeVisible();
 await input.dispatchEvent('compositionstart');await input.fill('こんにち');await input.press('Enter');await input.press('Escape');await expect(input).toBeFocused();await expect(d.getByRole('button',{name:'应用',exact:true})).toBeDisabled();await input.dispatchEvent('compositionend');
 await page.setViewportSize({width:1280,height:800});await expect(input).toBeFocused();await d.getByRole('button',{name:'应用',exact:true}).click();await expect(page.locator('main [data-ruby-id]')).toHaveCount(4);
});
test('failed retry preserves manual reading and cancel changes nothing',async({page})=>{
 await mock(page,true);await load(page);const d=await open(page);await expect(d.getByRole('alert')).toContainText('暂不可用');await d.getByLabel('食完整读音').fill('く');await page.evaluate(()=>{(window as any).readingFailure=false;});await d.getByRole('button',{name:'重试'}).click();await expect(d.getByText('正在分析日文正文…')).toHaveCount(0);await expect(d.getByLabel('食完整读音')).toHaveValue('く');await d.getByRole('button',{name:'取消',exact:true}).click();await expect(page.locator('main [data-ruby-id]')).toHaveCount(0);
});
for(const theme of ['light','dark'])test(`desktop widths ${theme}`,async({page})=>{await page.addInitScript(t=>localStorage.setItem('lazulite-editor-theme',t),theme);await mock(page);await load(page);const d=await open(page);for(const width of [1280,1440,1920]){await page.setViewportSize({width,height:900});await expect(d.getByLabel('食完整读音')).toBeVisible();await page.screenshot({path:`/tmp/ruby-${theme}-${width}.png`});}});
test('2000 rows bounded mounting retains active/manual input and applies all rows',async({page})=>{
 test.setTimeout(90000);await mock(page);await load(page,`<tt xmlns="http://www.w3.org/ns/ttml"><body>${Array.from({length:2000},(_,i)=>`<p xml:id="l${i}"><span>今日</span></p>`).join('')}</body></tt>`);
 const outline=page.locator('[data-outline-drag]');await outline.first().click();await outline.last().click({modifiers:['Shift']});const start=Date.now();const d=await open(page);await expect(d.getByLabel('今日完整读音').first()).toHaveValue('きょう');const opened=Date.now()-start;const input=d.getByLabel('今日完整读音').first();await input.fill('こんにち');
 const scroll=d.locator('[data-japanese-rows]');await scroll.evaluate(el=>{el.scrollTop=el.scrollHeight});await page.waitForTimeout(250);await expect(input).toBeFocused();expect(await d.locator('[data-reading-row]').count()).toBeLessThan(40);
 await d.getByText('编辑完整读音；空白项跳过。时间按比例估算，应用后可在时间轴调整。').click();await scroll.evaluate(el=>{el.scrollTop=0});await expect(d.getByLabel('今日完整读音').first()).toHaveValue('こんにち');const applyStart=Date.now();await d.getByRole('button',{name:'应用',exact:true}).click();await expect(d).toHaveCount(0);const applied=Date.now()-applyStart;
 console.log('RUBY_SCALE',JSON.stringify({rows:2000,openMs:opened,applyMs:applied}));await test.info().attach('scale-metrics',{body:JSON.stringify({rows:2000,openMs:opened,applyMs:applied}),contentType:'application/json'});
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.locator('main [data-ruby-id]')).toHaveCount(0);
});
test('long line wraps without replacing focused input node',async({page})=>{
 await mock(page);const text='今日かな'.repeat(150);await load(page,`<tt xmlns="http://www.w3.org/ns/ttml"><body><p>${text}</p></body></tt>`);const d=await open(page),input=d.getByLabel('今日完整读音').first();await input.fill('きょう');await input.evaluate(el=>{(el as HTMLElement).dataset.retained='yes';});await page.setViewportSize({width:1280,height:800});await expect(input).toBeFocused();await expect(input).toHaveAttribute('data-retained','yes');expect(await d.evaluate(el=>el.scrollWidth<=el.clientWidth+2)).toBe(true);await d.getByRole('button',{name:'应用',exact:true}).click();await expect(page.locator('main [data-ruby-id]')).toHaveCount(2);
});
test('current canvas unblurred edit enters snapshot and invalid/IME edits block opening',async({page})=>{
 await mock(page);await load(page);const word=page.getByLabel('词 今日',{exact:true});await word.fill('魂');const d=await open(page,2);await expect(d.getByLabel('魂完整读音')).toHaveValue('たましい');await d.getByRole('button',{name:'取消',exact:true}).click();await expect(page.getByLabel('词 魂',{exact:true})).toHaveCount(2);
 const last=page.getByLabel('词 魂',{exact:true}).last();await last.fill('');await page.locator('[data-outline-drag]').last().click({button:'right'});await page.getByRole('menuitem',{name:'生成日文注音…',exact:true}).click();await expect(page.getByRole('dialog',{name:'生成日文注音',exact:true})).toHaveCount(0);
 await last.fill('魂');await last.dispatchEvent('compositionstart');await page.locator('[data-outline-drag]').last().click({button:'right'});await page.getByRole('menuitem',{name:'生成日文注音…',exact:true}).click();await expect(page.getByRole('dialog',{name:'生成日文注音',exact:true})).toHaveCount(0);await last.dispatchEvent('compositionend');
});
