import {expect,test} from '@playwright/test';

test('local alignment overrides skipped rows, snapshots source/crop options and preserves unrelated timing through save and undo',async({page},info)=>{
 const pid='music-packaging',url=`/api/v1/projects/${pid}/document`;
 const before=await(await page.request.get(url)).json();
 const xml='<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft"><body><p xml:id="selected" begin="0.5" end="2"><span studio:id="a" begin="0.5" end="1">a</span><span studio:id="b" begin="1" end="2">b</span></p><p xml:id="keep" begin="6" end="7"><span studio:id="c" begin="6" end="7">keep</span></p></body></tt>';
 const snapshot={...before.document,lyrics:{draftTtml:xml},lineOrder:[],karaoke:{...before.document.karaoke,lineGroups:{selected:'main',keep:'main'},cues:[]},editing:{syncStops:{},emptyBeats:{},ignoredSyncLineIds:[],skippedAlignmentLineIds:['selected','keep']}};
 expect((await page.request.put(url,{headers:{origin:'http://127.0.0.1:5175','if-match':before.revision},data:{schema_version:before.schema_version,project_id:pid,revision:before.revision,document:snapshot}})).ok()).toBeTruthy();
 const asset=(await(await page.request.get(`/api/v1/projects/${pid}`)).json()).asset.id;
 let params:any=null,ack=false;
 await page.route('**/api/v1/capabilities',route=>route.fulfill({json:{schema_version:'studio-capabilities-v1',items:[{id:'job.alignment',enabled:true,reason:null}]}}));
 const job=()=>({id:'local',project_id:pid,kind:'alignment',status:'succeeded',request:params,result_available:true,acknowledged_state:ack?'applied':null});
 await page.route(`**/api/v1/projects/${pid}/jobs`,route=>route.fulfill({json:{schema_version:'studio-job-list-v1',items:params?[job()]:[]}}));
 await page.route(`**/api/v1/projects/${pid}/jobs/alignment`,route=>{params=route.request().postDataJSON().params;return route.fulfill({status:202,json:job()});});
 await page.route('**/api/v1/jobs/local/acknowledge',route=>{ack=true;return route.fulfill({json:job()});});
 await page.route('**/api/v1/jobs/local/result',route=>route.fulfill({json:{kind:'alignment',binding:{project_id:pid,revision:params.revision,asset_id:asset},selection:['a','b'],acoustics:null,scope:['a','b'].map(id=>({object_id:id,word_id:id,line_id:'selected',kind:'word',target_ids:[id]})),mapping:['a','b'].map(id=>({unit_id:id,object_id:id,word_id:id,line_id:'selected',kind:'word'})),alignment:{schema:'lazulite-japanese-result-v1',units:['a','b'].map((id,i)=>({unit_id:id,line_id:'selected',proposed_timing:{start:{time:.6+i*.7,source:'test'},end:{time:1.2+i*.7,source:'test'}}}))}}}));
 await page.goto(`/projects/${pid}/edit`);
 await page.locator('[data-outline-drag]').first().click({button:'right'});
 await page.getByRole('menuitem',{name:'局部对齐',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'局部对齐',exact:true});await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('switch',{name:'人声片段裁切',exact:true})).toBeChecked();
 await dialog.getByRole('combobox',{name:'对齐音频来源',exact:true}).selectOption('original');
 await dialog.getByRole('switch',{name:'人声片段裁切',exact:true}).uncheck();
 await dialog.getByRole('combobox',{name:'对齐模型',exact:true}).selectOption({label:'model · torchaudio-mms-fa'});
 await expect(dialog.getByRole('button',{name:'开始对齐',exact:true})).toBeEnabled();
 for(const theme of ['light','dark']){await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);await page.screenshot({path:info.outputPath(`local-alignment-${theme}.png`)});}
 await dialog.getByRole('button',{name:'开始对齐',exact:true}).click();
 await expect.poll(()=>params).toMatchObject({scope_ids:['a','b'],audio_source:'original',crop_vocals:false});
 await expect.poll(async()=> (await(await page.request.get(url)).json()).document.lyrics.draftTtml).toContain('begin="00:00.600"');
 const saved=(await(await page.request.get(url)).json()).document.lyrics.draftTtml;expect(saved).toContain('begin="00:06.000"');
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect.poll(async()=> (await(await page.request.get(url)).json()).document.lyrics.draftTtml).toContain('begin="00:00.500"');
 await page.getByRole('button',{name:'重做',exact:true}).click();await expect.poll(async()=> (await(await page.request.get(url)).json()).document.lyrics.draftTtml).toBe(saved);
 await page.reload();await expect(page.getByRole('textbox',{name:'词 keep',exact:true})).toBeVisible();
});
