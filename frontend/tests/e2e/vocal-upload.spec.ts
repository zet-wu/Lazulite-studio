import {expect,test} from '@playwright/test';
import {mkdirSync} from 'node:fs';
const evidence=process.env.STUDIO_EVIDENCE_DIR;
for(const theme of ['light','dark'])test(`vocal offset dialog ${theme}: every upload, late estimate, escape and focus`,async({page})=>{
 await page.addInitScript(theme=>{localStorage.setItem('lazulite-editor-theme',theme);},theme);
 await page.goto('/projects/sample-project/edit');
 await page.getByRole('button',{name:'音频处理',exact:true}).click();
 await page.evaluate(async()=>{
  const browser='/src/mocks/browser.ts';const msw='/node_modules/.vite/deps/msw.js';
  const {worker}=await import(browser);const {http,HttpResponse,delay}=await import(msw);
  worker.use(http.post('/api/v1/uploads',()=>HttpResponse.json({schema_version:'studio-asset-v1',id:'a'.repeat(32),filename:'external.wav',content_type:'audio/wav',size_bytes:100,duration_ms:120000,source_duration_ms:120000,status:'ready',asset_hash:'upload',source_start_ms:0,proxy_offset_ms:0})),
   http.delete('/api/v1/uploads/:id',()=>HttpResponse.json({cancelled:'yes'})),
   http.post('/api/v1/projects/:pid/vocal-offset',async()=>{await delay(500);return HttpResponse.json({offset_ms:1237});}));
 });
 const trigger=page.getByRole('button',{name:'上传人声',exact:true});await expect(trigger).toBeEnabled();
 const choose=async()=>{const chooser=page.waitForEvent('filechooser');await trigger.click();await(await chooser).setFiles({name:'external.wav',mimeType:'audio/wav',buffer:Buffer.from('fixture')});};
 await choose();const dialog=page.getByRole('dialog',{name:'人声偏移'});await expect(dialog).toBeVisible();
 const offset=dialog.getByRole('spinbutton',{name:'偏移（ms）'});await expect(offset).toHaveValue('0');await expect(offset).toBeFocused();
 await dialog.getByRole('button',{name:'自动计算偏移'}).click();await offset.fill('-3451');await expect(dialog.getByRole('button',{name:'自动计算偏移'})).toBeEnabled();await expect(offset).toHaveValue('-3451');
 if(evidence){mkdirSync(evidence,{recursive:true});await page.screenshot({path:`${evidence}/offset-${theme}.png`,fullPage:true});}
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
 await choose();await expect(offset).toHaveValue('0');await dialog.getByRole('button',{name:'取消',exact:true}).click();await expect(trigger).toBeFocused();
});

test('editing defaults persist independently across project and library settings',async({page})=>{
 await page.goto('/projects/sample-project/edit');await page.locator('[data-settings-button]').click();
 let dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'编辑',exact:true}).click();
 await expect(dialog.getByRole('switch',{name:'背景行默认跳过对齐',exact:true})).toBeChecked();
 await dialog.getByRole('switch',{name:'背景行默认跳过连续打轴',exact:true}).uncheck();await page.keyboard.press('Escape');
 await page.goto('/projects');await page.locator('[data-settings-button]').click();dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'编辑',exact:true}).click();
 await expect(dialog.getByRole('switch',{name:'背景行默认跳过对齐',exact:true})).toBeChecked();
 await expect(dialog.getByRole('switch',{name:'背景行默认跳过连续打轴',exact:true})).not.toBeChecked();
 if(evidence)await page.screenshot({path:`${evidence}/editing-defaults.png`,fullPage:true});
});
