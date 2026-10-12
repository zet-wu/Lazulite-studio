import {expect,test} from '@playwright/test';
for(const theme of ['light','dark'])test(`experimental options, clearing, undo and reopening in ${theme}`,async({page})=>{
 const pid='media-offset',url=`/api/v1/projects/${pid}/document`;
 await page.addInitScript(t=>localStorage.setItem('lazulite-editor-theme',t),theme);
 const before=await(await page.request.get(url)).json();
 const xml='<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft"><body><p xml:id="a" begin="1" end="5"><span studio:id="left" begin="1" end="2">♪</span><span studio:id="w" begin="2" end="4">love</span><span studio:id="right" begin="4" end="5">！</span></p><p xml:id="skip" begin="6" end="7"><span studio:id="sw" begin="6" end="7">keep</span></p></body></tt>';
 const snapshot={...before.document,karaoke:{...before.document.karaoke,lineGroups:{a:'main',skip:'main'},cues:[]},lyrics:{draftTtml:xml},lineOrder:[],editing:{emptyBeats:{},ignoredSyncLineIds:[],skippedAlignmentLineIds:['skip'],endLinks:{}},acoustics:{analysisId:null,segments:[]}};
 expect((await page.request.put(url,{headers:{origin:'http://127.0.0.1:5175','if-match':before.revision},data:{schema_version:before.schema_version,project_id:pid,revision:before.revision,document:snapshot}})).ok()).toBeTruthy();
 const asset=(await(await page.request.get(`/api/v1/projects/${pid}`)).json()).asset.id;
 let params:Record<string,unknown>={},starts=0,key='',status='running';
 await page.route('**/api/v1/capabilities',route=>route.fulfill({json:{schema_version:'studio-capabilities-v1',items:[{id:'job.alignment',enabled:true,reason:null}]}}));
 await page.route(`**/api/v1/projects/${pid}/jobs/alignment`,async route=>{
  const selected=route.request().postDataJSON().params;
  if(starts++===0){params=selected;key=route.request().headers()['idempotency-key'];await route.abort('failed');}
  else {expect(selected).toEqual(params);expect(route.request().headers()['idempotency-key']).toBe(key);await route.fulfill({status:202,json:{id:'options',kind:'alignment',status}});}
 });
 await page.route('**/api/v1/jobs/options',route=>route.fulfill({json:{id:'options',kind:'alignment',status}}));
 await page.route('**/api/v1/jobs/options/result',route=>route.fulfill({json:{kind:'alignment',binding:{project_id:pid,revision:params.revision,asset_id:asset},acoustics:null,
  scope:[{object_id:'left',word_id:'left',line_id:'a',kind:'word',target_ids:[]},{object_id:'w',word_id:'w',line_id:'a',kind:'word',target_ids:['u']},{object_id:'right',word_id:'right',line_id:'a',kind:'word',target_ids:[]}],
  mapping:[{unit_id:'u',object_id:'w',word_id:'w',line_id:'a',kind:'word'}],alignment:{schema:'lazulite-japanese-result-v1',units:[{unit_id:'u',line_id:'a',proposed_timing:{start:{time:3,source:'acoustic_path'},end:null}}]}}}));
 await page.goto(`/projects/${pid}/edit`);await page.getByRole('button',{name:'音频处理',exact:true}).click();await page.getByRole('button',{name:'自动对齐',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'自动对齐',exact:true});
 for(const checkbox of await dialog.getByRole('checkbox').all())await expect(checkbox).not.toBeChecked();
 for(let bits=0;bits<8;bits++)for(const [i,label] of ['行内 blank 代价','人声休止 blank 代价','人声休止 token 代价'].entries()){
  const box=dialog.getByRole('checkbox',{name:new RegExp('^'+label+' ')});await expect(box).toBeEnabled();await box.setChecked(Boolean(bits&(1<<i)));await expect(box).toBeChecked({checked:Boolean(bits&(1<<i))});
 }
 await dialog.getByRole('checkbox',{name:'清空未匹配单元时间',exact:true}).check();
 await page.screenshot({path:test.info().outputPath(`alignment-options-${theme}.png`)});
 await dialog.getByRole('button',{name:'开始对齐',exact:true}).click();
 await expect.poll(()=>starts).toBe(2);expect(params).toMatchObject({use_hints:false,line_blank:true,rest_blank:true,rest_token:true,clear_unmatched:true});
 await page.getByRole('button',{name:'编辑',exact:true}).click();await expect(page.getByRole('textbox',{name:'词 love',exact:true})).toBeDisabled();
 status='succeeded';const notice=page.getByRole('status').filter({hasText:'清空 3 个词／注音'});await expect(notice).toBeVisible();
 await expect.poll(async()=> (await(await page.request.get(url)).json()).document.lyrics.draftTtml).toContain('begin="00:03.000"');
 const saved=(await(await page.request.get(url)).json()).document.lyrics.draftTtml;
 expect(saved).toContain('studio:null="end"');expect(saved).toContain('begin="00:06.000"');
 await notice.locator('..').getByRole('button',{name:'关闭提示'}).click();await expect(notice).toHaveCount(0);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect.poll(async()=> (await(await page.request.get(url)).json()).document.lyrics.draftTtml).toContain('end="00:05.000"');
 await page.getByRole('button',{name:'重做',exact:true}).click();await expect.poll(async()=> (await(await page.request.get(url)).json()).document.lyrics.draftTtml).toBe(saved);
 await page.reload();await page.getByRole('button',{name:'音频处理',exact:true}).click();await page.getByRole('button',{name:'自动对齐',exact:true}).click();
 for(const checkbox of await dialog.getByRole('checkbox').all())await expect(checkbox).not.toBeChecked();
 await dialog.getByRole('button',{name:'取消',exact:true}).click();
});
