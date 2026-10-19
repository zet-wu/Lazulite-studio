// Production-dist smoke against an already-running portable development harness.
import { chromium, expect } from '@playwright/test';
const origin = process.env.STUDIO_PORTABLE_ORIGIN ?? 'http://127.0.0.1:15173';
const browser = await chromium.launch({headless:true});
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/projects');
  await expect(page.getByRole('button',{name:'新建项目',exact:true})).toBeVisible();
  await expect(page.getByLabel('密码',{exact:true})).toHaveCount(0);
  const api = context.request;
  const created=await api.post(origin+'/api/v1/projects',{headers:{Origin:origin},data:{name:'便携浏览器验证'}});
  expect(created.ok()).toBeTruthy();const pid=(await created.json()).id;
  await page.goto(origin+`/projects/${pid}/edit`);
  await expect(page.getByRole('button',{name:'保存',exact:true})).toBeVisible();
  await page.reload();await expect(page.getByRole('button',{name:'保存',exact:true})).toBeVisible();
  const first=await api.get(origin+'/api/v1/settings');
  expect((await api.patch(origin+'/api/v1/settings',{headers:{Origin:origin,'If-Match':first.headers().etag},data:{changes:{'lazulite-editor-theme':'dark'}}})).ok()).toBeTruthy();
  const fresh = await browser.newContext(); const second=await fresh.newPage();
  await second.goto(origin+`/projects/${pid}/edit`);
  await expect(second.getByRole('button',{name:'保存',exact:true})).toBeVisible();
  expect(await fresh.request.get(origin+'/api/v1/settings').then(r=>r.json()).then(v=>v.values['lazulite-editor-theme'])).toBe('dark');
  const stale=await api.patch(origin+'/api/v1/settings',{headers:{Origin:origin,'If-Match':first.headers().etag},data:{changes:{'studio.playback-rate':'1.5'}}});
  expect(stale.status()).toBe(409);
  await page.goto(origin+'/settings');await expect(page.getByRole('heading',{name:'计算设备'})).toBeVisible();
  const library=(await (await api.get(origin+'/api/v1/session')).json()).library_id;
  const databases=await page.evaluate(async()=> (await indexedDB.databases()).map(item=>item.name));
  expect(databases).toContain(`lazulite-studio-recovery-v10:${library}`);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({productionPage:true,noPassword:true,editorReload:true,preferencesAcrossContexts:true,conflict:true,deviceSettings:true,pageErrors:errors}));
  await fresh.close(); await context.close();
} finally { await browser.close(); }
