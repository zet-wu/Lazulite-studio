import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { importLyrics } from '../fixtures/import-lyrics';

for(const theme of ['light','dark'])for(const zoom of [1,1.25,1.5])test(`short romanization text fits, identity and composition survive resize ${theme} ${zoom}`,async({page})=>{
 await page.addInitScript(theme=>localStorage.setItem('lazulite-editor-theme',theme),theme);
 await page.setViewportSize({width:1440,height:1000});await page.goto('/projects/sample-project/edit?scenario=no-music');
 const xml='<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1" end="5"><span begin="1" end="2">が</span><span begin="2" end="3">も</span><span begin="3" end="3.5">わ</span><span begin="3.5" end="4">つ</span><span begin="4" end="5">ち</span></p></div></body></tt>';
 await importLyrics(page,{name:'short.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
 await page.locator('[data-outline-drag]').first().click({button:'right'});await page.getByRole('menuitem',{name:'生成日文罗马字音译…'}).click();
 const dialog=page.getByRole('dialog',{name:'生成日文罗马字音译',exact:true});await dialog.getByLabel('输出',{exact:true}).selectOption('timed');
 await page.evaluate(zoom=>{document.documentElement.style.zoom=String(zoom);window.dispatchEvent(new Event('resize'));},zoom);
 const inputs=dialog.getByRole('textbox');expect(await inputs.evaluateAll(nodes=>nodes.map(n=>(n as HTMLInputElement).value.trim()))).toEqual(['ga','mo','wa','tsu','chi']);
 const metrics=await inputs.evaluateAll(nodes=>nodes.map(node=>{const el=node as HTMLInputElement,style=getComputedStyle(el),ctx=document.createElement('canvas').getContext('2d')!;ctx.font=style.font;return {text:el.value,needed:ctx.measureText(el.value).width,available:el.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),scroll:el.scrollWidth,width:el.clientWidth};}));
 for(const m of metrics){expect(m.available).toBeGreaterThanOrEqual(m.needed+2);expect(m.scroll-m.width).toBeLessThanOrEqual(1);}
 const first=inputs.first();await first.fill('long manual input '.repeat(40));await first.evaluate((node:HTMLInputElement)=>{node.dataset.original='yes';node.setSelectionRange(7,12);node.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'あ'}));});
 await page.setViewportSize({width:1280,height:900});await first.press('Escape');await expect(first).toBeFocused();await expect(first).toHaveAttribute('data-original','yes');await expect(first).toHaveValue('long manual input '.repeat(40));
 expect(await first.evaluate((node:HTMLInputElement)=>[node.selectionStart,node.selectionEnd])).toEqual([7,12]);
 expect(await first.evaluate((node:HTMLInputElement)=>node.scrollWidth>node.clientWidth)).toBe(true);
 await first.dispatchEvent('compositionend',{data:'あ'});await inputs.nth(1).fill(' ');await expect(inputs.nth(1)).toHaveValue(' ');
 expect(await inputs.nth(1).evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(32*zoom);
 await page.screenshot({path:test.info().outputPath(`roman-${theme}-${zoom}.png`)});await writeFile(test.info().outputPath('metrics.json'),JSON.stringify(metrics,null,2));
});

test('real downloads use the same gates, six-row table switches and overlap details work with missing line times',async({page})=>{
 await page.goto('/projects/sample-project/edit?scenario=no-music');
 const xml=await page.evaluate(async()=>{const fixturePath='/tests/fixtures/phase10.ts',codecPath='/src/adapters/ttml/lyric-codec.ts';const {phase10Document}=await import(fixturePath);const {serializeLyricTtml}=await import(codecPath);return serializeLyricTtml(phase10Document(),{draft:true});});
 await importLyrics(page,{name:'phase10.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});await page.getByRole('button',{name:'文件打包',exact:true}).click();
 await page.getByRole('button',{name:'歌词校验',exact:true}).click();await expect(page.getByText('当前检查未发现问题',{exact:true})).toBeVisible();
 await page.getByText('导出对照',{exact:true}).click();const table=page.getByRole('table',{name:'所选格式导出对照'});await expect(table.getByRole('row')).toHaveCount(7);await expect(table.getByRole('columnheader')).toHaveCount(2);
 for(const format of ['ttml','eslrc','qrc','yrc','lys','ass']){
  await page.getByLabel('导出格式').selectOption(format);
  if(format==='ass'){await expect(table.getByText('分轨字幕',{exact:true})).toHaveCount(2);const result=table.getByRole('row').last().locator('td > span');await result.focus();await expect(result.getByRole('tooltip')).toBeVisible();await expect(result).toContainText('1、2');await page.screenshot({path:test.info().outputPath('comparison.png')});}
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'下载歌词',exact:true}).click();const download=await pending;const output=await readFile(await download.path(),'utf8');await writeFile(test.info().outputPath(`output.${format}`),output);expect(output).toContain('Main');
  if(format==='ass'){expect(output.match(/^Dialogue:/gm)).toHaveLength(8);expect(output).toContain('roman-main');expect(output).toContain('0:00:00.50,0:00:06.50');}
 }
 const overlap=await page.evaluate(async()=>{const fixturePath='/tests/fixtures/phase10.ts',description='/src/adapters/format-description.ts';const {phase10Document}=await import(fixturePath);const {describeLyricFormat}=await import(description);const d=phase10Document();d.lines.push({...d.lines[2],id:'missing',beginMs:null});return describeLyricFormat(d,'lrc')[5].detail;});expect(overlap).toContain('1、2');
});
for(const theme of ['light','dark'])test(`ASS-only issue locates its attachment with shared inline styling and latest gates in ${theme}`,async({page})=>{
 await page.addInitScript(theme=>localStorage.setItem('lazulite-editor-theme',theme),theme);await page.goto('/projects/sample-project/edit?scenario=no-music');
 const xml=await page.evaluate(async()=>{const fixture='/tests/fixtures/phase10.ts',codec='/src/adapters/ttml/lyric-codec.ts';const {phase10Document}=await import(fixture);const {serializeLyricTtml}=await import(codec);const d=phase10Document();d.romanizationTracks[0].contents[0].units[2].beginMs=1400;return serializeLyricTtml(d,{draft:true});});
 await importLyrics(page,{name:'blocked.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});await page.getByRole('button',{name:'文件打包',exact:true}).click();await page.getByRole('button',{name:'歌词校验',exact:true}).click();
 const rule=page.locator('details').filter({has:page.locator('summary').filter({hasText:/^时间顺序/})}).first();await rule.locator(':scope > summary').click();await rule.locator('details > summary').click();
 const issue=page.getByRole('button',{name:/音译.*重叠或倒序/});await expect(issue).toHaveCount(1);await expect(issue).toHaveAttribute('data-role','inline');
 expect(await issue.evaluate(e=>getComputedStyle(e).borderTopColor)).toBe('rgba(0, 0, 0, 0)');await expect(issue.locator('..')).toContainText('阻塞 · ASS');await issue.focus();await issue.press('Enter');await expect(page.getByRole('button',{name:'编辑',exact:true})).toHaveAttribute('aria-current','page');
 await page.getByRole('button',{name:'文件打包',exact:true}).click();await page.getByLabel('导出格式').selectOption('ass');await page.getByRole('button',{name:'下载歌词',exact:true}).click();await expect(page.getByText(/本次操作有 1 项/)).toBeVisible();
 await page.screenshot({path:test.info().outputPath(`inline-${theme}.png`)});
 await page.getByLabel('导出格式').selectOption('txt');const pending=page.waitForEvent('download');await page.getByRole('button',{name:'下载歌词',exact:true}).click();await pending;
});
