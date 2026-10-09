import {test,expect} from '@playwright/test';
import {importLyrics} from '../fixtures/import-lyrics';
const xml='<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:studio="urn:lazulite:studio:draft"><head><metadata><ttm:agent xml:id="singer" type="person"><ttm:name>A</ttm:name></ttm:agent></metadata></head><body><p xml:id="a" ttm:agent="singer" begin="4" end="5"><span studio:id="w" begin="4" end="5">正文</span></p></body></tt>';
test('project manager exports and imports saved cues, markers and manual segments without audio',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await page.goto('/projects');await page.getByRole('button',{name:'新建项目',exact:true}).click();await page.getByLabel('项目名称',{exact:true}).fill('Karaoke phase2');await page.getByRole('button',{name:'创建项目',exact:true}).click();await page.waitForURL(/\/projects\/[^/]+\/edit/);const id=page.url().split('/projects/')[1].split('/')[0];
 await importLyrics(page,{name:'test.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
 await page.getByRole('button',{name:'卡拉 OK',exact:true}).click();await page.getByRole('button',{name:'歌手标记管理',exact:true}).click();await page.getByLabel('触发标记',{exact:true}).fill('phase2-voice');await page.getByRole('button',{name:'应用',exact:true}).click();await page.getByRole('button',{name:'添加行前导唱',exact:true}).click();
 await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByText('已保存',{exact:true})).toBeVisible();
 const saved=await(await page.request.get(`/api/v1/projects/${id}/document`)).json();
 await page.goto('/projects');const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'导出项目 Karaoke phase2',exact:true}).click();const download=await downloading;expect(download.suggestedFilename()).toBe('Karaoke phase2.lazp');await download.saveAs(test.info().outputPath('actual-project.lazp'));
 const imported=page.waitForResponse(r=>r.url().endsWith('/project-archives')&&r.request().method()==='POST');
 await page.getByLabel('Lazulite Studio 工程（*.lazp）').setInputFiles((await download.path())!);const result=await imported;expect(result.ok()).toBeTruthy();const newId=(await result.json()).id;expect(newId).not.toBe(id);
 const restored=await(await page.request.get(`/api/v1/projects/${newId}/document`)).json();expect(restored.document).toEqual(saved.document);
 await page.goto(`/projects/${newId}/edit`);await page.getByRole('button',{name:'卡拉 OK',exact:true}).click();await page.getByRole('button',{name:'歌手标记管理',exact:true}).click();await expect(page.getByLabel('触发标记',{exact:true})).toHaveValue('phase2-voice');await page.getByRole('button',{name:'关闭歌手标记管理'}).click();
 await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByText('已保存',{exact:true})).toBeVisible();
});
