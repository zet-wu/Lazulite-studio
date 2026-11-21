import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {importLyrics} from '../fixtures/import-lyrics';
const xml='<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="1" end="3"><span begin="1" end="2">歌</span><span xmlns:ttm="http://www.w3.org/ns/ttml#metadata" ttm:role="x-translation" xml:lang="en">song</span></p></body></tt>';
test('translation-only TXT, TTML selection restoration and undo share the saved output configuration',async({page},info)=>{
 await page.goto('/projects/sample-project/edit?scenario=no-music');await importLyrics(page,{name:'selected.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
 await page.getByRole('button',{name:'文件打包',exact:true}).click();const pane=page.locator('#output-panel-lyrics');
 await page.getByLabel('导出格式',{exact:true}).selectOption('txt');
 const body=pane.getByRole('checkbox',{name:'主歌词 · 正文',exact:true}),translation=pane.getByRole('checkbox',{name:/主歌词 · 翻译 1/});
 await body.uncheck();await translation.check();
 const wait=page.waitForEvent('download');await pane.getByRole('button',{name:/^导出 纯文本/}).click();const file=await wait;expect(await readFile((await file.path())!,'utf8')).toBe('song\n');
 await page.getByLabel('导出格式',{exact:true}).selectOption('ttml');await expect(pane.getByRole('checkbox')).toHaveCount(0);
 await page.getByLabel('导出格式',{exact:true}).selectOption('qrc');await expect(body).not.toBeChecked();await expect(translation).toBeChecked();
 await pane.getByRole('button',{name:'导出对照',exact:true}).click();await expect(pane.getByRole('table')).toBeVisible();
 await page.screenshot({path:info.outputPath('selected-light.png')});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({path:info.outputPath('selected-dark.png')});
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(translation).not.toBeChecked();await page.getByRole('button',{name:'重做',exact:true}).click();await expect(translation).toBeChecked();
 await page.getByRole('button',{name:'保存',exact:true}).click();await page.reload();await page.getByRole('button',{name:'文件打包',exact:true}).click();await page.getByLabel('导出格式',{exact:true}).selectOption('txt');await expect(translation).toBeChecked();await expect(body).not.toBeChecked();
});
