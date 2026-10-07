import { uploadFixtureMusic } from '../fixtures/upload-music';
import { test, expect } from '@playwright/test';
test('vocal processing adopts automatically, shares history, assigns and reopens a complete project', async ({page})=>{
 await page.goto('/projects/phase0-packaging/edit');
 await page.getByRole('button',{name:'音频处理',exact:true}).click();
 await expect(page.getByRole('heading',{name:'大纲',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'分离人声',exact:true}).click();
 await expect(page.locator('[data-segment-id]').first()).toBeVisible({timeout:30000});
 let envelope=await (await page.request.get('/api/v1/projects/phase0-packaging/document')).json();

 await expect(page.locator('[data-segment-id]').first()).toBeVisible();
 await page.locator('[data-vocal-tracks] [data-segment-id]').first().click();
 await page.getByRole('button',{name:'分配',exact:true}).click();
 await expect.poll(async()=>{const e=await (await page.request.get('/api/v1/projects/phase0-packaging/document')).json();return e.document.lyrics.draftTtml;}).not.toBe(envelope.document.lyrics.draftTtml);
 envelope=await (await page.request.get('/api/v1/projects/phase0-packaging/document')).json();
 expect(envelope.document.acoustics.analysisId).toBeTruthy();
 await page.getByRole('button',{name:'新建人声片段',exact:true}).click();
 const lane=page.locator('[data-vocal-lane]');const box=(await lane.boundingBox())!;
 await page.mouse.move(box.x+box.width*.8,box.y+12);await page.mouse.down();await page.mouse.move(box.x+box.width*.65,box.y+12,{steps:5});await page.mouse.up();
 await expect(page.locator('[data-segment-id]')).toHaveCount(2);
 await page.keyboard.press('Control+z');await expect(page.locator('[data-segment-id]')).toHaveCount(1);
 await page.keyboard.press('Control+Shift+z');await expect(page.locator('[data-segment-id]')).toHaveCount(2);
 await page.getByRole('button',{name:'新建人声片段',exact:true}).click();await page.keyboard.press('Tab');await expect(page.locator('[data-vocal-focus]')).toBeFocused();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'新建人声片段',exact:true})).toBeFocused();await expect(page.getByText('拖动框选新增片段，Esc 取消')).toHaveCount(0);
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
 const asset = await uploadFixtureMusic(page);
 const made=await page.request.post('/api/v1/projects',{headers:{origin:'http://127.0.0.1:5175'},data:{name:'人声验收',upload_id:asset}});
 const pid=(await made.json()).id;
 const before=await (await page.request.get(`/api/v1/projects/${pid}/document`)).json();
 const saved=await page.request.put(`/api/v1/projects/${pid}/document`,{headers:{origin:'http://127.0.0.1:5175','if-match':before.revision},data:{schema_version:before.schema_version,project_id:pid,revision:before.revision,document:{...before.document,lyrics:{draftTtml:xml}}}});expect(saved.ok()).toBeTruthy();
 await page.goto(`/projects/${pid}/edit`);await page.getByRole('button',{name:'音频处理',exact:true}).click();
 await page.getByRole('button',{name:'分离人声',exact:true}).click();
 await expect(page.locator('[data-segment-id]').first()).toBeVisible({timeout:30000});
 return pid;
}
test('segment edits cancel atomically, merge/delete preserve assigned lyrics, drag assignment matches button',async({page})=>{
 const pid=await newProject(page,'<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p xml:id="unknown">未知行</p><p xml:id="second">第二行</p></div></body></tt>');
 await page.locator('[data-segment-id]').first().click({button:'right'});await page.getByRole('menuitem',{name:'删除选中片段'}).click();
 const add=async(a:number,b:number)=>{await page.getByRole('button',{name:'新建人声片段',exact:true}).click();const box=(await page.locator('[data-vocal-lane]').boundingBox())!;await page.mouse.move(box.x+box.width*a,box.y+12);await page.mouse.down();await page.mouse.move(box.x+box.width*b,box.y+12,{steps:4});await page.mouse.up();};
 await add(.2,.4);await expect(page.locator('[data-segment-id]')).toHaveCount(1);
 await page.getByRole('button',{name:'新建人声片段',exact:true}).click();await page.locator('[data-vocal-lane]').click({position:{x:10,y:10}});await expect(page.locator('[data-segment-id]')).toHaveCount(1);
 const first=page.locator('[data-segment-id]').first();const original=await first.getAttribute('aria-label');const box=(await first.boundingBox())!;
 await page.mouse.move(box.x+box.width*.5,box.y+12);await page.mouse.down();await page.mouse.move(box.x+box.width*.5+40,box.y+12,{steps:3});await page.keyboard.press('Escape');await page.mouse.up();await expect(first).toHaveAttribute('aria-label',original!);
 const bounds=async()=>((await first.getAttribute('aria-label'))!.match(/\d+/g)!).map(Number).slice(1);
 const initial=await bounds();
 for(const side of [1,2]){
  const edge=(await first.locator('span').nth(side).boundingBox())!;
  await page.mouse.move(edge.x+edge.width/2,edge.y+10);await page.mouse.down();await page.mouse.move(edge.x+edge.width/2+20,edge.y+10,{steps:3});await page.mouse.up();
  const changed=await bounds();expect(changed[side-1]).toBeGreaterThan(initial[side-1]);expect(changed[2-side]).toBe(initial[2-side]);
  await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(first).toHaveAttribute('aria-label',original!);
 }
 await page.getByRole('complementary',{name:'音频处理大纲'}).locator('[draggable]').first().dragTo(first);
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

test('real Demucs audio preserves position rate loop and pause across independent sources',async({page})=>{
 test.skip(!process.env.STUDIO_VOCAL_REAL_ROOT,'Requires an explicitly supplied real Demucs result');
 const before=await(await page.request.get('/api/v1/projects/real-vocal/document')).json();
 const result=(await(await page.request.get('/api/v1/projects/real-vocal/vocals')).json()).items.find((r:{status:string})=>r.status==='ready');
 expect(result).toBeTruthy();
 const saved=await page.request.put('/api/v1/projects/real-vocal/document',{headers:{origin:'http://127.0.0.1:5175','if-match':before.revision},data:{schema_version:before.schema_version,project_id:'real-vocal',revision:before.revision,document:{...before.document,acoustics:{analysisId:result.id,segments:result.segments}}}});expect(saved.ok()).toBeTruthy();
 await page.goto('/projects/real-vocal/edit');await page.getByRole('button',{name:'音频处理',exact:true}).click();
 await expect(page.locator('[data-segment-id]').first()).toBeVisible();
 await page.locator('audio').evaluate((el:HTMLAudioElement)=>{el.currentTime=20;});
 await page.getByRole('slider',{name:'播放速度',exact:true}).fill('0.75');
 await page.getByRole('button',{name:/^A /}).click();
 await page.locator('audio').evaluate((el:HTMLAudioElement)=>{el.currentTime=24;});await page.getByRole('button',{name:/^B /}).click();
 await page.getByLabel('播放音源',{exact:true}).selectOption('actual-demucs');
 await expect.poll(()=>page.locator('audio').evaluate((el:HTMLAudioElement)=>el.readyState)).toBeGreaterThan(0);
 await expect.poll(()=>page.locator('audio').evaluate((el:HTMLAudioElement)=>el.currentTime)).toBeCloseTo(24,1);
 expect(await page.locator('audio').evaluate((el:HTMLAudioElement)=>el.paused)).toBeTruthy();
 expect(await page.locator('audio').evaluate((el:HTMLAudioElement)=>el.playbackRate)).toBe(.75);
 await expect(page.getByRole('button',{name:/^A 00:20/})).toBeVisible();await expect(page.getByRole('button',{name:/^B 00:24/})).toBeVisible();
 await page.getByRole('button',{name:'播放',exact:true}).click();await expect.poll(()=>page.locator('audio').evaluate((el:HTMLAudioElement)=>el.paused)).toBeFalsy();
 await page.getByLabel('播放音源',{exact:true}).selectOption('');await expect.poll(()=>page.locator('audio').evaluate((el:HTMLAudioElement)=>el.paused)).toBeFalsy();
 await page.getByRole('button',{name:'暂停',exact:true}).click();
 await page.getByLabel('波形／声谱图音源',{exact:true}).selectOption('actual-demucs');
 for(let i=0;i<5;i++)await page.getByRole('button',{name:'放大波形',exact:true}).click();
 await page.getByRole('button',{name:'声谱图',exact:true}).click();
 await expect(page.getByText('能量加载失败 · 重试')).toHaveCount(0);
 await expect(page.locator('[aria-label="人声能量"] polyline')).not.toHaveAttribute('points','',{timeout:20000});
 await expect.poll(async()=>page.locator('[data-spectrum-ready]').evaluate(el=>Number(el.getAttribute('data-spectrum-ready'))>0&&el.getAttribute('data-spectrum-ready')===el.getAttribute('data-spectrum-wanted'))).toBe(true);
 await page.locator('[aria-label="声谱图"]').scrollIntoViewIfNeeded();await page.screenshot({path:test.info().outputPath('real-vocal-spectrum.png')});
 await page.route('**/audio?vocal=actual-demucs',route=>route.abort());
 await page.getByLabel('播放音源',{exact:true}).selectOption('actual-demucs');await expect(page.getByText('所选音源无法播放，请重试 · 重试')).toBeVisible();
 await expect(page.getByLabel('播放音源',{exact:true})).toHaveValue('actual-demucs');
});

test('out of range assignment preserves lyrics and points to hidden offending units',async({page})=>{
 const pid=await newProject(page,'<tt xmlns="http://www.w3.org/ns/ttml"><body><p xml:id="long" begin="00:01.000" end="00:08.000"><span begin="00:01.000" end="00:08.000">长行</span></p></body></tt>');
 const before=(await(await page.request.get(`/api/v1/projects/${pid}/document`)).json()).document.lyrics.draftTtml;
 await page.getByRole('button',{name:'新建人声片段',exact:true}).click();const box=(await page.locator('[data-vocal-lane]').boundingBox())!;
 await page.mouse.move(box.x+box.width*.7,box.y+12);await page.mouse.down();await page.mouse.move(box.x+box.width*.8,box.y+12);await page.mouse.up();
 await page.getByRole('button',{name:'分配',exact:true}).click();
 await expect(page.getByRole('complementary',{name:'音频处理大纲'})).toContainText('未修改歌词或链接');
 await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'定位词2',exact:true}).click();
 await expect(page.locator('main [data-word-id][data-assignment-error]')).toBeVisible();
 expect(await page.locator('main [data-word-id][data-assignment-error]').evaluate(e=>getComputedStyle(e).animationName)).toBe('none');
 const after=(await(await page.request.get(`/api/v1/projects/${pid}/document`)).json()).document.lyrics.draftTtml;
 expect(await page.evaluate(async ({before,after})=>{const path='/src/adapters/ttml/lyric-codec.ts';const {parseLyricTtml}=await import(path);return JSON.stringify(parseLyricTtml(before))===JSON.stringify(parseLyricTtml(after));},{before,after})).toBe(true);
});
