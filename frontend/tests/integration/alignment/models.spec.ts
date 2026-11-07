import {test,expect} from '@playwright/test';

test('models remain explicitly selected and stale input previews cannot enable start',async({page})=>{
  await page.route('**/api/v1/capabilities',r=>r.fulfill({json:{schema_version:'studio-capabilities-v1',items:[{id:'job.alignment',enabled:true,reason:null}]}}));
  let items=[{id:'one',name:'MMS_FA',type:'torchaudio-mms-fa',status:'ready'}];
  await page.route('**/api/v1/alignment-models?*',r=>r.fulfill({json:{directory:'/models',editable:false,items,error:null}}));
  let release:()=>void=()=>{};
  let delayed=false;
  await page.route('**/alignment-preview?*',async r=>{
    const url=new URL(r.request().url());
    if(url.searchParams.get('strip_tone_digits')==='true'){delayed=true;await new Promise<void>(resolve=>{release=resolve;});}
    await r.fulfill({json:{model_preview:'snapshot',line_count:1,skipped_count:0,unknown_count:0,hint_count:0,emitting_count:url.searchParams.get('latin_normalize')==='true'?1:0,inputs:[],unknown_objects:[]}});
  });
  await page.goto('/projects/media-offset/edit');
  await page.getByRole('button',{name:'音频处理',exact:true}).click();
  await page.getByRole('button',{name:'自动对齐',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'自动对齐',exact:true}),start=dialog.getByRole('button',{name:'开始对齐'});
  await expect(start).toBeDisabled();
  await dialog.getByRole('combobox',{name:'对齐模型',exact:true}).selectOption('one');
  await expect(start).toBeEnabled();
  await dialog.getByRole('checkbox',{name:'去除调号数字',exact:true}).check();
  await expect.poll(()=>delayed).toBe(true);await expect(start).toBeDisabled();
  await dialog.getByRole('checkbox',{name:'去除调号数字',exact:true}).uncheck();
  await dialog.getByRole('checkbox',{name:'拉丁归一化',exact:true}).uncheck();
  await expect(start).toBeDisabled();
  const stale=page.waitForResponse(response=>response.url().includes('strip_tone_digits=true'));release();await stale;
  await page.waitForTimeout(100);
  await expect(start).toBeDisabled();
  await dialog.getByRole('button',{name:'对齐模型管理',exact:true}).click();
  items=[];
  await page.getByRole('button',{name:'刷新模型列表'}).click();
  await expect(page.getByText('没有可用模型，请配置目录并刷新。')).toBeVisible();
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await expect(dialog.getByRole('combobox',{name:'对齐模型',exact:true})).toHaveValue('one');
  await expect(start).toBeDisabled();
});

test('unencodable preview locates the original editing object',async({page})=>{
 const url='/api/v1/projects/media-offset/document';
 const before=await(await page.request.get(url)).json();
 const document={...before.document,karaoke:{...before.document.karaoke,lineGroups:{line:'main'},cues:[]},lineOrder:[],editing:{...before.document.editing,skippedAlignmentLineIds:[],endLinks:{},emptyBeats:{}},lyrics:{draftTtml:'<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft"><body><p xml:id="line"><span studio:id="unknownword">ñ</span></p></body></tt>'}};
 expect((await page.request.put(url,{headers:{origin:'http://127.0.0.1:5175','if-match':before.revision},data:{...before,document}})).ok()).toBeTruthy();
 await page.route('**/api/v1/capabilities',r=>r.fulfill({json:{schema_version:'studio-capabilities-v1',items:[{id:'job.alignment',enabled:true,reason:null}]}}));
 await page.goto('/projects/media-offset/edit');await page.getByRole('button',{name:'音频处理',exact:true}).click();await page.getByRole('button',{name:'自动对齐',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'自动对齐',exact:true});
 await dialog.getByRole('combobox',{name:'对齐模型',exact:true}).selectOption({label:'model · torchaudio-mms-fa'});
 await dialog.getByRole('checkbox',{name:'拉丁归一化',exact:true}).uncheck();
 await dialog.getByText('实际模型输入',{exact:true}).click();
 await dialog.getByRole('button',{name:'定位无法编码的歌词',exact:true}).click();
 await expect(dialog).toHaveCount(0);
 await expect(page.getByRole('button',{name:'编辑',exact:true})).toHaveAttribute('aria-current','page');
 await expect(page.locator('[data-word-id="unknownword"]')).toHaveClass(/selected/);
});
