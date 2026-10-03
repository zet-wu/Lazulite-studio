import { expect, test } from '@playwright/test';
import { importLyrics } from '../fixtures/import-lyrics';
const xml='<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><p xml:id="main" begin="0" end="4"><span begin="0" end="4">食べる</span><span ttm:role="x-bg" begin="0" end="4"><span begin="0" end="4">魂</span></span></p><p xml:id="second" begin="4" end="8"><span begin="4" end="8">今日</span></p></body></tt>';
test('real Sudachi uses unsaved text, preserves background and saves/reopens exact ruby',async({page})=>{
 await page.goto('/projects/phase4-background/edit');await importLyrics(page,{name:'ruby.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
 const before=await(await page.request.get('/api/v1/projects/phase4-background/document')).json();const outline=page.locator('[data-outline-drag]');await expect(outline).toHaveCount(3);await outline.first().click();await outline.last().click({modifiers:['Shift']});await outline.first().click({button:'right'});await page.getByRole('menuitem',{name:'生成日文注音…',exact:true}).click();
 const d=page.getByRole('dialog',{name:'生成日文注音',exact:true});await expect(d.getByLabel('食完整读音')).toHaveValue('た');await expect(d.getByLabel('魂完整读音')).toHaveValue('たましい');await expect(d.getByLabel('今日完整读音')).toHaveValue('きょう');
 expect((await(await page.request.get('/api/v1/projects/phase4-background/document')).json()).revision).toBe(before.revision);
 await d.getByRole('button',{name:'应用',exact:true}).click();await expect(page.locator('main [data-ruby-id]')).toHaveCount(7);await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByText('已保存',{exact:true})).toBeVisible();const saved=await(await page.request.get('/api/v1/projects/phase4-background/document')).json();
 expect(saved.document.lyrics.draftTtml).not.toContain('alignments');await page.reload();await expect(page.locator('main [data-ruby-id]')).toHaveCount(7);
 const check=await page.evaluate(async xml=>{const path='/src/adapters/ttml/lyric-codec.ts';const codec=await import(path);const doc=codec.parseLyricTtml(xml);const pure=codec.serializeLyricTtml(doc);const again=codec.parseLyricTtml(pure);return {words:again.lines.map((l:any)=>l.words.map((w:any)=>[w.text,w.rubyUnits.map((u:any)=>[u.reading,u.beginMs,u.endMs])])),background:!!again.lines[1].backgroundOf,pure};},saved.document.lyrics.draftTtml);
 expect(check.background).toBe(true);expect(check.words[1][0][1]).toEqual([['た',0,1000],['ま',1000,2000],['し',2000,3000],['い',3000,4000]]);expect(check.pure).not.toContain('studio:');
});
