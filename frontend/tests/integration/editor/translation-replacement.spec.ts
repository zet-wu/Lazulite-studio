import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { importLyrics } from '../../fixtures/import-lyrics';

test('timed replacement translations survive real save, reload, final download and structured reimport', async ({ page }) => {
 const source = await readFile(new URL('../../../../tests/fixtures/ttml/timeline-translation-external.ttml', import.meta.url), 'utf8');
 await page.goto('/projects/background-playback/edit');
 await importLyrics(page, { name:'translations.ttml', mimeType:'application/xml', buffer:Buffer.from(source) });
 const line = page.locator('main section[data-line-id="L1"]');
 const input = line.getByRole('textbox',{name:'翻译 1 单元 1',exact:true});
 await input.fill(' 修改 '); await input.press('Enter');
 const response = page.waitForResponse(r => r.url().endsWith('/background-playback/document') && r.request().method() === 'PUT');
 await page.getByRole('button',{name:'保存',exact:true}).click(); expect((await response).status()).toBe(200);
 await expect(page.getByText('已保存',{exact:true})).toBeVisible();
 const saved = await (await page.request.get('/api/v1/projects/background-playback/document')).json();
 const compare = (xml: string, identities: boolean) => page.evaluate(async ({xml,identities}) => {
  const path='/src/adapters/ttml/lyric-codec.ts'; const {parseLyricTtml}=await import(path) as typeof import('../../../src/adapters/ttml/lyric-codec');
  const d=parseLyricTtml(xml);
  return d.lines.map(line=>({id:line.id,backgroundOf:line.backgroundOf,text:line.words.map(word=>word.text).join(''),translations:d.translationTracks.flatMap(track => track.contents.filter(content => content.lineId === line.id).map(({ lineId: _lineId, ...content }) => ({ ...content, language: track.language, purpose: track.purpose }))).map(item=>identities ? item : {language:item.language,purpose:item.purpose,kind:item.kind,...(item.kind==='plain'?{text:item.text}:{units:item.units.map(({id,...unit})=>unit)})})}));
 }, {xml,identities});
 const before = await compare(saved.document.lyrics.draftTtml,true);
 await page.reload(); await expect(input).toHaveValue(' 修改 ');
 const reopened = await (await page.request.get('/api/v1/projects/background-playback/document')).json();
 expect(await compare(reopened.document.lyrics.draftTtml,true)).toEqual(before);
 await page.getByRole('button',{name:'文件打包',exact:true}).click();
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'下载歌词',exact:true}).click();
 const xml=await readFile(await (await downloaded).path(),'utf8');
 expect(xml).not.toContain('studio:'); expect(xml).toContain('type="replacement"');
 expect(await compare(xml,false)).toEqual(await compare(saved.document.lyrics.draftTtml,false));
 await importLyrics(page,{name:'reopened.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
 await expect(input).toHaveValue(' 修改 ');
 await writeFile(test.info().outputPath('translation-final.ttml'),xml);
 await writeFile(test.info().outputPath('translation-save.json'),JSON.stringify(before,null,2));
});
