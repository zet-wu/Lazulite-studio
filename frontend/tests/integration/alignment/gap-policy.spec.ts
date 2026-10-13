import {expect,test,type Page} from '@playwright/test';
const pid='media-offset',url=`/api/v1/projects/${pid}/document`;
async function setup(page:Page){
 const before=await(await page.request.get(url)).json();
 const xml='<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft"><body><p xml:id="a" begin="1" end="5"><span studio:id="w1" begin="1" end="2">love</span><span studio:id="space" begin="2" end="2.1"> </span><span studio:id="w2" begin="2.3" end="5">you</span></p></body></tt>';
 const snapshot={...before.document,karaoke:{...before.document.karaoke,lineGroups:{a:'main'},cues:[]},lyrics:{draftTtml:xml},lineOrder:[],editing:{emptyBeats:{},ignoredSyncLineIds:[],skippedAlignmentLineIds:[],endLinks:{}},acoustics:{analysisId:null,segments:[{id:'s',beginMs:0,endMs:6000}]}};
 expect((await page.request.put(url,{headers:{origin:'http://127.0.0.1:5175','if-match':before.revision},data:{schema_version:before.schema_version,project_id:pid,revision:before.revision,document:snapshot}})).ok()).toBeTruthy();
 const asset=(await(await page.request.get(`/api/v1/projects/${pid}`)).json()).asset.id;
 const state={params:{} as Record<string,unknown>,starts:0,key:'',status:'running',retry:true,results:0};
 await page.route('**/api/v1/capabilities',route=>route.fulfill({json:{schema_version:'studio-capabilities-v1',items:[{id:'job.alignment',enabled:true,reason:null}]}}));
 await page.route(`**/api/v1/projects/${pid}/jobs/alignment`,async route=>{
  const params=route.request().postDataJSON().params;state.starts++;
  if(state.retry){state.params=params;state.key=route.request().headers()['idempotency-key'];state.retry=false;return route.abort('failed');}
  expect(params).toEqual(state.params);expect(route.request().headers()['idempotency-key']).toBe(state.key);
  return route.fulfill({status:202,json:{id:'gaps',kind:'alignment',status:'running'}});
 });
 await page.route('**/api/v1/jobs/gaps',route=>route.fulfill({json:{id:'gaps',kind:'alignment',status:state.status}}));
 await page.route('**/api/v1/jobs/gaps/cancel',route=>{state.status='cancelled';return route.fulfill({json:{id:'gaps',kind:'alignment',status:'cancelled'}});});
 await page.route('**/api/v1/jobs/gaps/result',route=>{state.results++;return route.fulfill({json:{kind:'alignment',binding:{project_id:pid,revision:state.params.revision,asset_id:asset},acoustics:null,
  scope:[{object_id:'w1',word_id:'w1',line_id:'a',kind:'word',target_ids:['u1']},{object_id:'space',word_id:'space',line_id:'a',kind:'word',target_ids:[]},{object_id:'w2',word_id:'w2',line_id:'a',kind:'word',target_ids:['u2']}],
  mapping:['w1','w2'].map((id,i)=>({unit_id:`u${i+1}`,object_id:id,word_id:id,line_id:'a',kind:'word'})),
  alignment:{schema:'lazulite-japanese-result-v1',units:[[1,2],[2.3,5]].map(([start,end],i)=>({unit_id:`u${i+1}`,line_id:'a',proposed_timing:{start:{time:start,source:'interpolated'},end:{time:end,source:'acoustic_path'}}}))}}});});
 await page.goto(`/projects/${pid}/edit`);await page.getByRole('button',{name:'音频处理',exact:true}).click();await page.getByRole('button',{name:'自动对齐',exact:true}).click();
 return state;
}
test(`short-gap controls, retry, atomic save and reopen`,async({page})=>{

 const state=await setup(page),dialog=page.getByRole('dialog',{name:'自动对齐',exact:true}),box=dialog.getByRole('checkbox',{name:'将短于 ms 的行内空隙并入前词'}),number=dialog.getByRole('spinbutton',{name:'行内空隙阈值（毫秒）'});
 await expect(box).not.toBeChecked();await expect(number).toBeDisabled();await expect(number).toHaveValue('500');
 await dialog.getByText('将短于',{exact:true}).click();await expect(box).toBeChecked();await box.focus();await page.keyboard.press('Tab');await expect(number).toBeFocused();
 await number.click();await number.fill('601');await number.press('ArrowUp');await expect(number).toHaveValue('602');await expect(box).toBeChecked();
 await box.uncheck();await expect(number).toBeDisabled();await box.check();await expect(number).toHaveValue('602');
 for(const value of ['','0','-1','1.5','1e309','9007199254740992']){
  await number.fill(value);await dialog.getByRole('button',{name:'开始对齐',exact:true}).click();await expect(dialog.getByRole('alert')).toHaveText('行内空隙阈值必须为正的安全整数毫秒');expect(state.starts).toBe(0);
 }
 await number.fill('500');
 await dialog.getByRole('checkbox',{name:'清空未匹配单元时间',exact:true}).check();
 await dialog.getByRole('button',{name:'开始对齐',exact:true}).click();await expect.poll(()=>state.starts).toBe(2);
 expect(state.params).toMatchObject({merge_short_gaps:true,gap_threshold_ms:500,clear_unmatched:true,line_blank:false,rest_blank:false,rest_token:false});
 state.status='succeeded';await expect(page.getByRole('status').filter({hasText:'合并 1 处行内空隙'})).toBeVisible();
 const saved=async()=>(await(await page.request.get(url)).json()).document.lyrics.draftTtml as string;
 await expect.poll(saved).toContain('end="00:02.300"');const merged=await saved();expect(merged).toContain('studio:null="begin end"');expect(state.results).toBe(1);
 await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByRole('button',{name:'撤销',exact:true}).click();await expect.poll(saved).toContain('end="00:02.100"');
 await page.getByRole('button',{name:'重做',exact:true}).click();await expect.poll(saved).toBe(merged);await page.reload();await page.getByRole('button',{name:'音频处理',exact:true}).click();await page.getByRole('button',{name:'自动对齐',exact:true}).click();
 await expect(box).not.toBeChecked();await expect(number).toHaveValue('500');await expect(number).toBeDisabled();
 await box.check();await number.fill('700');await dialog.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'自动对齐',exact:true}).click();await expect(number).toHaveValue('500');await expect(box).not.toBeChecked();
});
test('disabled invalid draft is normalized without blocking launch',async({page})=>{
 const state=await setup(page),dialog=page.getByRole('dialog',{name:'自动对齐',exact:true}),box=dialog.getByRole('checkbox',{name:'将短于 ms 的行内空隙并入前词'}),number=dialog.getByRole('spinbutton');
 await box.check();await number.fill('-1');await box.uncheck();await dialog.getByRole('button',{name:'开始对齐',exact:true}).click();await expect.poll(()=>state.starts).toBe(2);expect(state.params).toMatchObject({merge_short_gaps:false,gap_threshold_ms:500});
 state.status='succeeded';await expect(page.getByRole('status').filter({hasText:'未更新歌词时间'})).toBeVisible();
});
for(const ending of ['cancel','failed','conflict'])test(`enabled gap policy does not apply after ${ending}`,async({page})=>{
 const state=await setup(page),before=(await(await page.request.get(url)).json());
 await page.getByRole('checkbox',{name:'将短于 ms 的行内空隙并入前词'}).check();await page.getByRole('button',{name:'开始对齐',exact:true}).click();await expect.poll(()=>state.starts).toBe(2);
 if(ending==='cancel'){await page.getByRole('button',{name:'取消任务',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'已取消'})).toBeVisible();}
 else if(ending==='failed'){state.status='failed';await expect(page.getByRole('alert').filter({hasText:'服务中断'})).toBeVisible();}
 else {expect((await page.request.put(url,{headers:{origin:'http://127.0.0.1:5175','if-match':before.revision},data:{schema_version:before.schema_version,project_id:pid,revision:before.revision,document:before.document}})).ok()).toBeTruthy();state.status='succeeded';await expect(page.getByRole('alert').filter({hasText:'项目版本或音频已改变'})).toBeVisible();}
 expect((await(await page.request.get(url)).json()).document).toEqual(before.document);
});
