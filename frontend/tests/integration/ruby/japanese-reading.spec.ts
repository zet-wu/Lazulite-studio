import { expect, test } from '@playwright/test';
import { importLyrics } from '../../fixtures/import-lyrics';
const xml='<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><p xml:id="main" begin="0" end="4"><span begin="0" end="4">食べる</span><span ttm:role="x-bg" begin="0" end="4"><span begin="0" end="4">魂</span></span></p><p xml:id="second" begin="4" end="8"><span begin="4" end="8">今日</span></p></body></tt>';
test('real Sudachi uses unsaved text, preserves background and saves/reopens exact ruby',async({page})=>{
 await page.goto('/projects/background-playback/edit');await importLyrics(page,{name:'ruby.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
 const before=await(await page.request.get('/api/v1/projects/background-playback/document')).json();const outline=page.locator('[data-outline-drag]');await expect(outline).toHaveCount(3);await outline.first().click();await outline.last().click({modifiers:['Shift']});await outline.first().click({button:'right'});await page.getByRole('menuitem',{name:'智能日文注音',exact:true}).click();
 const d=page.getByRole('dialog',{name:'智能日文注音',exact:true});await expect(d.getByLabel('食完整读音')).toHaveValue('た');await expect(d.getByLabel('魂完整读音')).toHaveValue('たましい');await expect(d.getByLabel('今日完整读音')).toHaveValue('きょう');
 expect((await(await page.request.get('/api/v1/projects/background-playback/document')).json()).revision).toBe(before.revision);
 await d.getByRole('button',{name:'应用',exact:true}).click();await expect(page.locator('main [data-ruby-id]')).toHaveCount(7);await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByText('已保存',{exact:true})).toBeVisible();const saved=await(await page.request.get('/api/v1/projects/background-playback/document')).json();
 expect(saved.document.lyrics.draftTtml).not.toContain('alignments');await page.reload();await expect(page.locator('main [data-ruby-id]')).toHaveCount(7);
 const check=await page.evaluate(async xml=>{const path='/src/adapters/ttml/lyric-codec.ts';const codec=await import(path);const doc=codec.parseLyricTtml(xml);const pure=codec.serializeLyricTtml(doc);const again=codec.parseLyricTtml(pure);return {words:again.lines.map((l:any)=>l.words.map((w:any)=>[w.text,w.rubyUnits.map((u:any)=>[u.reading,u.beginMs,u.endMs])])),background:!!again.lines[1].backgroundOf,pure};},saved.document.lyrics.draftTtml);
 expect(check.background).toBe(true);expect(check.words[1][0][1]).toEqual([['た',0,1000],['ま',1000,2000],['し',2000,3000],['い',3000,4000]]);expect(check.pure).not.toContain('studio:');
});

test('real precise segments preserve existing words and ruby, accept manual correction and save moved units exactly',async({page})=>{
 await page.setViewportSize({width:1920,height:1080});
 const xml='<tt xmlns="http://www.w3.org/ns/ttml"><body><p xml:id="main" begin="0" end="4"><span begin="0" end="1">夜</span><span begin="1" end="2">空</span><span begin="2" end="3">見上</span><span begin="3" end="4">げ</span></p><p xml:id="second" begin="4" end="8"><span begin="4" end="5">夜空</span><span begin="5" end="6">海</span><span begin="6" end="7">原</span></p></body></tt>';
 await page.goto('/projects/background-playback/edit');await importLyrics(page,{name:'precise.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
 const outline=page.locator('[data-outline-drag]');await outline.first().click();await outline.last().click({modifiers:['Shift']});await outline.first().click({button:'right'});await page.getByRole('menuitem',{name:'智能日文注音',exact:true}).click();
 const d=page.getByRole('dialog',{name:'智能日文注音',exact:true});await expect(d.getByLabel('夜完整读音',{exact:true}).first()).toHaveValue('よ');await expect(d.getByLabel('空完整读音',{exact:true}).first()).toHaveValue('ぞら');await expect(d.getByLabel('見完整读音',{exact:true})).toHaveValue('み');await expect(d.getByLabel('夜完整读音',{exact:true}).last()).toHaveValue('よ');await expect(d.getByLabel('海完整读音',{exact:true})).toHaveValue('');await expect(d.getByLabel('原完整读音',{exact:true})).toHaveValue('');
 await d.getByLabel('上完整读音',{exact:true}).fill('うえ');await d.getByRole('button',{name:'应用',exact:true}).click();await expect(page.getByLabel('词 夜',{exact:true})).toHaveCount(2);
 const source=page.getByLabel('词 夜',{exact:true}).first().locator('xpath=ancestor::*[@data-word-id]'),target=page.getByLabel('词 げ',{exact:true}).locator('xpath=ancestor::*[@data-word-id]');
 await source.scrollIntoViewIfNeeded();
 const id=await source.locator('[data-ruby-id]').getAttribute('data-ruby-id');const a=(await source.locator('[data-ruby-id]').boundingBox())!,b=(await target.boundingBox())!;
 await page.mouse.move(a.x+2,a.y+2);await page.mouse.down();await page.mouse.move(b.x+2,b.y+2,{steps:8});await page.waitForTimeout(180);
 await expect(source.locator('[data-drag-placeholder]')).toHaveCount(1);await expect(page.locator('[class*="dragInsertion"]')).toBeVisible();await page.mouse.up();await expect(target.locator('[data-ruby-id]')).toHaveAttribute('data-ruby-id',id!);
 await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByText('已保存',{exact:true})).toBeVisible();const saved=await(await page.request.get('/api/v1/projects/background-playback/document')).json();
 const parsed=await page.evaluate(async xml=>{const path='/src/adapters/ttml/lyric-codec.ts';return (await import(path)).parseLyricTtml(xml);},saved.document.lyrics.draftTtml);
 const main=parsed.lines[0];expect(main.words.map((w:any)=>w.text)).toEqual(['夜','空','見','上','げ']);expect(main.words[0].rubyUnits).toEqual([]);expect(main.words[4].rubyUnits).toEqual([{id,reading:'よ',beginMs:0,endMs:1000}]);expect(main.words[4]).toMatchObject({beginMs:3000,endMs:4000});
 await page.reload();await expect(page.getByLabel('读音 げ',{exact:true})).toHaveValue('よ');
 // Regeneration keeps moved (out-of-parent-time) ruby untouched.
 await page.locator('[data-outline-drag]').first().click({button:'right'});await page.getByRole('menuitem',{name:'智能日文注音',exact:true}).click();await expect(d.getByLabel('げ完整读音',{exact:true})).toHaveValue('よ');await d.getByRole('button',{name:'应用',exact:true}).click();
 await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByText('已保存',{exact:true})).toBeVisible();const after=await(await page.request.get('/api/v1/projects/background-playback/document')).json();const moved=await page.evaluate(async xml=>{const path='/src/adapters/ttml/lyric-codec.ts';return (await import(path)).parseLyricTtml(xml).lines[0].words[4].rubyUnits;},after.document.lyrics.draftTtml);expect(moved).toEqual(main.words[4].rubyUnits);
});
test('real fine segments and explicit minimal merge roundtrip atomically with main and background',async({page})=>{
 const xml='<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><p xml:id="slope" begin="0" end="4"><span begin="0" end="4">坂道</span><span ttm:role="x-bg" begin="0" end="4"><span begin="0" end="4">夜空</span></span></p><p xml:id="today" begin="4" end="8"><span begin="4" end="5">今</span><span begin="6" end="8">日</span></p></body></tt>';
 await page.goto('/projects/background-playback/edit');await importLyrics(page,{name:'japanese-segments.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
 const outline=page.locator('[data-outline-drag]');await outline.first().click();await outline.last().click({modifiers:['Shift']});await outline.first().click({button:'right'});
 const response=page.waitForResponse('**/reading/analyze');await page.getByRole('menuitem',{name:'智能日文注音',exact:true}).click();
 await test.info().attach('real-readings',{body:await(await response).text(),contentType:'application/json'});
 const dialog=page.getByRole('dialog',{name:'智能日文注音',exact:true});
 await expect(dialog.getByLabel('坂完整读音')).toHaveValue('さか');await expect(dialog.getByLabel('道完整读音')).toHaveValue('みち');
 await expect(dialog.getByLabel('夜完整读音')).toHaveValue('よ');await expect(dialog.getByLabel('空完整读音')).toHaveValue('ぞら');
 await expect(dialog.getByLabel('今完整读音')).toHaveValue('');await expect(dialog.getByRole('checkbox',{name:'自动合并多汉字词'})).not.toBeChecked();
 await dialog.getByRole('checkbox',{name:'自动合并多汉字词'}).check();await expect(dialog.getByLabel('今日完整读音')).toHaveValue('きょう');await expect(dialog.getByText('将合并')).toBeVisible();
 await dialog.getByRole('button',{name:'应用',exact:true}).click();await expect(page.getByLabel('词 今日',{exact:true})).toHaveCount(1);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.getByLabel('词 坂道',{exact:true})).toHaveCount(1);await expect(page.getByLabel('词 今',{exact:true})).toHaveCount(1);
 await page.getByRole('button',{name:'重做',exact:true}).click();await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByText('已保存',{exact:true})).toBeVisible();
 const saved=await(await page.request.get('/api/v1/projects/background-playback/document')).json();
 const parsed=await page.evaluate(async xml=>{const path='/src/adapters/ttml/lyric-codec.ts';return(await import(path)).parseLyricTtml(xml);},saved.document.lyrics.draftTtml);
 expect(parsed.lines.map((l:any)=>l.words.map((w:any)=>w.text))).toEqual([['坂','道'],['夜','空'],['今日']]);expect(parsed.lines[1].backgroundOf).toBe(parsed.lines[0].id);
 expect(parsed.lines[2].words[0]).toMatchObject({beginMs:4000,endMs:8000});
 expect(parsed.lines[2].words[0].rubyUnits.map((u:any)=>[u.reading,u.beginMs,u.endMs])).toEqual([['きょ',4000,6000],['う',6000,8000]]);
 await test.info().attach('saved-project',{body:JSON.stringify(saved,null,2),contentType:'application/json'});
 await page.reload();await expect(page.getByLabel('词 今日',{exact:true})).toHaveCount(1);await expect(page.locator('main [data-ruby-id]')).toHaveCount(9);
});
