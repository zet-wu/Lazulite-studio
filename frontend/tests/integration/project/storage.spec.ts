import { expect, test } from '@playwright/test';

test('project space refreshes and failures never appear as zero',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await page.goto('/projects');const row=page.locator('[class*="projectRow"]').filter({hasText:'浏览器集成项目'});
 await expect(row.locator('summary')).toContainText('MiB');await row.locator('summary').click();await expect(row.getByText('源音频',{exact:true})).toBeVisible();
 await page.route('**/projects/multitrack-project/storage',route=>route.fulfill({status:503,json:{code:'unavailable',message:'统计失败',request_id:'test',retryable:true}}));
 await row.getByRole('button',{name:'刷新空间统计'}).click();await expect(row.locator('summary')).toHaveText('统计失败',{timeout:15000});
 await page.unroute('**/projects/multitrack-project/storage');await row.getByRole('button',{name:'刷新空间统计'}).click();await expect(row.locator('summary')).toContainText('MiB');
});
