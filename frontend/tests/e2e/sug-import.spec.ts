import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../fixtures/external-current.sug',import.meta.url));
test('external SUG uses one import transaction, preserves incomplete timing, singers and auxiliaries through save/reopen',async({page},info)=>{
 const mediaRequests:string[]=[];page.on('request',request=>{if(request.url().includes('unreadable'))mediaRequests.push(request.url());});
 await page.goto('/projects/sample-project/edit?scenario=no-music');
 await page.locator('[data-settings-button]').click();await page.getByRole('button',{name:'AMLL 兼容设置',exact:true}).click();
 for(const name of ['禁用词级歌手','禁用独立背景歌手']){const setting=page.getByRole('switch',{name,exact:true});if(await setting.count())await setting.uncheck();}
 await page.getByRole('button',{name:'关闭设置',exact:true}).click();
 await page.getByRole('button',{name:'歌词获取',exact:true}).click();await page.getByRole('tab',{name:'文件',exact:true}).click();
 const input=page.locator('input[type=file][accept^=".ttml"]');await input.setInputFiles({name:'external.sug',mimeType:'application/json',buffer:source});
 await expect(page.getByText(/SUG 尚缺 1 个检查点/)).toBeVisible();await page.screenshot({path:process.env.SUG_CONTRACT_DIR?`${process.env.SUG_CONTRACT_DIR}/import-preview.png`:info.outputPath('preview.png')});
 await page.getByRole('button',{name:'确认导入并替换歌词',exact:true}).click();await expect(page.getByRole('textbox',{name:'词 今は',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.getByRole('textbox',{name:'词 今は',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'重做',exact:true}).click();await expect(page.getByRole('textbox',{name:'词 今は',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'保存',exact:true}).click();await page.reload();await expect(page.getByRole('textbox',{name:'词 今は',exact:true})).toBeVisible();
 const read=page.getByRole('textbox',{name:'词 é结束秒数',exact:true});await expect(read).toHaveValue('');
 await page.locator('summary').filter({hasText:'歌词设置'}).click();await page.getByRole('button',{name:'歌手管理',exact:true}).click();const dialog=page.getByRole('dialog',{name:'歌手管理'});await expect(dialog.locator('tbody tr')).toHaveCount(2);await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'歌词获取',exact:true}).click();await page.getByRole('tab',{name:'文件',exact:true}).click();await input.setInputFiles({name:'broken.sug',mimeType:'application/json',buffer:Buffer.from('{"version":"0.3.0","sentences":"broken"}')});await expect(page.getByRole('status')).toContainText('SUG 数据损坏');await page.getByRole('button',{name:'编辑',exact:true}).click();await expect(page.getByRole('textbox',{name:'词 今は',exact:true})).toBeVisible();
 expect(mediaRequests).toEqual([]);
});
