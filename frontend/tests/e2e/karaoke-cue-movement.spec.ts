import {test,expect} from '@playwright/test';
import {loadTimeline} from '../fixtures/timeline-setup';
import {importLyrics} from '../fixtures/import-lyrics';
const xml='<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:studio="urn:lazulite:studio:draft"><body><p xml:id="a" begin="4" end="7"><span studio:id="w" tts:ruby="container" begin="4" end="5"><span tts:ruby="base">愛</span><span tts:ruby="textContainer"><span studio:id="r1" tts:ruby="text" begin="4.2" end="4.3">あ</span><span studio:id="r2" tts:ruby="text" begin="4.9" end="5">い</span></span></span><span studio:id="b" begin="5.6" end="7">●</span></p></body></tt>';
test('batch and timeline whole-line movements save and undo all three cue kinds',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await loadTimeline(page);await importLyrics(page,{name:'shift.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
 const current=()=>page.evaluate(async()=>(await(await fetch('/api/v1/projects/sample-project/document')).json()).document);
 await page.getByRole('button',{name:'卡拉 OK',exact:true}).click();await page.locator('[data-top-menu="cue-tools"] summary').click();await page.getByRole('button',{name:'自动插入导唱符',exact:true}).click();await page.getByRole('button',{name:'插入',exact:true}).click();
 await expect.poll(async()=>(await current()).karaoke.cues.length).toBe(3);const before=await current();
 await page.getByRole('button',{name:'编辑',exact:true}).click();await page.locator('main [data-word-id="w"]').click();await page.locator('[data-top-menu="tools"] summary').click();await page.getByRole('button',{name:'批处理…',exact:true}).click();await page.getByRole('button',{name:'时间偏移',exact:true}).click();await page.getByLabel('偏移毫秒（负数为提前）').fill('500');await page.getByRole('button',{name:'应用（一次撤销）'}).click();
 await expect.poll(async()=>(await current()).karaoke.cues.map((c:{beginMs:number})=>c.beginMs)).toEqual(before.karaoke.cues.map((c:{beginMs:number})=>c.beginMs+500));
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect.poll(current).toEqual(before);
 await page.getByRole('button',{name:'卡拉 OK',exact:true}).click();await page.getByLabel('吸附',{exact:true}).uncheck();const line=page.getByRole('button',{name:'时间轴行 L1',exact:true});await line.scrollIntoViewIfNeeded();const box=(await line.boundingBox())!;
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+25,box.y+box.height/2,{steps:5});await page.mouse.up();
 await expect.poll(async()=>(await current()).karaoke.cues[0].beginMs).toBeGreaterThan(before.karaoke.cues[0].beginMs);
 const after=await current(),delta=after.karaoke.cues[0].beginMs-before.karaoke.cues[0].beginMs;
 expect(after.karaoke.cues).toEqual(before.karaoke.cues.map((c:{beginMs:number;endMs:number})=>({...c,beginMs:c.beginMs+delta,endMs:c.endMs+delta})));
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect.poll(current).toEqual(before);
});
