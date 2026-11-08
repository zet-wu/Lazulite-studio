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
  await dialog.getByRole('combobox',{name:'对齐模型',exact:true}).press('Enter');
  await dialog.getByRole('listbox').getByRole('option',{name:'MMS_FA · torchaudio-mms-fa'}).click();
  await expect(start).toBeEnabled();
  await dialog.getByRole('checkbox',{name:'去除调号数字',exact:true}).check();
  await expect.poll(()=>delayed).toBe(true);await expect(start).toBeDisabled();
  await dialog.getByRole('checkbox',{name:'去除调号数字',exact:true}).uncheck();
  await dialog.getByRole('checkbox',{name:'拉丁归一化',exact:true}).uncheck();
  await expect(start).toBeDisabled();
  const stale=page.waitForResponse(response=>response.url().includes('strip_tone_digits=true'));release();await stale;
  await page.waitForTimeout(100);
  await expect(start).toBeDisabled();
  await dialog.getByRole('button',{name:'取消',exact:true}).click();
  await page.locator('[data-top-menu="settings"] summary').click();
  await page.getByRole('button',{name:'对齐模型管理',exact:true}).click();
  items=[];
  await page.getByRole('button',{name:'刷新模型列表'}).click();
  await expect(page.getByText('没有可用模型，请配置目录并刷新。')).toBeVisible();
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await expect(page.locator('[data-top-menu="settings"] summary')).toBeFocused();
  await page.getByRole('button',{name:'自动对齐',exact:true}).click();
  await expect(dialog.getByRole('combobox',{name:'对齐模型',exact:true})).toHaveValue('one');
  await expect(start).toBeDisabled();
});

test('settings manager is reachable without a project and refresh keeps the directory draft',async({page})=>{
  let directory='/active';const applied:(string|null)[]=[];
  const catalog=()=>({directory,editable:true,items:[{id:null,name:'broken',type:null,status:'invalid',reason:'Missing weights'}],error:null});
  await page.route('**/api/v1/alignment-models?*',r=>r.fulfill({json:catalog()}));
  await page.route('**/api/v1/alignment-models/directory',async r=>{
    applied.push(r.request().postDataJSON().path);directory=applied.at(-1)??'/default';await r.fulfill({json:catalog()});
  });
  await page.goto('/projects');
  await page.locator('[data-top-menu="settings"] summary').click();
  await page.getByRole('button',{name:'对齐模型管理',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'对齐模型管理'}),input=dialog.getByRole('textbox');
  await expect(input).toHaveValue('/active');await input.fill('/draft');
  await dialog.getByRole('button',{name:'刷新模型列表'}).click();
  await expect(dialog.getByRole('button',{name:'刷新模型列表'})).toBeEnabled();
  await expect(input).toHaveValue('/draft');expect(applied).toEqual([]);
  await expect(dialog.getByText('Missing weights')).toBeVisible();
  await expect(dialog.getByText('没有可用模型，请配置目录并刷新。')).toBeVisible();
  await dialog.getByRole('button',{name:'应用目录',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'应用目录',exact:true})).toBeEnabled();
  expect(applied).toEqual(['/draft']);
});
