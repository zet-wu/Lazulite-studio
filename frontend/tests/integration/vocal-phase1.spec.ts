import { test, expect, type Page } from '@playwright/test';
async function setup(page:Page){
 const asset=(await(await page.request.get('/api/v1/projects/phase0-packaging')).json()).asset.id;
 const response=await page.request.post('/api/v1/projects',{headers:{origin:'http://127.0.0.1:5175'},data:{name:'Phase 1 人声',source_asset_id:asset}});
 const pid=(await response.json()).id;
 await page.goto(`/projects/${pid}/edit`);await page.getByRole('button',{name:'音频处理',exact:true}).click();
 await page.getByRole('button',{name:'进行人声分离和声学分析'}).click();
 await expect(page.locator('[data-segment-id]').first()).toBeVisible({timeout:30000});
 return pid;
}
async function menu(page:Page){await page.locator('[data-top-menu="audio-analysis"] summary').click();}
test('reanalysis uses a new result, undo is not readopted, failure returns and stays dismissed',async({page})=>{
 const pid=await setup(page);
 const current=async()=>(await(await page.request.get(`/api/v1/projects/${pid}/document`)).json()).document.acoustics;
 await expect.poll(async()=>(await current()).analysisId).toBeTruthy();const old=await current();
 await menu(page);await page.getByRole('button',{name:'重新进行声学分析',exact:true}).click();
 await expect.poll(async()=>(await current()).analysisId).not.toBe(old.analysisId);
 await page.getByRole('button',{name:'撤销',exact:true}).click();
 await expect.poll(async()=>(await current()).analysisId).toBe(old.analysisId);
 await page.waitForTimeout(1800);expect((await current()).analysisId).toBe(old.analysisId);
 let failed=false;
 await page.route(`**/projects/${pid}/jobs/vocal`,async route=>{failed=true;await route.fulfill({json:{id:'failed-phase1',kind:'vocal',status:'failed',request:{asset_id:'source',retry_analysis_id:old.analysisId},error:{message:'测试分析失败'}}});});
 await page.route(`**/projects/${pid}/jobs`,async route=>{if(!failed)return route.continue();await route.fulfill({json:{schema_version:'studio-job-list-v1',items:[{id:'failed-phase1',kind:'vocal',status:'failed',request:{retry_analysis_id:old.analysisId},error:{message:'测试分析失败'}}]}});});
 await menu(page);await page.getByRole('button',{name:'重新进行声学分析',exact:true}).click();
 await expect(page.getByRole('alert').filter({hasText:'测试分析失败'})).toBeVisible();
 await page.getByRole('button',{name:'返回上次结果'}).click();await expect(page.locator('[data-segment-id]').first()).toBeVisible();
 await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByRole('button',{name:'音频处理',exact:true}).click();
 await page.waitForTimeout(1200);await expect(page.getByText('测试分析失败')).toHaveCount(0);
 expect(await current()).toEqual(old);
 await menu(page);await page.getByRole('button',{name:'查看最近处理结果'}).click();await expect(page.getByText('测试分析失败')).toBeVisible();
});
test('wheel consumes waveform and energy at limits, energy geometry stays fixed, add feather and shared select work',async({page})=>{
 const warnings:string[]=[];page.on('console',msg=>{if(msg.text().includes('passive event'))warnings.push(msg.text());});
 const pid=await setup(page);await page.setViewportSize({width:1280,height:480});
 await page.getByRole('button',{name:'放大波形',exact:true}).click();
 const main=page.locator('main').filter({has:page.locator('[data-vocal-tracks]')});
 for(const selector of ['[data-wheel-zoom] canvas','[aria-label="人声能量"]']){
  const target=page.locator(selector);await target.scrollIntoViewIfNeeded();
  const before=await main.evaluate(el=>el.scrollTop);const range=await page.getByText(/^视窗 /).textContent();
  await target.hover();await page.mouse.wheel(0,80);await page.waitForTimeout(100);
  expect(await main.evaluate(el=>el.scrollTop)).toBe(before);expect(await page.getByText(/^视窗 /).textContent()).not.toBe(range);
 }
 await page.getByRole('button',{name:'全曲',exact:true}).click();
 await page.getByLabel('人声能量',{exact:true}).hover();const before=await main.evaluate(el=>el.scrollTop);await page.mouse.wheel(0,100);await page.waitForTimeout(100);expect(await main.evaluate(el=>el.scrollTop)).toBe(before);
 expect(warnings).toEqual([]);
 const energy=page.getByLabel('人声能量',{exact:true});const height=(await energy.boundingBox())!.height;
 await page.route(`**/projects/${pid}/vocals/*/energy?**`,async route=>{await new Promise(r=>setTimeout(r,400));await route.fulfill({json:{start_ms:0,step_ms:10,values:[0,.003,0]}});});
 await page.getByRole('button',{name:'放大波形',exact:true}).click();await page.getByRole('button',{name:'放大波形',exact:true}).click();expect((await energy.boundingBox())!.height).toBe(height);
 await expect(page.locator('[data-vocal-tracks] small')).toHaveText('0.01');
 await page.setViewportSize({width:1440,height:900});
 await page.getByRole('button',{name:'新建人声片段',exact:true}).click();await expect(page.getByText('拖动框选新建片段')).toBeVisible();
 await page.screenshot({path:test.info().outputPath('adding-feather-light.png')});
 await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({path:test.info().outputPath('adding-feather-dark.png')});
 await page.getByRole('button',{name:'编辑',exact:true}).click({force:true});await expect(page.getByText('拖动框选新建片段')).toHaveCount(0);await expect(page.getByRole('button',{name:'新建人声片段',exact:true})).toBeFocused();
 const source=page.getByLabel('播放音源',{exact:true});await source.click();await expect(page.getByRole('listbox')).toBeVisible();await page.keyboard.press('End');await page.keyboard.press('Enter');await expect(source).not.toHaveValue('');
 await source.click();await page.keyboard.press('Escape');await expect(source).toBeFocused();await expect(page.getByRole('listbox')).toHaveCount(0);
});
test('waveform creation restores layers, segment loop captures once, group movement undoes atomically',async({page})=>{
 const pid=await setup(page);
 await page.getByLabel('吸附',{exact:true}).uncheck();
 await page.getByRole('button',{name:'片段',exact:true}).click();await page.getByRole('button',{name:'能量',exact:true}).click();
 await page.getByRole('button',{name:'新建人声片段',exact:true}).click();
 const wave=(await page.getByRole('slider',{name:'波形进度',exact:true}).boundingBox())!;
 await page.mouse.move(wave.x+wave.width*.7,wave.y+20);await page.mouse.down();await page.mouse.move(wave.x+wave.width*.85,wave.y+20,{steps:4});await page.mouse.up();
 await expect(page.locator('[data-vocal-lane]')).toHaveCount(0);await expect(page.getByLabel('人声能量',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'片段',exact:true}).click();await expect(page.locator('[data-segment-id]')).toHaveCount(2);
 const blocks=page.locator('[data-segment-id]');await blocks.nth(1).click();
 const loop=page.getByRole('button',{name:'循环当前单元',exact:true});await expect(loop).toBeEnabled();await loop.click();
 const a=await page.getByRole('button',{name:/^A /}).textContent();
 await blocks.first().click({modifiers:['Control']});await expect(loop).toBeDisabled();
 const before=await blocks.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')));
 const r=(await blocks.first().boundingBox())!;await page.mouse.move(r.x+r.width/2,r.y+9);await page.mouse.down();await page.mouse.move(r.x+r.width/2+20,r.y+9,{steps:4});await page.mouse.up();
 const moved=await blocks.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')));expect(moved[0]).not.toBe(before[0]);expect(moved[1]).not.toBe(before[1]);
 expect(await page.getByRole('button',{name:/^A /}).textContent()).toBe(a);
 await page.getByRole('button',{name:'撤销',exact:true}).click();expect(await blocks.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')))).toEqual(before);
 // A click with snapping enabled must not shift an off-grid interval.
 await page.getByLabel('吸附',{exact:true}).check();await blocks.nth(1).click();expect(await blocks.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')))).toEqual(before);
 await expect.poll(async()=>(await(await page.request.get(`/api/v1/projects/${pid}/document`)).json()).document.acoustics.segments.length).toBe(2);
});
test('processing intent survives reload and snapped creation uses shared beat settings',async({page})=>{
 const pid=await setup(page);
 await expect.poll(async()=>(await(await page.request.get(`/api/v1/projects/${pid}/document`)).json()).document.acoustics.analysisId).toBeTruthy();
 const oldId=(await(await page.request.get(`/api/v1/projects/${pid}/document`)).json()).document.acoustics.analysisId;
 let hold=true;
 await page.route(`**/projects/${pid}/jobs`,async route=>{
  const response=await route.fetch();const body=await response.json();
  if(hold)body.items=body.items.map((j:{id:string;status:string})=>j.id===oldId?j:{...j,status:'running'});
  await route.fulfill({json:body});
 });
 await menu(page);await page.getByRole('button',{name:'重新进行声学分析',exact:true}).click();
 await expect.poll(()=>page.evaluate(pid=>sessionStorage.getItem(`studio-vocal-intent-v1:${pid}`),pid)).toBeTruthy();
 const intent=await page.evaluate(pid=>JSON.parse(sessionStorage.getItem(`studio-vocal-intent-v1:${pid}`)!),pid);
 hold=false;await page.reload();await page.getByRole('button',{name:'音频处理',exact:true}).click();
 await expect.poll(async()=>(await(await page.request.get(`/api/v1/projects/${pid}/document`)).json()).document.acoustics.analysisId).toBe(intent.id);
 await page.getByRole('button',{name:'新建人声片段',exact:true}).click();
 const r=(await page.getByRole('slider',{name:'波形进度',exact:true}).boundingBox())!;
 await page.mouse.move(r.x+r.width*.252,r.y+20);await page.mouse.down();await page.mouse.move(r.x+r.width*.373,r.y+20,{steps:3});await page.mouse.up();
 await expect(page.locator('[data-segment-id]')).toHaveCount(2);
 const added=await page.locator('[data-segment-id][aria-pressed=true]').getAttribute('aria-label');expect(added).toContain('2000–3000');
});
