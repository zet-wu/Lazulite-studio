import { expect,test } from '@playwright/test';
test('local device preferences persist and a failed write can be retried',async({page})=>{
 await page.route('**/api/v1/session',async route=>{const response=await route.fetch();await route.fulfill({json:{...await response.json(),mode:'local'}});});
 await page.route('**/api/v1/runtime',route=>route.fulfill({json:{target:'windows-x64-cuda'}}));
 await page.goto('/projects/music-packaging/edit');
 const open=async()=>{await page.locator('[data-top-menu="settings"] summary').click();await page.getByRole('button',{name:'计算设备…'}).click();};
 await open();const vocal=page.getByLabel('人声分离计算设备');await expect(vocal).toHaveValue('auto');
 let fail=true;
 await page.route('**/api/v1/settings',route=>route.request().method()==='PATCH'&&fail?route.fulfill({status:500,json:{message:'测试保存失败'}}):route.continue());
 await vocal.selectOption('cpu');await expect(page.getByRole('dialog').getByRole('alert')).toContainText('偏好保存失败');await expect(vocal).toHaveValue('auto');
 fail=false;await vocal.selectOption('cpu');await expect(vocal).toHaveValue('cpu');
 expect((await(await page.request.get('/api/v1/settings')).json()).values['device.vocal']).toBe('cpu');
 await page.getByRole('button',{name:'关闭计算设备'}).click();await expect(page.locator('[data-top-menu="settings"] summary')).toBeFocused();
 await page.reload();await open();await expect(page.getByLabel('人声分离计算设备')).toHaveValue('cpu');await expect(page.getByLabel('自动对齐计算设备')).toHaveValue('auto');
 await page.getByLabel('人声分离计算设备').selectOption('auto');await expect(page.getByLabel('人声分离计算设备')).toHaveValue('auto');
 await page.screenshot({path:test.info().outputPath('device-settings.png')});
});
