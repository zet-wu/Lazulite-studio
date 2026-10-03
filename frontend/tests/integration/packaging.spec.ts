import { expect, test } from '@playwright/test';
import { importLyrics } from '../fixtures/import-lyrics';

test('real saved editor snapshot produces a verified music file and does not reset history',async ({page})=>{
 await page.goto('/projects/phase0-packaging/edit');
 await importLyrics(page,{name:'packaging.ttml',mimeType:'application/xml',buffer:Buffer.from('<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="1" end="3"><span begin="1" end="2">合成</span><span> </span><span begin="2" end="3">测试</span></p></body></tt>')});
 await page.getByRole('button',{name:'文件打包',exact:true}).click();
 await expect(page.getByRole('button',{name:'打包文件'})).toBeEnabled();
 // Wait for the ordinary autosave already queued by import, if it won the race.
 await expect(page.locator('header').getByText('已保存',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'打包文件'}).click();
 await expect(page.getByRole('link',{name:'下载产物'}).first()).toBeVisible({timeout:15000});
 await expect(page.getByText(/源文件：.*M4A/)).toBeVisible();
 await expect(page.getByText(/已写入 STPP · 普通 LRC/)).toBeVisible();
 await page.screenshot({path:test.info().outputPath('packaging-strategy.png')});
 await page.getByText(/已写入 STPP · 普通 LRC/).scrollIntoViewIfNeeded();
 await page.screenshot({path:test.info().outputPath('packaging-success.png')});
 const download=page.waitForEvent('download');await page.getByRole('link',{name:'下载产物'}).first().click();expect((await download).suggestedFilename()).toMatch(/\.(m4a|mp4)$/);
 await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByRole('button',{name:'撤销',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'词 合成',exact:true})).toHaveCount(0);
});
