import {expect,test,type Page} from '@playwright/test';
import {loadTimeline} from '../fixtures/timeline-setup';
import {importLyrics} from '../fixtures/import-lyrics';
const current=(page:Page)=>page.evaluate(async()=>{const path='/src/adapters/project-codec.ts';return (await import(path)).parseProject((await(await fetch('/api/v1/projects/sample-project/document')).json()).document);});
const xml='<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft"><body><p xml:id="row" begin="0" end="8"><span studio:id="a" begin="1.21" end="1.61">A</span><span studio:id="b" begin="4.21" end="4.61">B</span></p></body></tt>';
test('grabbed word end snaps a multi-selection with equal movement and one undo',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await loadTimeline(page,false,[{id:'anchor',beginMs:1930,endMs:2700}]);await importLyrics(page,{name:'end.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
 await page.getByRole('button',{name:'编辑',exact:true}).click();await page.locator('main [data-word-id="a"]').click({position:{x:2,y:2}});await page.locator('main [data-word-id="b"]').click({position:{x:2,y:2},modifiers:['Control']});
 await page.getByRole('button',{name:'音频处理',exact:true}).click();const source=page.locator('[data-timeline-key="a"]'),box=(await source.boundingBox())!,lane=(await source.locator('..').boundingBox())!;
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+lane.width*.330/15,box.y+box.height/2,{steps:4});
 await expect(page.locator('[data-drag-guide]').first()).toHaveAttribute('data-preview-ms','1530');await page.mouse.up();
 await expect.poll(async()=>(await current(page)).lyrics.lines[0].words.map((w:{beginMs:number;endMs:number})=>[w.beginMs,w.endMs])).toEqual([[1530,1930],[4530,4930]]);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect.poll(async()=>(await current(page)).lyrics.lines[0].words[0].beginMs).toBe(1210);
});
test('free staging interval uses its end and keeps timed siblings unchanged',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await loadTimeline(page,false,[{id:'anchor',beginMs:1600,endMs:2700}]);
 await importLyrics(page,{name:'free.ttml',mimeType:'application/xml',buffer:Buffer.from(xml.replace('begin="0" end="8"','begin="0.5" end="2.5"').replace('begin="1.21" end="1.61"','begin="1" end="1.4"').replace('begin="4.21" end="4.61"','studio:null="begin end"'))});
 await page.locator('[data-outline-drag]').first().click();await page.getByRole('button',{name:'音频处理',exact:true}).click();
 const source=page.locator('[data-staging-key="b"]'),box=(await source.boundingBox())!,lane=(await page.locator('[data-assignment-kind="word"]').first().boundingBox())!;
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(lane.x+lane.width*1.210/15,lane.y+lane.height/2,{steps:4});
 await expect(page.locator('[class*="assignmentPreview"]')).toHaveText('1200–1600 ms');await page.mouse.up();
 await expect.poll(async()=>(await current(page)).lyrics.lines[0].words.map((w:{beginMs:number;endMs:number})=>[w.beginMs,w.endMs])).toEqual([[1000,1400],[1200,1600]]);
});
test('guide block end snaps with constant duration and saves the displayed candidate',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await loadTimeline(page,false,[{id:'anchor',beginMs:1930,endMs:2700}]);await importLyrics(page,{name:'cue.ttml',mimeType:'application/xml',buffer:Buffer.from('<tt xmlns="http://www.w3.org/ns/ttml"><body><p xml:id="row" begin="4" end="8"><span begin="4" end="8">A</span></p></body></tt>')});
 await page.getByRole('button',{name:'卡拉 OK',exact:true}).click();await page.locator('[data-top-menu="cue-tools"] summary').click();await page.getByRole('button',{name:'自动插入导唱符',exact:true}).click();await page.getByRole('button',{name:'插入',exact:true}).click();
 const cue=page.locator('[data-editable-timeline] [data-cue-id]').first();await cue.click();
 const begin=page.getByRole('textbox',{name:'导唱开始秒数',exact:true}),end=page.getByRole('textbox',{name:'导唱结束秒数',exact:true});
 await begin.fill('1.21');await begin.press('Tab');await end.fill('1.61');await end.press('Tab');
 const box=(await cue.boundingBox())!,lane=(await cue.locator('..').boundingBox())!;
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+lane.width*.330/15,box.y+box.height/2,{steps:4});await page.mouse.up();
 await expect.poll(async()=>(await current(page)).karaoke.cues.map((c:{beginMs:number;endMs:number})=>[c.beginMs,c.endMs])).toEqual([[1530,1930]]);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(begin).toHaveValue('1.21');await expect(end).toHaveValue('1.61');
});
