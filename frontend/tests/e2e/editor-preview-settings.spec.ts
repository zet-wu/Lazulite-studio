import { expect, test } from '@playwright/test';
test('device settings opens in the editor and returns keyboard focus',async({page})=>{
 const target = 'windows-x64-cpu';
 await page.addInitScript(target=>{
  const original=window.fetch;
  window.fetch=async(input,init)=>{
   if(String(input).endsWith('/session'))return new Response(JSON.stringify({schema_version:'studio-session-v1',authenticated:true,mode:'local',user:null}));
   if(String(input).endsWith('/runtime'))return new Response(JSON.stringify({target}));
   return original(input,init);
  };
 },target);
 await page.goto('/projects/sample-project/edit?scenario=no-music');
  const summary=page.locator('[data-top-menu="settings"] summary');await summary.click();
  await page.getByRole('button',{name:'计算设备…',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'计算设备',exact:true});await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'关闭计算设备',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(summary).toBeFocused();
  await expect(page).toHaveURL(/\/edit/);
});
