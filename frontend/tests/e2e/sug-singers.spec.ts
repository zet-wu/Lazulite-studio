import {expect,test} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {importLyrics} from '../fixtures/import-lyrics';
const xml='<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><head><metadata><ttm:agent xml:id="a" type="person"><ttm:name>A</ttm:name></ttm:agent><ttm:agent xml:id="b" type="person"><ttm:name>B</ttm:name></ttm:agent></metadata></head><body><p ttm:agent="a" begin="4" end="5"><span begin="4" end="5">歌</span></p><p ttm:agent="b" begin="6" end="7"><span begin="6" end="7">声</span></p></body></tt>';
test('SUG singer drafts, merge download, selection independence, undo and reset',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await page.goto('/projects/sample-project/edit?scenario=no-music');
 await importLyrics(page,{name:'singers.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
 await page.getByRole('button',{name:'卡拉 OK',exact:true}).click();
 const open=page.getByRole('button',{name:'SUG 歌手管理',exact:true});await open.click();
 const dialog=page.getByRole('dialog',{name:'SUG 歌手管理'}),input=dialog.getByLabel('主歌词 · 正文',{exact:true});
 await expect(input).toHaveValue('A');await input.fill('共同演唱');await dialog.getByRole('button',{name:'B',exact:true}).click();await expect(input).toHaveValue('B');await input.fill('共同演唱');await dialog.getByRole('button',{name:'A',exact:true}).click();await expect(input).toHaveValue('共同演唱');
 await dialog.getByRole('button',{name:'取消',exact:true}).click();await expect(open).toBeFocused();await open.click();await expect(input).toHaveValue('A');
 await input.fill('共同演唱');await dialog.getByRole('button',{name:'B',exact:true}).click();await input.fill('共同演唱');await dialog.getByRole('button',{name:'应用',exact:true}).click();
 await page.getByRole('button',{name:'撤销',exact:true}).click();await open.click();await expect(input).toHaveValue('A');await page.keyboard.press('Escape');await page.getByRole('button',{name:'重做',exact:true}).click();
 await page.getByRole('button',{name:'文件打包',exact:true}).click();await page.getByLabel('导出格式',{exact:true}).selectOption('sug');let exporting=page.locator('#output-panel-lyrics');await exporting.getByLabel('主歌词 · 正文',{exact:true}).uncheck();await open.click();await expect(input).toHaveValue('共同演唱');
 await input.fill('');await expect(input).toHaveValue('A');await input.fill('长名称'.repeat(45));
 await dialog.getByRole('button',{name:'恢复默认：主歌词 · 正文'}).click();await expect(input).toHaveValue('A');await page.keyboard.press('Escape');await expect(open).toBeFocused();
 await page.getByLabel('导出格式',{exact:true}).selectOption('sug');exporting=page.locator('#output-panel-lyrics');await exporting.getByLabel('主歌词 · 正文',{exact:true}).check();const downloading=page.waitForEvent('download');await exporting.getByRole('button',{name:'导出 SUG'}).click();const download=await downloading;const bytes=await readFile((await download.path())!);expect(bytes.toString()).toContain('"name": "共同演唱"');expect(bytes.toString()).not.toContain('"name": "A"');
});
