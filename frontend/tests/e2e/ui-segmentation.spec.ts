import {test,expect} from '@playwright/test';
import {importLyrics} from '../fixtures/import-lyrics';
const xml='<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="1" end="4"><span begin="1" end="2">你好</span><span begin="2" end="4">世界</span></p><p begin="5" end="7"><span begin="5" end="7">再见</span></p></body></tt>';
test('batch manual drafts commit all words once, cancel and history preserve text',async({page})=>{
 await page.goto('/projects/sample-project/edit?scenario=no-music');await importLyrics(page,{name:'words.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
 await page.locator('[data-outline-drag]').first().click();
 const open=async()=>{await page.locator('[data-top-menu="tools"] summary').click();await page.getByRole('button',{name:'批处理',exact:true}).click();await page.getByRole('button',{name:'分词',exact:true}).click();};
 await open();const dialog=page.getByRole('dialog');await dialog.getByRole('combobox',{name:'范围',exact:true}).selectOption('all');
 const boundaries=dialog.getByRole('button',{name:'切分边界 1',exact:true});for(let i=0;i<3;i++)await boundaries.nth(i).click();
 await expect(dialog.getByRole('status')).toContainText('可拆分 3 词');await dialog.getByRole('button',{name:'取消',exact:true}).click();await expect(page.locator('main [data-word-id]')).toHaveCount(3);
 await open();await dialog.getByRole('combobox',{name:'范围',exact:true}).selectOption('all');for(let i=0;i<3;i++)await boundaries.nth(i).click();await dialog.getByRole('button',{name:'应用（一次撤销）'}).click();await expect(page.locator('main [data-word-id]')).toHaveCount(6);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.locator('main [data-word-id]')).toHaveCount(3);await page.getByRole('button',{name:'重做',exact:true}).click();await expect(page.locator('main [data-word-id]')).toHaveCount(6);
});
