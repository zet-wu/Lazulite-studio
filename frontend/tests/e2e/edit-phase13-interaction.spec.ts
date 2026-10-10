import { expect, test, type Page } from '@playwright/test';
import { importPhase12 } from '../fixtures/phase12';
const word=(page:Page,id:string)=>page.locator(`main [data-word-id="${id}"]`);
const ruby=(page:Page,id:string)=>page.locator(`main [data-ruby-id="${id}"]`);
const click=async(node:ReturnType<typeof word>,modifiers:('Control'|'Shift')[]=[])=>node.click({position:{x:2,y:2},modifiers});
const selected=(node:ReturnType<typeof word>)=>expect(node).toHaveClass(/selectedWord|selectedRuby|selectedLine/);
test.beforeEach(async({page})=>{await page.setViewportSize({width:1440,height:1000});await page.goto('/projects/sample-project/edit?scenario=no-music');await importPhase12(page,5);});
test('delete and cut recover nearby object containers, with parent fallback and undo',async({page})=>{
 await page.locator('[data-outline-drag]').last().click();
 await click(word(page,'w4-3'));await page.keyboard.press('Delete');await expect(word(page,'w4-3')).toHaveCount(0);await expect(word(page,'w4-2')).toBeFocused();await selected(word(page,'w4-2'));
 await page.keyboard.press('Control+x');await expect(word(page,'w4-2')).toHaveCount(0);await expect(word(page,'w4-1')).toBeFocused();
 await click(ruby(page,'r4-1'));await page.keyboard.press('Delete');await expect(word(page,'w4-1')).toBeFocused();await selected(word(page,'w4-1'));
 await page.keyboard.press('Control+z');await expect(ruby(page,'r4-1')).toBeVisible();await expect(word(page,'w4-1')).toBeFocused();
});
test('plain click collapses an existing group and resets Shift anchor, context preserves group',async({page})=>{
 await click(word(page,'w0-0'));await click(word(page,'w0-3'),['Shift']);await selected(word(page,'w0-0'));await selected(word(page,'w0-3'));
 await click(word(page,'w0-2'));await selected(word(page,'w0-2'));await expect(word(page,'w0-0')).not.toHaveClass(/selectedWord/);
 await click(word(page,'w0-3'),['Shift']);await expect(word(page,'w0-1')).not.toHaveClass(/selectedWord/);await selected(word(page,'w0-2'));
 await word(page,'w0-2').click({button:'right',position:{x:2,y:2}});await expect(page.getByRole('menuitem',{name:'删除所选词（2）',exact:true})).toBeVisible();await page.keyboard.press('Escape');await selected(word(page,'w0-3'));
 await click(word(page,'w0-2'),['Control']);await expect(word(page,'w0-2')).not.toHaveClass(/selectedWord/);await selected(word(page,'w0-3'));
});
test('menu and translation delete button restore same-parent targets',async({page})=>{
 await click(word(page,'w0-3'));await word(page,'w0-3').click({button:'right',position:{x:2,y:2}});await page.getByRole('menuitem',{name:'删除词',exact:true}).click();await expect(word(page,'w0-2')).toBeFocused();
 await page.getByRole('button',{name:'删除翻译',exact:true}).click();const line=page.locator('main section[data-line-id="p12-0"]');await expect(line).toBeFocused();await selected(line);
 await page.locator('main [data-romanization-unit-id="ru"]').click({position:{x:2,y:2}});await page.keyboard.press('Delete');await expect(page.locator('main [data-romanization-content-id="rc"]')).toBeFocused();
});
test('outline deletion stays near the last row and full deletion focuses canvas',async({page})=>{
 await page.locator('[data-outline-drag]').last().click();await page.keyboard.press('Delete');await expect(page.locator('[data-line-id="p12-3"] [data-outline-drag]')).toBeFocused();
 await page.keyboard.press('Control+a');await page.keyboard.press('Delete');await expect(page.locator('[data-outline-drag]')).toHaveCount(0);await expect(page.locator('main').filter({has:page.getByRole('button',{name:'新增歌词行'})})).toBeFocused();
});
test('virtual canvas deletion mounts nearby rows without jumping to the top',async({page})=>{
 await importPhase12(page,100);await page.locator('[data-outline-drag]').last().click();await expect(word(page,'w99-3')).toBeVisible();
 await click(word(page,'w99-3'));const list=page.getByLabel('歌词列表',{exact:true});const before=await list.evaluate(el=>el.scrollTop);
 await page.keyboard.press('Delete');await expect(word(page,'w99-2')).toBeFocused();expect(Math.abs(await list.evaluate(el=>el.scrollTop)-before)).toBeLessThan(250);
 await page.locator('main section[data-line-id="p12-99"]').click({position:{x:2,y:2}});await page.keyboard.press('Delete');await expect(page.locator('main section[data-line-id="p12-98"]')).toBeFocused();expect(await list.evaluate(el=>el.scrollTop)).toBeGreaterThan(before/2);
});
test('group drag survives click refinement and cancelling keeps the selection',async({page})=>{
 await click(word(page,'w0-2'));await click(word(page,'w0-3'),['Shift']);
 let box=(await word(page,'w0-2').boundingBox())!;await page.mouse.move(box.x+3,box.y+3);await page.mouse.down();await page.mouse.move(box.x+25,box.y+3,{steps:4});await page.keyboard.press('Escape');await page.mouse.up();await selected(word(page,'w0-2'));await selected(word(page,'w0-3'));
 box=(await word(page,'w0-2').boundingBox())!;const first=(await word(page,'w0-0').boundingBox())!;await page.mouse.move(box.x+3,box.y+3);await page.mouse.down();await page.mouse.move(first.x+1,first.y+first.height/2,{steps:12});await page.waitForTimeout(80);await page.mouse.up();
 await expect(page.locator('main section[data-line-id="p12-0"] [data-word-id]').first()).toHaveAttribute('data-word-id','w0-2');await selected(word(page,'w0-2'));await selected(word(page,'w0-3'));
});
test('timeline click is selection-only; multi-selection and deletion restore timeline focus',async({page})=>{
 const {loadTimeline}=await import('../fixtures/timeline-setup');await loadTimeline(page);await importPhase12(page,1);await page.locator('[data-outline-drag]').first().click();
 const bar=(id:string)=>page.locator(`[data-timeline-key="${id}"]`);
 await bar('w0-2').click();await bar('w0-3').click({modifiers:['Shift']});await expect(bar('w0-2')).toHaveClass(/trackSelected/);await expect(bar('w0-3')).toHaveClass(/trackSelected/);
 const undo=page.getByRole('button',{name:'撤销',exact:true});const undoLabel=await undo.getAttribute('title');
 await bar('w0-3').click();await expect(bar('w0-2')).not.toHaveClass(/trackSelected/);expect(await undo.getAttribute('title')).toBe(undoLabel);
 await bar('w0-3').press('Delete');await expect(bar('w0-2')).toBeFocused();await expect(bar('w0-2')).toHaveClass(/trackSelected/);
 await bar('w0-2').press('Delete');await expect(bar('w0-1')).toBeFocused();
});
test('Ruby and translation click ranges collapse once, input Ctrl-click does not double toggle',async({page})=>{
 await click(ruby(page,'r0-0'));await click(ruby(page,'r0-1'),['Control']);await selected(ruby(page,'r0-0'));await selected(ruby(page,'r0-1'));await click(ruby(page,'r0-1'));await expect(ruby(page,'r0-0')).not.toHaveClass(/selectedRuby/);
 // Use the native model serializer so content IDs and per-track ownership survive import.
 const translated=await page.evaluate(async()=>{const dp='/src/domain/lyric-document.ts',cp='/src/adapters/ttml/lyric-codec.ts';const d=await import(dp),c=await import(cp);const doc=d.createLyricDocument('词');doc.translationTracks=[{id:'t',language:'en',purpose:'subtitle',contents:['one','two','three'].map(id=>({id,lineId:doc.lines[0].id,kind:'plain',text:id}))}];return c.serializeLyricTtml(doc,{draft:true});});
 const {importLyrics}=await import('../fixtures/import-lyrics');await importLyrics(page,{name:'translations.ttml',mimeType:'application/xml',buffer:Buffer.from(translated)});
 const row=(id:string)=>page.locator(`main [data-translation-id="${id}"]`);
 await row('one').click({position:{x:2,y:2}});await row('three').click({position:{x:2,y:2},modifiers:['Shift']});await expect(row('two')).toHaveAttribute('data-selected','true');
 await row('two').locator('textarea').click({modifiers:['Control']});await expect(row('two')).not.toHaveAttribute('data-selected');await expect(row('one')).toHaveAttribute('data-selected','true');
 await row('three').click({position:{x:2,y:2}});await expect(row('one')).not.toHaveAttribute('data-selected');await expect(row('three')).toHaveAttribute('data-selected','true');
 await row('three').press('Delete');await expect(row('two')).toBeFocused();
});
test('Control-copy drag copies both selected words and preserves the originals',async({page})=>{
 await click(word(page,'w0-2'));await click(word(page,'w0-3'),['Shift']);
 const source=(await word(page,'w0-2').boundingBox())!, target=(await word(page,'w0-0').boundingBox())!;
 await page.keyboard.down('Control');await page.mouse.move(source.x+3,source.y+3);await page.mouse.down();await page.mouse.move(target.x+1,target.y+target.height/2,{steps:12});await page.waitForTimeout(80);await page.mouse.up();await page.keyboard.up('Control');
 const words=page.locator('main section[data-line-id="p12-0"] [data-word-id]');await expect(words).toHaveCount(6);await expect(word(page,'w0-2')).toBeVisible();await expect(word(page,'w0-3')).toBeVisible();await expect(words.nth(0).getByLabel('词 は',{exact:true})).toHaveValue('は');await expect(words.nth(1).getByLabel('词 歌',{exact:true})).toHaveValue('歌');
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(words).toHaveCount(4);
});
test('toolbar deletion resolves noncontiguous selection from its active last row',async({page})=>{
 await click(word(page,'w0-3'));await click(word(page,'w4-3'),['Control']);await click(word(page,'w4-2'),['Control']);
 await page.locator('[data-top-menu="clipboard"] summary').click();await page.getByRole('button',{name:'删除',exact:true}).click();await expect(word(page,'w4-1')).toBeFocused();await expect(word(page,'w4-2')).toHaveCount(0);await expect(word(page,'w4-3')).toHaveCount(0);await expect(word(page,'w0-3')).toHaveCount(0);
});
test('timed translation and Ruby recover to surviving containers, then empty body stays on its row',async({page})=>{
 const xml=await page.evaluate(async()=>{const dp='/src/domain/lyric-document.ts',cp='/src/adapters/ttml/lyric-codec.ts';const d=await import(dp),c=await import(cp);const doc=d.createLyricDocument('');doc.lines=['一','二','三'].map(text=>d.createLine(text));const row=doc.lines[2];row.id='last';row.words[0].id='last-word';row.words[0].rubyUnits=[{id:'r1',reading:'さ',beginMs:null,endMs:null},{id:'r2',reading:'ん',beginMs:null,endMs:null}];doc.translationTracks=[{id:'t',language:'en',purpose:'subtitle',contents:[{id:'c',lineId:'last',kind:'timed',units:[{id:'u1',text:'one',beginMs:null,endMs:null},{id:'u2',text:'two',beginMs:null,endMs:null}]}]}];return c.serializeLyricTtml(doc,{draft:true});});
 const {importLyrics}=await import('../fixtures/import-lyrics');await importLyrics(page,{name:'parents.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
 const unit=(id:string)=>page.locator(`main [data-translation-unit-id="${id}"]`);await unit('u2').press('Space');await page.keyboard.press('Delete');await expect(unit('u1')).toBeFocused();await page.keyboard.press('Delete');await expect(page.locator('main [data-translation-id="c"]')).toBeFocused();
 await click(ruby(page,'r2'));await page.keyboard.press('Delete');await expect(ruby(page,'r1')).toBeFocused();await page.keyboard.press('Delete');await expect(word(page,'last-word')).toBeFocused();await page.keyboard.press('Delete');await expect(page.locator('main section[data-line-id="last"]')).toBeFocused();await expect(page.locator('main section[data-line-id="last"] [data-word-id]')).toHaveCount(0);
});
