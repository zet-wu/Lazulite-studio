import { test, expect } from '@playwright/test';
test('vocal processing adopts explicitly, shares history, assigns and reopens a complete project', async ({page})=>{
 await page.goto('/projects/phase0-packaging/edit');
 await page.getByRole('button',{name:'音频处理',exact:true}).click();
 await expect(page.getByRole('heading',{name:'大纲',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'进行人声分离及声学分析',exact:true}).click();
 const adopt=page.getByRole('button',{name:'采用',exact:true}).first();await expect(adopt).toBeEnabled({timeout:30000});
 let envelope=await (await page.request.get('/api/v1/projects/phase0-packaging/document')).json();
 expect(envelope.document.acoustics.analysisId).toBeNull();
 await adopt.click();
 await expect(page.locator('[data-segment-id]').first()).toBeVisible();
 await page.locator('[data-vocal-tracks] [data-segment-id]').first().click();
 await page.getByRole('button',{name:'分配',exact:true}).click();
 await expect.poll(async()=>{const e=await (await page.request.get('/api/v1/projects/phase0-packaging/document')).json();return e.document.lyrics.draftTtml;}).not.toBe(envelope.document.lyrics.draftTtml);
 envelope=await (await page.request.get('/api/v1/projects/phase0-packaging/document')).json();
 expect(envelope.document.acoustics.analysisId).toBeTruthy();
 await page.getByRole('button',{name:'新增人声片段',exact:true}).click();
 const lane=page.locator('[data-vocal-lane]');const box=(await lane.boundingBox())!;
 await page.mouse.move(box.x+box.width*.8,box.y+12);await page.mouse.down();await page.mouse.move(box.x+box.width*.65,box.y+12,{steps:5});await page.mouse.up();
 await expect(page.locator('[data-segment-id]')).toHaveCount(2);
 await page.keyboard.press('Control+z');await expect(page.locator('[data-segment-id]')).toHaveCount(1);
 await page.keyboard.press('Control+Shift+z');await expect(page.locator('[data-segment-id]')).toHaveCount(2);
 await page.getByRole('button',{name:'新增人声片段',exact:true}).click();await page.keyboard.press('Escape');await expect(page.getByText('拖动框选新增片段，Esc 取消')).toHaveCount(0);
 await page.getByLabel('播放音源',{exact:true}).selectOption({index:1});await expect(page.getByText('正在加载音源…')).toHaveCount(0);
 await page.getByLabel('波形／声谱图音源',{exact:true}).selectOption('');
 await expect(page.locator('audio')).toHaveCount(1);
 await page.getByRole('button',{name:'编辑',exact:true}).click();await expect(page.locator('audio')).toHaveCount(1);
 await expect(page.getByLabel('播放音源',{exact:true})).not.toHaveValue('');
 await page.getByRole('button',{name:'音频处理',exact:true}).click();
 await expect.poll(async()=>{const e=await (await page.request.get('/api/v1/projects/phase0-packaging/document')).json();return e.document.acoustics.segments.length;}).toBe(2);
 await page.reload();await page.getByRole('button',{name:'音频处理',exact:true}).click();await expect(page.locator('[data-segment-id]')).toHaveCount(2);
 await page.screenshot({path:test.info().outputPath('vocal-light.png')});
});

async function newProject(page: import('@playwright/test').Page, xml: string) {
 const asset=(await (await page.request.get('/api/v1/projects/phase0-packaging')).json()).asset.id;
 const made=await page.request.post('/api/v1/projects',{headers:{origin:'http://127.0.0.1:5175'},data:{name:'人声验收',source_asset_id:asset}});
 const pid=(await made.json()).id;
 const before=await (await page.request.get(`/api/v1/projects/${pid}/document`)).json();
 const saved=await page.request.put(`/api/v1/projects/${pid}/document`,{headers:{origin:'http://127.0.0.1:5175','if-match':before.revision},data:{schema_version:before.schema_version,project_id:pid,revision:before.revision,document:{...before.document,lyrics:{draftTtml:xml}}}});expect(saved.ok()).toBeTruthy();
 await page.goto(`/projects/${pid}/edit`);await page.getByRole('button',{name:'音频处理',exact:true}).click();
 return pid;
}
test('segment edits cancel atomically, merge/delete preserve assigned lyrics, drag assignment matches button',async({page})=>{
 const pid=await newProject(page,'<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p xml:id="unknown">未知行</p><p xml:id="second">第二行</p></div></body></tt>');
 const add=async(a:number,b:number)=>{await page.getByRole('button',{name:'新增人声片段',exact:true}).click();const box=(await page.locator('[data-vocal-lane]').boundingBox())!;await page.mouse.move(box.x+box.width*a,box.y+12);await page.mouse.down();await page.mouse.move(box.x+box.width*b,box.y+12,{steps:4});await page.mouse.up();};
 await add(.2,.4);await expect(page.locator('[data-segment-id]')).toHaveCount(1);
 await page.getByRole('button',{name:'新增人声片段',exact:true}).click();await page.locator('[data-vocal-lane]').click({position:{x:10,y:10}});await expect(page.locator('[data-segment-id]')).toHaveCount(1);
 const first=page.locator('[data-segment-id]').first();const original=await first.getAttribute('aria-label');const box=(await first.boundingBox())!;
 await page.mouse.move(box.x+box.width*.5,box.y+12);await page.mouse.down();await page.mouse.move(box.x+box.width*.5+40,box.y+12,{steps:3});await page.keyboard.press('Escape');await page.mouse.up();await expect(first).toHaveAttribute('aria-label',original!);
 await page.getByRole('button',{name:'拖动分配 L1',exact:true}).dragTo(first);
 await expect(page.getByRole('complementary',{name:'音频处理大纲'})).not.toContainText('未定起点 – 未定终点\n↗');
 await expect.poll(async()=>{const e=await(await page.request.get(`/api/v1/projects/${pid}/document`)).json();return e.document.lyrics.draftTtml;}).toContain('begin=');
 const assigned=(await(await page.request.get(`/api/v1/projects/${pid}/document`)).json()).document.lyrics.draftTtml;
 await add(.5,.65);await expect(page.locator('[data-segment-id]')).toHaveCount(2);
 await first.click();await page.locator('[data-segment-id]').nth(1).click({modifiers:['Control']});await first.click({button:'right'});
 await page.getByRole('menuitem',{name:'合并选中片段'}).click();await expect(page.locator('[data-segment-id]')).toHaveCount(1);
 await first.click({button:'right'});await page.getByRole('menuitem',{name:'删除选中片段'}).click();await expect(page.locator('[data-segment-id]')).toHaveCount(0);
 await expect.poll(async()=>{const e=await(await page.request.get(`/api/v1/projects/${pid}/document`)).json();return e.document.acoustics.segments.length;}).toBe(0);
 expect((await(await page.request.get(`/api/v1/projects/${pid}/document`)).json()).document.lyrics.draftTtml).toBe(assigned);
});

test('audio layouts use one timeline at desktop widths in both themes',async({page})=>{
 await newProject(page,'<tt xmlns="http://www.w3.org/ns/ttml"><body><p xml:id="u">尚未定时</p></body></tt>');
 for(const width of [1280,1440,1920])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await expect(page.locator('#timeline-plots')).toHaveCount(1);await expect(page.locator('audio')).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:test.info().outputPath(`vocal-${width}-${theme}.png`)});
 }
});
