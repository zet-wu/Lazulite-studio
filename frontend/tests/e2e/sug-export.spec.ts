import {expect,test} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {importLyrics} from '../fixtures/import-lyrics';
test('SUG shares committed offsets, validates drafts, returns from validation and downloads native JSON',async({page})=>{
 await page.goto('/projects/sample-project/edit?scenario=no-music');
 await importLyrics(page,{name:'sug.ttml',mimeType:'application/xml',buffer:Buffer.from('<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="1" end="3"><span begin="1.003" end="2.009">歌</span></p></body></tt>')});
 await page.getByRole('button',{name:'卡拉 OK',exact:true}).click();
 const open=page.getByRole('button',{name:'导出 SUG',exact:true});await open.click();
 const dialog=page.getByRole('dialog',{name:'导出 SUG'}),input=dialog.getByLabel('主歌词 · 正文 输出偏移（毫秒）',{exact:true});
 await input.fill('-');await dialog.getByRole('button',{name:'查看校验'}).click();await expect(input).toBeFocused();await expect(input).toHaveAttribute('aria-invalid','true');
 await input.fill('200');await dialog.getByRole('button',{name:'查看校验'}).click();await expect(page.getByLabel('校验格式筛选')).toHaveValue('sug');await page.getByLabel('校验格式筛选').selectOption('all');await page.getByRole('button',{name:'返回 SUG 导出'}).click();await expect(input).toHaveValue('200');
 if(process.env.SUG_CONTRACT_DIR){await page.screenshot({path:`${process.env.SUG_CONTRACT_DIR}/sug-dialog.png`});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({path:`${process.env.SUG_CONTRACT_DIR}/sug-dialog-dark.png`});}
 const download=page.waitForEvent('download');await dialog.getByRole('button',{name:'下载 ZIP'}).click();const bytes=await readFile((await(await download).path())!);expect(bytes.toString()).toContain('"global_offset_ms": 200');expect(bytes.toString()).toContain('"sentence_end_ts": 2009');expect(bytes.toString()).not.toContain('@Emoji');
 if(process.env.SUG_CONTRACT_DIR)await writeFile(`${process.env.SUG_CONTRACT_DIR}/browser.zip`,bytes);
 await page.keyboard.press('Escape');await expect(open).toBeFocused();await page.getByRole('button',{name:'导出 NicoKara',exact:true}).click();await expect(page.getByRole('dialog').getByLabel('主歌词 · 正文 @Offset',{exact:true})).toHaveValue('200');
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'撤销',exact:true}).click();await open.click();await expect(input).toHaveValue('0');
 await input.fill('-2000');await dialog.getByRole('button',{name:'查看校验'}).click();await page.getByText('时间范围 · 2 项，涉及 1 行',{exact:true}).click();await page.getByText('无法定位的序列化问题 · 1 项',{exact:true}).click();await page.getByRole('button',{name:'请调整输出偏移：内容移到零之前或超出安全整数',exact:true}).click();await expect(input).toBeFocused();await expect(input).toHaveValue('-2000');
});
