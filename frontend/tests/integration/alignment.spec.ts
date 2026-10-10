import {expect,test} from '@playwright/test';
const pid='phase3-media',url=`/api/v1/projects/${pid}/document`;
const xml='<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><p xml:id="main" studio:null="begin end"><span studio:id="w" studio:null="begin end">love</span><span ttm:role="x-bg" studio:id="bg" studio:null="begin end"><span studio:id="bw" studio:null="begin end">(あ)</span></span></p><p xml:id="skip" begin="6" end="7"><span studio:id="sw" begin="6" end="7">keep</span></p></body></tt>';
test('global alignment confirms, locks across modes, applies once, saves and cancels without changes',async({page})=>{
 const before=await(await page.request.get(url)).json();
 const snapshot={...before.document,karaoke:{...before.document.karaoke,lineGroups:{main:'main',bg:'background',skip:'main'},cues:[]},lyrics:{draftTtml:xml},lineOrder:['bg','main','skip'],editing:{...before.document.editing,skippedAlignmentLineIds:['skip']},acoustics:{analysisId:null,segments:[]}};
 expect((await page.request.put(url,{headers:{origin:'http://127.0.0.1:5175','if-match':before.revision},data:{schema_version:before.schema_version,project_id:pid,revision:before.revision,document:snapshot}})).ok()).toBeTruthy();
 let status='running',revision='',starts=0,cancelled=0;
 await page.route('**/api/v1/capabilities',route=>route.fulfill({json:{schema_version:'studio-capabilities-v1',items:[{id:'job.alignment',enabled:true,reason:null}]}}));
 await page.route(`**/api/v1/projects/${pid}/jobs/alignment`,async route=>{revision=route.request().postDataJSON().params.revision;starts++;await route.fulfill({status:202,json:{id:'alignment-test',kind:'alignment',status:'running'}});});
 await page.route('**/api/v1/jobs/alignment-test',route=>route.fulfill({json:{id:'alignment-test',kind:'alignment',status}}));
 await page.route('**/api/v1/jobs/alignment-test/cancel',async route=>{status='cancelled';cancelled++;await route.fulfill({json:{id:'alignment-test',kind:'alignment',status}});});
 const asset=(await(await page.request.get(`/api/v1/projects/${pid}`)).json()).asset.id;
 await page.route('**/api/v1/jobs/alignment-test/result',route=>route.fulfill({json:{kind:'alignment',binding:{project_id:pid,revision,asset_id:asset},acoustics:null,
 scope:[{object_id:'bw',word_id:'bw',line_id:'bg',kind:'word',target_ids:['u1']},{object_id:'w',word_id:'w',line_id:'main',kind:'word',target_ids:['u2']}],
 mapping:[{unit_id:'u1',object_id:'bw',word_id:'bw',line_id:'bg',kind:'word'},{unit_id:'u2',object_id:'w',word_id:'w',line_id:'main',kind:'word'}],
 alignment:{schema:'lazulite-japanese-result-v1',units:[{unit_id:'u1',line_id:'bg',proposed_timing:{start:{time:1,source:'test'},end:{time:2,source:'test'}}},{unit_id:'u2',line_id:'main',proposed_timing:{start:{time:3,source:'test'},end:{time:4,source:'test'}}}]}}}));
 await page.goto(`/projects/${pid}/edit`);await page.getByRole('button',{name:'音频处理',exact:true}).click();
 await page.getByRole('button',{name:'自动对齐',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'自动对齐',exact:true});
 await expect(dialog).toContainText('将对齐 2 行，跳过 1 行');await expect(dialog.getByRole('checkbox',{name:'使用已有行起始时间辅助对齐'})).not.toBeChecked();await expect(dialog.getByRole('checkbox',{name:'使用已有行起始时间辅助对齐'})).toBeDisabled();
 await dialog.getByRole('button',{name:'取消',exact:true}).click();expect(starts).toBe(0);
 await page.getByRole('button',{name:'自动对齐',exact:true}).click();await dialog.getByRole('button',{name:'开始对齐',exact:true}).click();
 await expect(page.getByRole('button',{name:'正在对齐',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'编辑',exact:true}).click();await expect(page.getByRole('textbox',{name:'词 love',exact:true})).toBeDisabled();
 await page.keyboard.press('Control+z');await page.getByRole('button',{name:'播放',exact:true}).click();await page.getByRole('button',{name:'暂停',exact:true}).click();
 status='succeeded';await expect(page.getByRole('status').filter({hasText:'已更新歌词时间'})).toBeVisible();await expect(page.getByRole('textbox',{name:'词 love',exact:true})).toBeEnabled();
 await expect.poll(async()=> (await(await page.request.get(url)).json()).document.lyrics.draftTtml).toContain('begin="00:03.000"');
 const saved=await(await page.request.get(url)).json();expect(saved.document.lineOrder).toEqual(['bg','main','skip']);expect(saved.document.editing.skippedAlignmentLineIds).toEqual(['skip']);expect(saved.document.lyrics.draftTtml).toContain('begin="00:06.000"');
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect.poll(async()=> (await(await page.request.get(url)).json()).document.lyrics.draftTtml).toContain('studio:null="begin end"');
 await page.getByRole('button',{name:'重做',exact:true}).click();await expect.poll(async()=> (await(await page.request.get(url)).json()).document.lyrics.draftTtml).toContain('begin="00:03.000"');await page.reload();await page.getByRole('button',{name:'音频处理',exact:true}).click();
 await page.getByRole('button',{name:'自动对齐',exact:true}).click();await expect(dialog.getByRole('checkbox',{name:'使用已有行起始时间辅助对齐'})).not.toBeChecked();await expect(dialog.getByRole('checkbox',{name:'使用已有行起始时间辅助对齐'})).toBeEnabled();
 status='running';await dialog.getByRole('button',{name:'开始对齐',exact:true}).click();await page.getByRole('button',{name:'取消',exact:true}).click();await expect.poll(()=>cancelled).toBe(1);await expect(page.getByRole('status').filter({hasText:'已取消对齐'})).toBeVisible();
 expect(starts).toBe(2);
});
