import {expect,test} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {importLyrics} from '../fixtures/import-lyrics';
test('offset drafts block downloads, keep disabled values and commit once',async({page})=>{
 await page.goto('/projects/sample-project/edit?scenario=no-music');
 await importLyrics(page,{name:'offset.ttml',mimeType:'application/xml',buffer:Buffer.from('<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="1" end="2"><span begin="1" end="2">歌</span></p></body></tt>')});
 await page.getByRole('button',{name:'卡拉 OK',exact:true}).click();
 const open=()=>page.getByRole('button',{name:'导出 NicoKara',exact:true}).click();await open();
 const dialog=page.getByRole('dialog'),input=dialog.getByLabel('主歌词 · 正文 @Offset',{exact:true}),check=dialog.getByLabel('主歌词 · 正文',{exact:true});
 await input.fill('-');await dialog.getByRole('button',{name:'下载 ZIP'}).click();await expect(input).toHaveAttribute('aria-invalid','true');await expect(input).toBeFocused();await expect(dialog.getByRole('alert')).toHaveCount(0);
 await check.uncheck();await expect(input).toBeDisabled();
 await check.check();await dialog.getByRole('button',{name:'下载 ZIP'}).click();await expect(input).toBeFocused();
 await input.fill('-120');await input.press('Enter');await expect(input).toHaveAttribute('aria-invalid','false');
 await check.uncheck();await check.check();await expect(input).toHaveValue('-120');
 const download=page.waitForEvent('download');await dialog.getByRole('button',{name:'下载 ZIP'}).click();const bytes=await readFile((await(await download).path())!);expect(bytes.toString()).toContain('@Offset=-120\r\n');expect(bytes.toString()).toContain('[00:01:00]歌[00:02:00]');
 await input.fill('400');await input.press('Enter');await dialog.getByRole('button',{name:'关闭导出 Nicokara'}).click();await page.getByRole('button',{name:'撤销',exact:true}).click();await open();await expect(input).toHaveValue('-120');
});
