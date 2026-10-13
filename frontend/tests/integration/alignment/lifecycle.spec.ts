import {expect,test,type Page} from '@playwright/test';
const pid='music-packaging',url=`/api/v1/projects/${pid}/document`;
async function setup(page:Page){
 const before=await(await page.request.get(url)).json();
 const xml='<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft"><body><p xml:id="a" studio:null="begin end"><span studio:id="w" studio:null="begin end">love</span></p></body></tt>';
 const snapshot={...before.document,karaoke:{...before.document.karaoke,lineGroups:{a:'main'},cues:[]},lyrics:{draftTtml:xml},lineOrder:[],editing:{emptyBeats:{},ignoredSyncLineIds:[],skippedAlignmentLineIds:[],endLinks:{}},acoustics:{analysisId:null,segments:[]}};
 const response=await page.request.put(url,{headers:{origin:'http://127.0.0.1:5175','if-match':before.revision},data:{schema_version:before.schema_version,project_id:pid,revision:before.revision,document:snapshot}});expect(response.ok()).toBeTruthy();
 const asset=(await(await page.request.get(`/api/v1/projects/${pid}`)).json()).asset.id;
 const state={status:'running',revision:'',starts:0,cancels:0,results:0,disconnects:0,polls:0,error:null as null|{cpu_retry:boolean;message:string}};
 await page.route('**/api/v1/capabilities',route=>route.fulfill({json:{schema_version:'studio-capabilities-v1',items:[{id:'job.alignment',enabled:true,reason:null}]}}));
 await page.route(`**/api/v1/projects/${pid}/jobs/alignment`,async route=>{state.revision=route.request().postDataJSON().params.revision;state.starts++;await route.fulfill({status:202,json:{id:'life',kind:'alignment',status:'running'}});});
 await page.route(/\/api\/v1\/jobs\/life(?:-cpu)?$/,async route=>{state.polls++;if(state.disconnects>0){state.disconnects--;await route.abort('failed');}else await route.fulfill({json:{id:'life',kind:'alignment',status:state.status,error:state.error}});});
 await page.route('**/api/v1/jobs/life/cancel',async route=>{state.cancels++;state.status='cancelled';await route.fulfill({json:{id:'life',kind:'alignment',status:'cancelled'}});});
 await page.route(/\/api\/v1\/jobs\/life(?:-cpu)?\/result$/,async route=>{state.results++;await route.fulfill({json:{kind:'alignment',binding:{project_id:pid,asset_id:asset,revision:state.revision},acoustics:null,scope:[{object_id:'w',word_id:'w',line_id:'a',kind:'word',target_ids:['u']}],mapping:[{unit_id:'u',object_id:'w',word_id:'w',line_id:'a',kind:'word'}],alignment:{schema:'lazulite-japanese-result-v1',units:[{unit_id:'u',line_id:'a',proposed_timing:{start:{time:1,source:'test'},end:{time:2,source:'test'}}}]}}});});
 await page.goto(`/projects/${pid}/edit`);await page.getByRole('button',{name:'音频处理',exact:true}).click();await page.getByRole('button',{name:'自动对齐',exact:true}).click();await page.getByRole('button',{name:'开始对齐',exact:true}).click();await expect(page.getByRole('button',{name:'正在对齐',exact:true})).toBeDisabled();
 await expect.poll(()=>state.polls).toBeGreaterThan(0);
 return state;
}
test('short disconnect reconnects the original run and a failed save retains local undo',async({page})=>{
 const state=await setup(page);state.disconnects=2;
 await expect(page.getByRole('alert').filter({hasText:'连接中断'})).toBeVisible();
 await page.getByRole('alert').filter({hasText:'连接中断'}).locator('..').getByRole('button',{name:'关闭提示'}).click();
 await expect(page.getByRole('button',{name:'取消任务',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'编辑',exact:true}).click();await expect(page.getByRole('textbox',{name:'词 love',exact:true})).toBeDisabled();
 let fail=true;
 await page.route(`**${url}`,async route=>{if(route.request().method()==='PUT'&&fail)return route.fulfill({status:500,json:{message:'保存测试失败'}});return route.continue();});
 state.status='succeeded';await expect(page.getByRole('status').filter({hasText:'已更新歌词时间'})).toBeVisible();
 const saveError=page.getByRole('alert').filter({hasText:'请求失败，请重试'});await expect(saveError).toBeVisible();
 await saveError.locator('..').getByRole('button',{name:'关闭提示'}).click();await expect(saveError).toHaveCount(0);await expect(page.getByText('未保存',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'保存',exact:true}).click();await expect(saveError).toBeVisible();
 await page.getByRole('button',{name:'编辑',exact:true}).click();await expect(page.getByRole('button',{name:'撤销',exact:true})).toBeEnabled();
 fail=false;await page.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(async()=> (await(await page.request.get(url)).json()).document.lyrics.draftTtml).toContain('begin="00:01.000"');
 expect(state.starts).toBe(1);expect(state.results).toBe(1);
});
test('another window changing revision prevents adoption and releases editing',async({page})=>{
 const state=await setup(page);const current=await(await page.request.get(url)).json();
 const response=await page.request.put(url,{headers:{origin:'http://127.0.0.1:5175','if-match':current.revision},data:{schema_version:current.schema_version,project_id:pid,revision:current.revision,document:current.document}});expect(response.ok()).toBeTruthy();
 state.status='succeeded';await expect(page.getByRole('alert').filter({hasText:'项目版本或音频已改变'})).toBeVisible();
 await page.getByRole('button',{name:'编辑',exact:true}).click();await expect(page.getByRole('textbox',{name:'词 love',exact:true})).toBeEnabled();
 expect((await(await page.request.get(url)).json()).document.lyrics.draftTtml).toContain('studio:null="begin end"');
});
test('leaving revokes adoption and reopening does not inherit the lock',async({page})=>{
 const state=await setup(page);await page.goto('/projects');await expect.poll(()=>state.cancels).toBeGreaterThan(0);state.status='succeeded';
 await page.goto(`/projects/${pid}/edit`);await page.getByRole('button',{name:'编辑',exact:true}).click();await expect(page.getByRole('textbox',{name:'词 love',exact:true})).toBeEnabled();
 expect(state.results).toBe(0);expect((await(await page.request.get(url)).json()).document.lyrics.draftTtml).toContain('studio:null="begin end"');
});

test(`feedback timeout, keyboard dismiss and repeated operation`,async({page})=>{

 const state=await setup(page);

 state.status='succeeded';
 const success=page.getByRole('status').filter({hasText:'已更新歌词时间'});await expect(success).toBeVisible();
 const close=success.locator('..').getByRole('button',{name:'关闭提示'});
 await close.focus();await close.press('Enter');await expect(success).toHaveCount(0);
 expect(await page.evaluate(()=>document.activeElement?.tagName)).toBe('BUTTON');
 await page.getByRole('button',{name:'自动对齐',exact:true}).click();await page.getByRole('button',{name:'开始对齐',exact:true}).click();
 const unchanged=page.getByRole('status').filter({hasText:'未更新歌词时间'});await expect(unchanged).toBeVisible();await expect(unchanged).toHaveCount(0,{timeout:6000});
 await page.getByRole('button',{name:'自动对齐',exact:true}).click();await page.getByRole('button',{name:'开始对齐',exact:true}).click();await expect(unchanged).toBeVisible();
 // New project context does not inherit the old result or its timer.
 await page.goto('/projects');await page.goto(`/projects/${pid}/edit`);await expect(unchanged).toHaveCount(0);
 expect(state.starts).toBe(3);
});

test('device failure requires explicit CPU retry and applies once',async({page})=>{
 const state=await setup(page);let retries=0;
 await page.route('**/api/v1/jobs/life/retry-cpu',async route=>{
  expect(route.request().postDataJSON().revision).toBe(state.revision);retries++;state.status='running';state.error=null;
  await route.fulfill({status:202,json:{id:'life-cpu',kind:'alignment',status:'running'}});
 });
 state.error={cpu_retry:true,message:'GPU 计算失败'};state.status='failed';
 await expect(page.getByRole('button',{name:'使用 CPU 重试',exact:true})).toBeVisible();
 expect(state.starts).toBe(1);expect(retries).toBe(0);
 await page.getByRole('button',{name:'使用 CPU 重试',exact:true}).click();
 await expect.poll(()=>retries).toBe(1);state.status='succeeded';
 await expect(page.getByRole('status').filter({hasText:'已更新歌词时间'})).toBeVisible();
 expect(state.starts).toBe(1);expect(state.results).toBe(1);
});

test('changing the draft revokes CPU retry application intent',async({page})=>{
 const state=await setup(page);let retries=0;
 await page.route('**/api/v1/jobs/life/retry-cpu',async route=>{retries++;await route.fulfill({status:500,json:{message:'should not launch'}});});
 state.error={cpu_retry:true,message:'GPU 计算失败'};state.status='failed';
 await expect(page.getByRole('button',{name:'使用 CPU 重试',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'编辑',exact:true}).click();
 await page.getByRole('textbox',{name:'词 love',exact:true}).fill('changed');
 await page.getByRole('button',{name:'音频处理',exact:true}).click();
 await page.getByRole('button',{name:'使用 CPU 重试',exact:true}).click();
 await expect(page.getByRole('alert').filter({hasText:'应用意图已改变'})).toBeVisible();
 expect(retries).toBe(0);expect(state.results).toBe(0);
});
test('running controls survive long disconnection and mode switches without releasing editing',async({page})=>{
 const state=await setup(page);state.disconnects=999;
 await expect(page.getByRole('alert').filter({hasText:'连接中断'})).toBeVisible();
 const running=page.locator('[data-message-bar]').filter({has:page.getByRole('button',{name:'取消任务',exact:true})});
 await expect(running.getByRole('button',{name:'关闭提示'})).toHaveCount(0);
 await page.clock.install();await page.clock.runFor(31000);
 await page.getByRole('button',{name:'编辑',exact:true}).click();await expect(page.getByRole('textbox',{name:'词 love',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'取消任务',exact:true})).toBeVisible();
 state.disconnects=0;state.status='cancelled';await page.clock.runFor(1000);
 await expect(page.getByRole('textbox',{name:'词 love',exact:true})).toBeEnabled();
 await expect(page.getByRole('status').filter({hasText:'已取消对齐'})).toBeVisible();
});
test('dismissing a task failure removes its retry action until explicitly reopened',async({page})=>{
 const state=await setup(page);state.error={cpu_retry:true,message:'GPU 计算失败'};state.status='failed';
 const failure=page.locator('[data-message-bar]').filter({hasText:'GPU 计算失败'});
 await expect(failure.getByRole('button',{name:'使用 CPU 重试'})).toBeVisible();
 await failure.getByRole('button',{name:'关闭提示'}).click();
 await expect(page.getByRole('button',{name:'使用 CPU 重试'})).toHaveCount(0);
 await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByRole('button',{name:'音频处理',exact:true}).click();
 await expect(failure).toHaveCount(0);await page.getByRole('button',{name:'查看最近对齐结果'}).click();
 await expect(failure.getByRole('button',{name:'使用 CPU 重试'})).toBeVisible();
});

test('a server cancellation keeps the row and editing lock until the terminal state',async({page})=>{
 const state=await setup(page);state.status='cancel_requested';
 await expect(page.getByRole('button',{name:'取消任务',exact:true})).toBeDisabled();
 await expect(page.locator('[data-message-bar]').filter({has:page.getByRole('button',{name:'取消任务',exact:true})})).toContainText('正在取消');
 await page.getByRole('button',{name:'编辑',exact:true}).click();await expect(page.getByRole('textbox',{name:'词 love',exact:true})).toBeDisabled();
 await page.locator('[data-top-menu="settings"] summary').click();await page.getByRole('button',{name:'计算设备…'}).click();
 await expect(page.getByRole('dialog',{name:'计算设备',exact:true})).toBeVisible();await page.getByRole('button',{name:'关闭计算设备'}).click();
 await expect(page.locator('[data-top-menu="settings"] summary')).toBeFocused();
 state.status='cancelled';await expect(page.getByRole('textbox',{name:'词 love',exact:true})).toBeEnabled();
});
