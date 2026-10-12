import {test,expect} from '@playwright/test';
import {importLyrics} from '../fixtures/import-lyrics';
const xml='<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:studio="urn:lazulite:studio:draft" xmlns:tts="http://www.w3.org/ns/ttml#styling"><head><metadata><ttm:agent xml:id="singer" type="person"><ttm:name>A</ttm:name></ttm:agent></metadata></head><body><p xml:id="a" ttm:agent="singer" begin="4" end="7"><span studio:id="w" begin="4" end="5" tts:ruby="container"><span tts:ruby="base">愛</span><span tts:ruby="textContainer"><span studio:id="r1" tts:ruby="text" begin="4.2" end="4.3">あ</span><span studio:id="r2" tts:ruby="text" begin="4.9" end="5">い</span></span></span><span studio:id="w2" begin="5.6" end="7">正文</span></p></body></tt>';
test('project manager exports and imports saved cues and markers without audio',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await page.goto('/projects');await page.getByRole('button',{name:'新建项目',exact:true}).click();await page.getByLabel('项目名称',{exact:true}).fill('Karaoke phase2');await page.getByRole('button',{name:'创建项目',exact:true}).click();await page.waitForURL(/\/projects\/[^/]+\/edit/);const id=page.url().split('/projects/')[1].split('/')[0];
 await importLyrics(page,{name:'test.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
 await page.getByRole('button',{name:'卡拉 OK',exact:true}).click();await page.getByRole('button',{name:'歌手标记管理',exact:true}).click();await page.getByLabel('触发标记',{exact:true}).fill('phase2-voice');await page.getByRole('button',{name:'应用',exact:true}).click();await page.getByRole('button',{name:'添加行前导唱',exact:true}).click();await page.getByRole('button',{name:'插入行内导唱',exact:true}).click();await page.getByRole('button',{name:'插入 Ruby 内导唱',exact:true}).click();
 await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByText('已保存',{exact:true})).toBeVisible();
 let saved=await(await page.request.get(`/api/v1/projects/${id}/document`)).json();
 const full={...saved.document,lineOrder:['a'],acoustics:{analysisId:null,segments:[{id:'hand',beginMs:123,endMs:4567}]}};
 full.karaoke.groups.push({id:'custom',name:'自定义组'});full.karaoke.lineGroups.a='custom';full.karaoke.singerMarkers[0].marginRight=-123;full.karaoke.singerMarkers[0].skip=true;full.karaoke.groups=[];full.karaoke.lineGroups.a='';full.karaoke.outputs=[];
 const response=await page.request.put(`/api/v1/projects/${id}/document`,{headers:{origin:'http://127.0.0.1:5175','if-match':saved.revision},data:{schema_version:saved.schema_version,project_id:id,revision:saved.revision,document:full}});expect(response.ok()).toBeTruthy();
 saved=await(await page.request.get(`/api/v1/projects/${id}/document`)).json();
 await page.goto('/projects');const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'导出项目 Karaoke phase2',exact:true}).click();const download=await downloading;expect(download.suggestedFilename()).toBe('Karaoke phase2.lazp');await download.saveAs(test.info().outputPath('actual-project.lazp'));
 const imported=page.waitForResponse(r=>r.url().endsWith('/project-archives')&&r.request().method()==='POST');
 await page.getByLabel('Lazulite Studio 工程（*.lazp）').setInputFiles((await download.path())!);const result=await imported;expect(result.ok()).toBeTruthy();const newId=(await result.json()).id;expect(newId).not.toBe(id);
 const restored=await(await page.request.get(`/api/v1/projects/${newId}/document`)).json();expect(restored.document).toEqual(saved.document);
 await page.goto(`/projects/${newId}/edit`);await page.getByRole('button',{name:'卡拉 OK',exact:true}).click();await page.getByRole('button',{name:'歌手标记管理',exact:true}).click();await expect(page.getByLabel('触发标记',{exact:true})).toHaveValue('phase2-voice');await expect(page.getByLabel('跳过生成',{exact:true})).toBeChecked();await expect(page.getByLabel('触发标记',{exact:true})).toBeDisabled();await page.getByRole('button',{name:'关闭歌手标记管理'}).click();
 await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByText('已保存',{exact:true})).toBeVisible();
});

test('project space refreshes and failures never appear as zero',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await page.goto('/projects');const row=page.locator('[class*="projectRow"]').filter({hasText:'浏览器集成项目'});
 await expect(row.locator('summary')).toContainText('MiB');await row.locator('summary').click();await expect(row.getByText('源音频',{exact:true})).toBeVisible();
 await page.route('**/projects/phase2/storage',route=>route.fulfill({status:503,json:{code:'unavailable',message:'统计失败',request_id:'test',retryable:true}}));
 await row.getByRole('button',{name:'刷新空间统计'}).click();await expect(row.locator('summary')).toHaveText('统计失败',{timeout:15000});
 await page.unroute('**/projects/phase2/storage');await row.getByRole('button',{name:'刷新空间统计'}).click();await expect(row.locator('summary')).toContainText('MiB');
 await page.screenshot({path:test.info().outputPath('project-storage-light.png')});
 await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({path:test.info().outputPath('project-storage-dark.png')});
});
