import {expect,test} from '@playwright/test';
import {importMergeSplit} from '../../fixtures/merge-split';
test('main merge, song part and clear Ruby survive real save/reopen with one-step undo',async({page})=>{
 await page.goto('/projects/background-playback/edit');await importMergeSplit(page,3);
 const outlines=page.locator('[data-outline-drag]');await outlines.nth(0).click();await outlines.nth(2).click({modifiers:['Control']});
 const part=page.getByLabel('歌曲段落',{exact:true});await part.fill('Custom Part');await part.press('Enter');
 await outlines.nth(0).click({button:'right'});await page.getByRole('menuitem',{name:'合并所选',exact:true}).click();await expect(outlines).toHaveCount(3);
 const line=page.locator('main section[data-line-id="merge-line-0"]');await expect(line.locator('[data-word-id]')).toHaveCount(8);
 await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByText('已保存',{exact:true})).toBeVisible();
 const before=await(await page.request.get('/api/v1/projects/background-playback/document')).json();await page.reload();await expect(line.locator('[data-word-id]')).toHaveCount(8);
 await page.locator('[data-outline-drag]').first().click();await expect(page.getByLabel('歌曲段落',{exact:true})).toHaveValue('Custom Part');
 await page.locator('[data-top-menu="tools"] summary').click();await page.getByRole('button',{name:'批处理',exact:true}).click();await page.getByRole('button',{name:'清除注音',exact:true}).click();await page.getByRole('button',{name:'应用（一次撤销）'}).click();await expect(line.locator('[data-ruby-id]')).toHaveCount(0);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(line.locator('[data-ruby-id]')).toHaveCount(4);
 await page.getByRole('button',{name:'重做',exact:true}).click();await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByText('已保存',{exact:true})).toBeVisible();await page.reload();await expect(line.locator('[data-ruby-id]')).toHaveCount(0);
 const saved=await(await page.request.get('/api/v1/projects/background-playback/document')).json();
 const shape=await page.evaluate(async({before,after})=>{const cp='/src/adapters/ttml/lyric-codec.ts';const c=await import(cp);const a=c.parseLyricTtml(before,{draft:true}),b=c.parseLyricTtml(after,{draft:true}),r=c.parseLyricTtml(c.serializeLyricTtml(b,{draft:true}),{draft:true});return {roundtrip:JSON.stringify(b)===JSON.stringify(r),parts:b.lines.filter((line:any)=>!line.backgroundOf).map((line:any)=>line.songPart),sameAttachments:JSON.stringify(a.translationTracks)===JSON.stringify(b.translationTracks)&&JSON.stringify(a.romanizationTracks)===JSON.stringify(b.romanizationTracks),words:b.lines[0].words.length};},{before:before.document.lyrics.draftTtml,after:saved.document.lyrics.draftTtml});
 expect(shape).toEqual({roundtrip:true,parts:['Custom Part',null],sameAttachments:true,words:8});
});
