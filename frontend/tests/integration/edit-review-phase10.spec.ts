import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { importLyrics } from '../fixtures/import-lyrics';

test('timed translation separators survive real save/reopen and final download with independent background envelopes',async({page})=>{
 await page.goto('/projects/phase4-background/edit');
 const xml=await page.evaluate(async()=>{const fixture='/tests/fixtures/phase10.ts',codec='/src/adapters/ttml/lyric-codec.ts';const {phase10Document}=await import(fixture);const {serializeLyricTtml}=await import(codec);return serializeLyricTtml(phase10Document(),{draft:true});});
 await importLyrics(page,{name:'phase10.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
 const put=page.waitForResponse(r=>r.url().endsWith('/api/v1/projects/phase4-background/document')&&r.request().method()==='PUT');await page.getByRole('button',{name:'保存',exact:true}).click();expect((await put).status()).toBe(200);await expect(page.getByText('已保存',{exact:true})).toBeVisible();
 const saved=await(await page.request.get('/api/v1/projects/phase4-background/document')).json();await page.reload();await expect(page.locator('[data-outline-drag]')).toHaveCount(3);
 await page.getByRole('button',{name:'文件打包',exact:true}).click();await page.getByLabel('导出格式').selectOption('ttml');const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载歌词',exact:true}).click();const final=await readFile(await(await download).path(),'utf8');
 const evidence=await page.evaluate(async({source,draft,final})=>{const path='/src/adapters/ttml/lyric-codec.ts';const {parseLyricTtml}=await import(path) as typeof import('../../src/adapters/ttml/lyric-codec');const original=parseLyricTtml(source),saved=parseLyricTtml(draft),result=parseLyricTtml(final);const semantics=(d:typeof original)=>[d.translationTracks,d.romanizationTracks].map(tracks=>tracks.map(({id,contents,...track})=>({...track,contents:contents.map(({id,...c})=>c.kind==='timed'?{...c,lineId:d.lines.findIndex(line=>line.id===c.lineId),units:c.units.map(({id,...u})=>u)}:{...c,lineId:d.lines.findIndex(line=>line.id===c.lineId)})})));return {exact:JSON.stringify(original)===JSON.stringify(saved),before:semantics(original),after:semantics(result)};},{source:xml,draft:saved.document.lyrics.draftTtml,final});
 await writeFile(test.info().outputPath('roundtrip.json'),JSON.stringify(evidence,null,2));await writeFile(test.info().outputPath('final.ttml'),final);expect(evidence.exact).toBe(true);expect(evidence.after).toEqual(evidence.before);
});
