import { expect, test, type Page } from '@playwright/test';
import { importMergeSplit } from '../fixtures/merge-split';
import { importLyrics } from '../fixtures/import-lyrics';
const line=(page:Page,id='merge-line-0')=>page.locator(`main section[data-line-id="${id}"]`);
const edge=async(page:Page,index:number,options={})=>line(page).locator('[data-word-id]').nth(index).click({position:{x:3,y:3},...options});
const batch=async(page:Page)=>{await page.locator('[data-top-menu="tools"] summary').click();await page.getByRole('button',{name:'批处理…',exact:true}).click();return page.getByRole('dialog',{name:'批处理',exact:true});};
test.beforeEach(async({page})=>{await page.setViewportSize({width:1440,height:1000});await page.goto('/projects/sample-project/edit?scenario=no-music');await importMergeSplit(page,3);});
test('batch feedback, literal body and Ruby replacements, clear preview and undo',async({page})=>{
 await edge(page,0);let dialog=await batch(page);await expect(dialog.getByRole('button',{name:'替换',exact:true})).toHaveAttribute('aria-pressed','true');
 await dialog.getByLabel('查找',{exact:true}).fill('今');await dialog.getByLabel('替换为',{exact:true}).fill('新');await expect(dialog.getByRole('status')).toContainText('实际修改 1');await dialog.getByRole('button',{name:'应用（一次撤销）'}).click();
 await expect(line(page).getByLabel('词 新',{exact:true})).toHaveValue('新');await expect(line(page).locator('[data-ruby-id]')).toHaveCount(2);
 dialog=await batch(page);await dialog.getByRole('radio',{name:'注音',exact:true}).check();await dialog.getByLabel('查找',{exact:true}).fill('きょ');await dialog.getByLabel('替换为',{exact:true}).fill('きょう');await dialog.getByRole('button',{name:'应用（一次撤销）'}).click();await expect(line(page).getByLabel('读音 新',{exact:true})).toHaveValue('きょう');
 dialog=await batch(page);await dialog.getByRole('button',{name:'清除注音',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('清除 2 个 Ruby');await dialog.getByRole('button',{name:'应用（一次撤销）'}).click();await expect(line(page).locator('[data-ruby-id]')).toHaveCount(0);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(line(page).locator('[data-ruby-id]')).toHaveCount(2);
});
test('multi-word beats and group movement, main merge attachment migration and song-part draft',async({page})=>{
 await edge(page,2);await edge(page,3,{modifiers:['Shift']});await edge(page,2,{button:'right'});await page.getByRole('menuitem',{name:'添加空拍',exact:true}).click();
 await expect.poll(()=>page.evaluate(async()=>Object.keys((await(await fetch('/api/v1/projects/sample-project/document')).json()).document.editing.emptyBeats))).toEqual(['w0-2','w0-3']);
 await edge(page,2,{button:'right'});await page.getByRole('menuitem',{name:'词前移',exact:true}).click();await expect(line(page).locator('[data-word-id]').nth(1)).toHaveAttribute('data-word-id','w0-2');
 await page.getByRole('button',{name:'撤销',exact:true}).click();
 const outlines=page.locator('[data-outline-drag]');await outlines.nth(0).click();await outlines.nth(2).click({modifiers:['Control']});
 const part=page.getByLabel('歌曲段落',{exact:true});await part.fill('My Verse');await part.press('Enter');
 await outlines.nth(0).click({button:'right'});await page.getByRole('menuitem',{name:'合并所选',exact:true}).click();await expect(outlines).toHaveCount(3);await expect(line(page).locator('[data-word-id]')).toHaveCount(8);await expect(part).toHaveValue('My Verse');await expect(line(page).getByLabel('翻译 1',{exact:true})).toHaveValue(' today ');
 await expect(line(page,'bg')).toBeVisible();await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(outlines).toHaveCount(4);
});
test('translation content and units select independently, merge and keyboard undo',async({page})=>{
 const xml=await page.evaluate(async()=>{const dp='/src/domain/lyric-document.ts',cp='/src/adapters/ttml/lyric-codec.ts';const d=await import(dp),c=await import(cp);const doc=d.createLyricDocument('正文');const id=doc.lines[0].id;doc.translationTracks=[{id:'t',language:'en',purpose:'subtitle',contents:[{id:'x',lineId:id,kind:'timed',units:[{id:'x1',text:'One ',beginMs:1000,endMs:null},{id:'x2',text:'Two',beginMs:null,endMs:2000}]},{id:'y',lineId:id,kind:'timed',units:[{id:'y1',text:' Three',beginMs:3000,endMs:4000}]}]}];return c.serializeLyricTtml(doc,{draft:true});});
 await importLyrics(page,{name:'translation.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
 const units=page.locator('main [data-translation-unit-id]');await units.nth(0).click({position:{x:2,y:2}});await units.nth(1).click({position:{x:2,y:2},modifiers:['Shift']});await units.nth(0).press('Shift+F10');await page.getByRole('menuitem',{name:'合并所选',exact:true}).click();await expect(units).toHaveCount(2);await expect(page.getByLabel('翻译 1 单元 1',{exact:true})).toHaveValue('One Two');
 const contents=page.locator('main [data-translation-id]');await contents.first().click({position:{x:2,y:2}});await contents.last().click({position:{x:2,y:2},modifiers:['Shift']});await contents.first().press('Shift+F10');await page.getByRole('menuitem',{name:'合并所选',exact:true}).click();await expect(contents).toHaveCount(1);await expect(units).toHaveCount(2);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(contents).toHaveCount(2);
});
for(const theme of ['light','dark'])test(`${theme} active batch tabs and seven SVGs remain accessible at narrow width`,async({page})=>{
 if(theme==='dark'){await page.locator('[data-top-menu="view"] summary').click();await page.getByRole('button',{name:'夜间模式',exact:true}).click();}
 await page.setViewportSize({width:850,height:900});const nav=page.getByRole('navigation',{name:'工作模式'});await expect(nav.locator('button svg[aria-hidden="true"]')).toHaveCount(7);
 const dialog=await batch(page);await dialog.getByRole('button',{name:'清除注音',exact:true}).click();const active=dialog.getByRole('button',{name:'清除注音',exact:true});await active.focus();await expect(active).toBeFocused();await expect(active).toHaveAttribute('aria-pressed','true');
 const colors=await active.evaluate(el=>({background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color,shadow:getComputedStyle(el).boxShadow}));expect(colors.shadow).not.toBe('none');expect(colors.background).not.toBe('rgba(0, 0, 0, 0)');await page.screenshot({path:test.info().outputPath(`editor-batch-structure-${theme}.png`)});
});
test('timeline shares complete lyric menus and audio alignment is last in DOM and visual order',async({page})=>{
 const {loadTimeline}=await import('../fixtures/timeline-setup');await loadTimeline(page);await importMergeSplit(page,2);
 await page.locator('[data-outline-drag]').first().click();
 const bars=page.locator('[data-timeline-key="w0-0"], [data-timeline-key="w0-1"]');await bars.first().click();await bars.last().click({modifiers:['Shift']});await bars.last().click({button:'right'});await expect(page.getByRole('menuitem',{name:'合并所选',exact:true})).toBeEnabled();await page.getByRole('menuitem',{name:'合并所选',exact:true}).click();await expect(line(page).getByLabel('词 今日',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'音频处理',exact:true}).click();const ribbon=page.getByLabel('音频操作',{exact:true});await expect(ribbon.getByRole('button',{name:'自动对齐',exact:true})).toBeVisible();
 expect(await ribbon.locator('button').last().textContent()).toBe('自动对齐');const order=await ribbon.evaluate(el=>{const controls=Array.from(el.querySelectorAll('button,summary'));return controls.map(e=>({text:e.textContent,x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y}));});expect(order.at(-1)!.text).toBe('自动对齐');expect(order.at(-1)!.x).toBeGreaterThan(order[0].x);
 await page.setViewportSize({width:850,height:900});await page.evaluate(()=>{document.documentElement.style.zoom='1.25';});await expect(ribbon.getByRole('button',{name:'自动对齐',exact:true})).toBeVisible();await page.screenshot({path:test.info().outputPath('editor-batch-structure-audio-zoom.png')});
});
test('clear-line cue menu ignores prior word selections and restores all cues with one undo',async({page})=>{
 const xml='<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:studio="urn:lazulite:studio:draft"><body><p xml:id="a" begin="4" end="7"><span studio:id="w" tts:ruby="container" begin="4" end="5"><span tts:ruby="base">愛</span><span tts:ruby="textContainer"><span studio:id="r1" tts:ruby="text" begin="4.2" end="4.3">あ</span><span studio:id="r2" tts:ruby="text" begin="4.9" end="5">い</span></span></span><span studio:id="b" begin="5.6" end="7">●</span></p></body></tt>';
 await importLyrics(page,{name:'cues.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});await page.getByRole('button',{name:'卡拉 OK',exact:true}).click();await page.locator('[data-top-menu="cue-tools"] summary').click();await page.getByRole('button',{name:'自动插入导唱符',exact:true}).click();await page.getByRole('button',{name:'插入',exact:true}).click();await expect(page.locator('main [data-cue-id]')).toHaveCount(3);
 await page.locator('main [data-cue-id]').first().click({button:'right'});await expect(page.getByRole('menuitem',{name:'删除导唱',exact:true})).toBeVisible();await expect(page.getByRole('menuitem',{name:'合并所选',exact:true})).toHaveCount(0);await page.keyboard.press('Escape');
 await page.locator('[data-outline-drag]').first().click({button:'right'});await page.getByRole('menuitem',{name:/清除本行导唱/}).click();await expect(page.locator('main [data-cue-id]')).toHaveCount(0);await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.locator('main [data-cue-id]')).toHaveCount(3);
});

test('plain translation timeline supports keyboard ranges and the shared content merge',async({page})=>{
 const {loadTimeline}=await import('../fixtures/timeline-setup');await loadTimeline(page);
 const xml=await page.evaluate(async()=>{const dp='/src/domain/lyric-document.ts',cp='/src/adapters/ttml/lyric-codec.ts';const d=await import(dp),c=await import(cp);const doc=d.createLyricDocument('正文');doc.lines[0].id='plain';doc.lines[0].beginMs=1000;doc.lines[0].endMs=4000;doc.translationTracks=[{id:'t',language:'en',purpose:'subtitle',contents:[{id:'one',lineId:'plain',kind:'plain',text:'One '},{id:'two',lineId:'plain',kind:'plain',text:'Two'}]}];return c.serializeLyricTtml(doc,{draft:true});});
 await importLyrics(page,{name:'plain.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});await page.locator('[data-outline-drag]').first().click();
 const first=page.getByRole('button',{name:'One',exact:true}),second=page.getByRole('button',{name:'Two',exact:true});await first.press('Space');await second.press('Shift+Space');await expect(first).toHaveAttribute('aria-pressed','true');await expect(second).toHaveAttribute('aria-pressed','true');await second.press('Shift+F10');await page.getByRole('menuitem',{name:'合并所选',exact:true}).click();await expect(page.getByLabel('翻译 1',{exact:true})).toHaveValue('One Two');await expect(page.locator('main [data-translation-id]')).toHaveCount(1);
});
