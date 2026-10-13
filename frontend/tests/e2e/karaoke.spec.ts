import { expect,test } from '@playwright/test';
import { importLyrics } from '../fixtures/import-lyrics';
const xml=`<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:studio="urn:lazulite:studio:draft"><body><p xml:id="a" begin="4" end="7"><span studio:id="w" tts:ruby="container" begin="4" end="5"><span tts:ruby="base">愛</span><span tts:ruby="textContainer"><span studio:id="r1" tts:ruby="text" begin="4.2" end="4.3">あ</span><span studio:id="r2" tts:ruby="text" begin="4.9" end="5">い</span></span></span><span studio:id="b" begin="5.6" end="7">●</span></p><p xml:id="c" begin="10" end="11"><span studio:id="cw" begin="10" end="11">C</span></p></body></tt>`;
async function load(page:import('@playwright/test').Page){await page.setViewportSize({width:1440,height:1000});await page.goto('/projects/sample-project/edit');await importLyrics(page,{name:'karaoke.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});await page.getByRole('button',{name:'卡拉 OK',exact:true}).click();}
test('yellow slots insert once on double click, share cue properties and keep original literal circles',async({page})=>{
 await load(page);
 await page.getByRole('button',{name:'插入行内导唱',exact:true}).dblclick();
 await expect(page.locator('main [data-cue-id]')).toHaveCount(1);
 await expect(page.getByLabel('导唱开始秒数')).toHaveValue('5');
 await page.getByLabel('导唱结束秒数').fill('5.4');await page.getByLabel('导唱结束秒数').press('Tab');
 await expect(page.getByRole('button',{name:'插入行内导唱',exact:true})).toHaveCount(0);
 await expect(page.locator('main [data-word-id="b"]')).toHaveText('●');
 await page.locator('main [data-cue-id]').dblclick();await page.locator('main').getByRole('textbox',{name:'导唱文字',exact:true}).fill('●●');await page.locator('main').getByRole('textbox',{name:'导唱文字',exact:true}).press('Enter');
 await expect(page.locator('main [data-cue-id]')).toHaveText('●●');
 await page.locator('main [data-cue-id]').first().focus();await page.keyboard.press('Delete');await expect(page.getByRole('button',{name:'插入行内导唱',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.locator('main [data-cue-id]')).toHaveText('●●');

 await page.locator('[data-top-menu="view"] summary').click();await page.getByRole('button',{name:'夜间模式',exact:true}).click();
});
test('auto insertion is idempotent and export ZIP can return from focused validation',async({page})=>{
 await load(page);await page.locator('[data-top-menu="cue-tools"] summary').click();await page.getByRole('button',{name:'自动插入导唱符',exact:true}).click();await page.getByRole('button',{name:'插入',exact:true}).click();await expect(page.locator('main [data-cue-id]')).toHaveCount(3);
 await page.locator('[data-top-menu="cue-tools"] summary').click();await page.getByRole('button',{name:'自动插入导唱符',exact:true}).click();await page.getByRole('button',{name:'插入',exact:true}).click();await expect(page.locator('main [data-cue-id]')).toHaveCount(3);
 await page.getByRole('button',{name:'导出 NicoKara',exact:true}).click();await expect(page.getByRole('dialog').getByRole('status')).toContainText('0 项阻塞');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载 ZIP',exact:true}).click();expect((await download).suggestedFilename()).toMatch(/-nicokara.zip$/);
 await page.getByRole('button',{name:'查看校验',exact:true}).click();await expect(page.getByLabel('校验格式筛选')).toHaveValue('nicokara');
 await page.getByRole('button',{name:'返回 Nicokara 导出',exact:true}).click();await expect(page.getByRole('dialog',{name:'导出 Nicokara',exact:true})).toBeVisible();
});
test('timeline cue selects shared properties, resizes within range and rejects out of bounds',async({page})=>{
 await load(page);await page.getByRole('button',{name:'添加行前导唱',exact:true}).first().click();
 const cue=page.getByRole('button',{name:'时间轴导唱 ●',exact:true});await cue.click();await expect(page.getByLabel('导唱开始秒数')).toHaveValue('3');
 await page.getByRole('checkbox',{name:'吸附',exact:true}).uncheck();
 const handle=cue.getByRole('button',{name:'导唱开始端点'}),box=(await handle.boundingBox())!;
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2-8,box.y+box.height/2);await page.mouse.up();
 expect(Number(await page.getByLabel('导唱开始秒数').inputValue())).toBeLessThan(3);
 const before=await page.getByLabel('导唱开始秒数').inputValue(),again=(await handle.boundingBox())!;
 await page.mouse.move(again.x+again.width/2,again.y+again.height/2);await page.mouse.down();await page.mouse.move(again.x+again.width/2-100,again.y+again.height/2);await page.mouse.up();
 await expect(page.getByLabel('导唱开始秒数')).toHaveValue(before);
});
test('fresh selected-output validation locates a retimed cue and returns after repair',async({page})=>{
 await load(page);await page.getByRole('button',{name:'插入行内导唱',exact:true}).click();
 await page.locator('main [data-word-id="b"]').click();await page.getByLabel('选中对象开始秒数').fill('5.2');await page.getByLabel('选中对象开始秒数').press('Tab');
 await page.getByRole('button',{name:'导出 NicoKara',exact:true}).click();await expect(page.getByRole('dialog').getByRole('status')).not.toContainText('0 项阻塞');
 await page.getByRole('button',{name:'查看校验',exact:true}).click();await page.getByRole('button',{name:'导唱双端必须位于原空隙内且具有正时长',exact:true}).click();
 await expect(page.getByLabel('导唱结束秒数')).toHaveValue('5.6');await page.getByLabel('导唱结束秒数').fill('5.1');await page.getByLabel('导唱结束秒数').press('Tab');
 await page.getByRole('button',{name:'导出 NicoKara',exact:true}).click();await expect(page.getByRole('dialog').getByRole('status')).toContainText('0 项阻塞');
});
test('automatic dialog cancels drafts, checks thresholds and undoes insertion as one change',async({page})=>{
 await load(page);await expect(page.getByRole('button',{name:'下载项目',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'重开项目',exact:true})).toHaveCount(0);
 await page.locator('[data-top-menu="cue-tools"] summary').click();await page.getByRole('button',{name:'默认导唱符',exact:true}).click();await expect(page.getByLabel('行前阈值',{exact:true})).toHaveCount(0);await page.getByRole('button',{name:'关闭默认导唱符'}).click();
 await page.locator('[data-top-menu="cue-tools"] summary').click();await page.getByRole('button',{name:'自动插入导唱符',exact:true}).click();await page.getByLabel('行前阈值',{exact:true}).fill('0');await page.getByRole('button',{name:'关闭自动插入导唱符'}).click();await expect(page.locator('main [data-cue-id]')).toHaveCount(0);
 await page.locator('[data-top-menu="cue-tools"] summary').click();await page.getByRole('button',{name:'自动插入导唱符',exact:true}).click();await expect(page.getByLabel('行前阈值',{exact:true})).toHaveValue('3000');await page.getByLabel('行前阈值',{exact:true}).fill('');await page.getByRole('button',{name:'插入',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('非负整数');
 await page.getByLabel('行前阈值',{exact:true}).fill('0');await page.getByRole('button',{name:'插入',exact:true}).click();await expect(page.locator('main [data-cue-id]')).toHaveCount(4);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.locator('main [data-cue-id]')).toHaveCount(0);
 await page.locator('[data-top-menu="cue-tools"] summary').click();await page.getByRole('button',{name:'自动插入导唱符',exact:true}).click();await expect(page.getByLabel('行前阈值',{exact:true})).toHaveValue('3000');
});
test('singer marker drafts cancel locally',async({page})=>{
 await load(page);
 const source=xml.replace('<tt xmlns=', '<tt xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns=').replace('<body>','<head><metadata><ttm:agent xml:id="singer" type="person"><ttm:name>A</ttm:name></ttm:agent></metadata></head><body>').replace('<p xml:id="a"','<p ttm:agent="singer" xml:id="a"');
 await importLyrics(page,{name:'singer.ttml',mimeType:'application/xml',buffer:Buffer.from(source)});await page.getByRole('button',{name:'卡拉 OK',exact:true}).click();
 await page.getByRole('button',{name:'歌手标记管理',exact:true}).click();await expect(page.getByLabel('触发标记',{exact:true})).toHaveValue('【A】');
 await page.getByLabel('触发标记',{exact:true}).fill('cancel');await page.getByRole('button',{name:'关闭歌手标记管理'}).click();await page.getByRole('button',{name:'歌手标记管理',exact:true}).click();await expect(page.getByLabel('触发标记',{exact:true})).toHaveValue('【A】');

});
test('wrapped multiline canvas keeps multi-character Ruby and editing above timing markers; normal sync stays unchanged',async({page})=>{
 await load(page);await page.setViewportSize({width:1000,height:1000});
 const source=xml.replace('</p><p xml:id="c"',Array.from({length:10},(_,i)=>`<span studio:id="more-${i}" begin="${8+i*2}" end="${9+i*2}">多个正文</span>`).join('')+'</p><p xml:id="c"').replace('end="7"><span','end="30"><span').replace('>あ<','>ながいよみ<');
 await importLyrics(page,{name:'wrapped.ttml',mimeType:'application/xml',buffer:Buffer.from(source)});await page.getByRole('button',{name:'打轴',exact:true}).click();
 const positions=()=>page.locator('main [data-word-id]').evaluateAll(nodes=>nodes.map(node=>{const box=node.getBoundingClientRect();return [box.x,box.y,box.height];}));const original=await positions();expect(new Set(original.map(box=>box[1])).size).toBeGreaterThan(2);
 await page.getByRole('button',{name:'卡拉 OK',exact:true}).click();await page.locator('[data-top-menu="cue-tools"] summary').click();await page.getByRole('button',{name:'自动插入导唱符',exact:true}).click();await page.getByRole('button',{name:'插入',exact:true}).click();
 const cue=page.locator('main [data-cue-id]').first();await cue.dblclick();const input=page.locator('main').getByRole('textbox',{name:'导唱文字',exact:true});await input.fill('●●●');
 await input.press('Enter');await page.getByRole('button',{name:'打轴',exact:true}).click();expect(await positions()).toEqual(original);
});
