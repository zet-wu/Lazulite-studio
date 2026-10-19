import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { importLyrics } from '../fixtures/import-lyrics';

test('romanization input and composition survive resize',async({page})=>{
 const zoom = 1.25;

 await page.setViewportSize({width:1440,height:1000});await page.goto('/projects/sample-project/edit?scenario=no-music');
 const xml='<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1" end="5"><span begin="1" end="2">が</span><span begin="2" end="3">も</span><span begin="3" end="3.5">わ</span><span begin="3.5" end="4">つ</span><span begin="4" end="5">ち</span></p></div></body></tt>';
 await importLyrics(page,{name:'short.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
 await page.locator('[data-outline-drag]').first().click({button:'right'});await page.getByRole('menuitem',{name:'生成日文罗马字音译…'}).click();
 const dialog=page.getByRole('dialog',{name:'生成日文罗马字音译',exact:true});await dialog.getByLabel('输出',{exact:true}).selectOption('timed');
 await page.evaluate(zoom=>{document.documentElement.style.zoom=String(zoom);window.dispatchEvent(new Event('resize'));},zoom);
 const inputs=dialog.getByRole('textbox');expect(await inputs.evaluateAll(nodes=>nodes.map(n=>(n as HTMLInputElement).value.trim()))).toEqual(['ga','mo','wa','tsu','chi']);
 const first=inputs.first();await first.fill('long manual input '.repeat(40));await first.evaluate((node:HTMLInputElement)=>{node.dataset.original='yes';node.setSelectionRange(7,12);node.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'あ'}));});
 await page.setViewportSize({width:1280,height:900});await first.press('Escape');await expect(first).toBeFocused();await expect(first).toHaveAttribute('data-original','yes');await expect(first).toHaveValue('long manual input '.repeat(40));
 expect(await first.evaluate((node:HTMLInputElement)=>[node.selectionStart,node.selectionEnd])).toEqual([7,12]);

 await first.dispatchEvent('compositionend',{data:'あ'});await inputs.nth(1).fill(' ');await expect(inputs.nth(1)).toHaveValue(' ');
});

test('format selection downloads expected content and exposes overlap details',async({page})=>{
 await page.goto('/projects/sample-project/edit?scenario=no-music');
 const xml=await page.evaluate(async()=>{const fixturePath='/tests/fixtures/translation-whitespace.ts',codecPath='/src/adapters/ttml/lyric-codec.ts';const {translationWhitespaceDocument}=await import(fixturePath);const {serializeLyricTtml}=await import(codecPath);return serializeLyricTtml(translationWhitespaceDocument(),{draft:true});});
 await importLyrics(page,{name:'output-formats-layout.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});await page.getByRole('button',{name:'文件打包',exact:true}).click();
 await page.getByRole('tab',{name:'歌词校验',exact:true}).click();await expect(page.getByText('当前检查未发现问题',{exact:true})).toBeVisible();
 await page.getByText('导出对照',{exact:true}).click();const table=page.getByRole('table',{name:'所选格式导出对照'});
 for(const format of ['ttml','ass']){
  await page.getByLabel('导出格式').selectOption(format);
  if(format==='ass'){await expect(table.getByText('分轨字幕',{exact:true})).toHaveCount(2);const result=table.getByRole('row').last().locator('td > span');await result.focus();await expect(result.getByRole('tooltip')).toBeVisible();await expect(result).toContainText('1、2');}
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'下载歌词',exact:true}).click();const download=await pending;const output=await readFile(await download.path(),'utf8');await writeFile(test.info().outputPath(`output.${format}`),output);expect(output).toContain('Main');
  if(format==='ass'){expect(output.match(/^Dialogue:/gm)).toHaveLength(8);expect(output).toContain('roman-main');expect(output).toContain('0:00:00.50,0:00:06.50');}
 }
});
test(`ASS-only issue locates its attachment`,async({page})=>{
 await page.goto('/projects/sample-project/edit?scenario=no-music');
 const xml=await page.evaluate(async()=>{const fixture='/tests/fixtures/translation-whitespace.ts',codec='/src/adapters/ttml/lyric-codec.ts';const {translationWhitespaceDocument}=await import(fixture);const {serializeLyricTtml}=await import(codec);const d=translationWhitespaceDocument();d.romanizationTracks[0].contents[0].units[2].beginMs=1400;return serializeLyricTtml(d,{draft:true});});
 await importLyrics(page,{name:'blocked.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});await page.getByRole('button',{name:'文件打包',exact:true}).click();await page.getByRole('tab',{name:'歌词校验',exact:true}).click();
 const rule=page.getByRole('button',{name:/^时间顺序/}).locator('..');await rule.locator(':scope > button[aria-expanded]').click();await rule.getByRole('button',{name:/^第 1 行/}).click();
 const issue=page.getByRole('button',{name:/音译.*重叠或倒序/});await expect(issue).toHaveCount(1);
 await expect(issue.locator('..')).toContainText('阻塞 · ASS');await issue.focus();await issue.press('Enter');await expect(page.getByRole('button',{name:'编辑',exact:true})).toHaveAttribute('aria-current','page');

});
