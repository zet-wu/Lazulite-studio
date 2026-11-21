import {expect,test} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {importLyrics} from '../fixtures/import-lyrics';
test('unified SUG export commits offsets, locates invalid drafts and downloads its prepared archive',async({page})=>{
 await page.goto('/projects/sample-project/edit?scenario=no-music');
 await importLyrics(page,{name:'sug.ttml',mimeType:'application/xml',buffer:Buffer.from('<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="1" end="3"><span begin="1.003" end="2.009">歌</span></p></body></tt>')});
 await page.getByRole('button',{name:'卡拉 OK',exact:true}).click();await page.getByRole('button',{name:'导出 SUG',exact:true}).click();
 const pane=page.locator('#output-panel-lyrics'),button=pane.getByRole('button',{name:'导出 SUG',exact:true}),input=pane.getByLabel('主歌词 · 正文 输出偏移（毫秒）',{exact:true});
 await expect(page.getByRole('dialog')).toHaveCount(0);await input.fill('-');await button.click();await expect(input).toBeFocused();await expect(input).toHaveAttribute('aria-invalid','true');
 await input.fill('200');await input.press('Enter');await expect(input).toHaveValue('200');
 await page.getByLabel('校验格式筛选').selectOption('all');await page.getByLabel('校验格式筛选').selectOption('current');
 await page.getByRole('tab',{name:'音乐文件嵌入',exact:true}).click();await page.keyboard.press('ArrowLeft');await expect(page.getByRole('tab',{name:'歌词导出',exact:true})).toBeFocused();await expect(input).toHaveValue('200');
 if(process.env.SUG_CONTRACT_DIR){await page.screenshot({path:`${process.env.SUG_CONTRACT_DIR}/sug-panel.png`});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({path:`${process.env.SUG_CONTRACT_DIR}/sug-panel-dark.png`});}
 const download=page.waitForEvent('download');await button.click();const bytes=await readFile((await(await download).path())!);expect(bytes.toString()).toContain('"global_offset_ms": 200');expect(bytes.toString()).toContain('"sentence_end_ts": 2009');expect(bytes.toString()).toContain('summary.txt');
 if(process.env.SUG_CONTRACT_DIR)await writeFile(`${process.env.SUG_CONTRACT_DIR}/browser.zip`,bytes);
 await page.getByLabel('导出格式',{exact:true}).selectOption('nicokara');await expect(pane.getByLabel('主歌词 · 正文 @Offset',{exact:true})).toHaveValue('200');
 await page.getByRole('button',{name:'撤销',exact:true}).click();await page.getByLabel('导出格式',{exact:true}).selectOption('sug');await expect(input).toHaveValue('0');
 await input.fill('-2000');await input.press('Enter');await button.click();await expect(pane).toContainText('请调整输出偏移');
});
