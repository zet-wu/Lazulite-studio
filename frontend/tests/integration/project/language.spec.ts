import {expect,test} from '@playwright/test';
import {chooseLanguage,openLanguage} from '../../fixtures/language';
test('persists the library language and keeps project content unchanged through three languages',async({page})=>{
 const headers={origin:'http://127.0.0.1:5175'};
 const result=await page.request.post('/api/v1/projects',{headers,data:{name:'不翻译の project'}});const pid=(await result.json()).id;
 const documentUrl=`/api/v1/projects/${pid}/document`;
 const before=await(await page.request.get(documentUrl)).json();
 await page.goto(`/projects/${pid}/edit`);
 await chooseLanguage(page,'en');
 await expect(page.getByRole('button',{name:'Save',exact:true})).toBeVisible();
 await expect(page.locator('html')).toHaveAttribute('lang','en');
 await expect.poll(async()=>((await(await page.request.get('/api/v1/settings')).json()).values['studio:ui-language'])).toBe('en');
 await page.reload();
 await expect(page.getByRole('button',{name:'Save',exact:true})).toBeVisible();
 await chooseLanguage(page,'zh-Hant');
 await expect(page.getByRole('button',{name:'儲存',exact:true})).toBeVisible();
 await expect(page.locator('html')).toHaveAttribute('lang','zh-Hant-TW');
 const after=await(await page.request.get(documentUrl)).json();expect(after).toEqual(before);
 await chooseLanguage(page,'zh-Hans');
 await expect.poll(async()=>((await(await page.request.get('/api/v1/settings')).json()).values['studio:ui-language'])).toBe('zh-Hans');
});

test('list language dialog retains focus, supports native arrows, and reports a delayed failure after closing',async({page})=>{
 await page.goto('/projects');
 await expect(page.getByRole('button',{name:'保存',exact:true})).toHaveCount(0);
 await expect(page.locator('[data-top-menu="view"]')).toHaveCount(0);
 const dialog=await openLanguage(page);
 await expect(dialog.locator('input[value="zh-Hans"]')).toBeFocused();
 await page.keyboard.press('ArrowDown');
 await expect(dialog.locator('input[value="zh-Hant"]')).toBeChecked();
 await page.keyboard.press('ArrowDown');
 await expect(dialog.locator('input[value="en"]')).toBeChecked();
 await expect.poll(async()=>((await(await page.request.get('/api/v1/settings')).json()).values['studio:ui-language'])).toBe('en');
 await page.keyboard.press('Tab');await expect(dialog.getByRole('button')).toBeFocused();
 await page.keyboard.press('Tab');await expect(dialog.locator('input[value="en"]')).toBeFocused();
 let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 await page.route('**/api/v1/settings',async route=>{
  if(route.request().method()!=='PATCH')return route.continue();
  await gate;await route.fulfill({status:503,json:{}});
 });
 await dialog.locator('input[value="zh-Hans"]').check();
 await page.keyboard.press('Escape');
 await expect(page.locator('[data-top-menu="settings"] summary')).toBeFocused();
 release();
 await expect(page.getByRole('alert')).toContainText('last saved');
 await expect(page.locator('html')).toHaveAttribute('lang','en');
 await page.unroute('**/api/v1/settings');
 await chooseLanguage(page,'zh-Hans');
});

test('empty library keeps the header through loading and restores the saved theme',async({page})=>{
 const settings=await(await page.request.get('/api/v1/settings')).json();
 expect((await page.request.patch('/api/v1/settings',{headers:{origin:'http://127.0.0.1:5175','if-match':`"${settings.revision}"`},data:{changes:{'lazulite-editor-theme':'dark'}}})).ok()).toBeTruthy();
 let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 await page.route('**/api/v1/projects',async route=>{await gate;await route.fulfill({json:{schema_version:'studio-project-list-v1',items:[],next_cursor:null}});});
 await page.goto('/projects');
 await expect(page.locator('[data-top-menu="settings"] summary')).toBeVisible();
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');release();
 const dialog=await openLanguage(page);await expect(dialog.locator('input:checked')).toBeFocused();await page.keyboard.press('Escape');
 await page.locator('[data-top-menu="settings"] summary').click();
 await expect(page.getByRole('button',{name:'AMLL 设置',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'注音词典',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('词典');await page.keyboard.press('Escape');
 const latest=await(await page.request.get('/api/v1/settings')).json();
 await page.request.patch('/api/v1/settings',{headers:{origin:'http://127.0.0.1:5175','if-match':`"${latest.revision}"`},data:{changes:{'lazulite-editor-theme':'light'}}});
});
