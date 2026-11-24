import { expect, test } from '@playwright/test';
import { loadTimeline } from '../fixtures/timeline-setup';
import { importLyrics } from '../fixtures/import-lyrics';

test('SUG carries shared starts, closes stops on release and switches style without converting data',async({page},info)=>{
 await page.setViewportSize({width:1440,height:1000});await loadTimeline(page);
 await importLyrics(page,{name:'sug.ttml',mimeType:'application/xml',buffer:Buffer.from('<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="0" end="5"><span begin="1" end="2">甲</span><span begin="2" end="3">乙</span></p></body></tt>')});
 await page.locator('main [data-word-id]').first().click({position:{x:3,y:3}});
 await page.getByRole('button',{name:'打轴',exact:true}).click();
 await page.locator('audio').evaluate((a:HTMLAudioElement)=>{a.currentTime=1;});await page.keyboard.press('d');
 await page.locator('audio').evaluate((a:HTMLAudioElement)=>{a.currentTime=2;});await page.keyboard.down('d');
 await expect(page.getByLabel('选中对象开始秒数')).toHaveValue('2');
 await page.locator('audio').evaluate((a:HTMLAudioElement)=>{a.currentTime=2.5;});await page.keyboard.up('d');
 await page.getByRole('button',{name:'上一单元',exact:true}).click();
 await page.getByRole('button',{name:'下一单元',exact:true}).click();
 await expect(page.getByLabel('选中对象结束秒数')).toHaveValue('2.5');
 const stops=page.locator('main [data-sync-marker="stop"]');await expect(stops.last()).toHaveAttribute('aria-pressed','true');
 await stops.first().click();await expect(stops.first()).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(stops.first()).toHaveAttribute('aria-pressed','false');
 await stops.first().click({button:'right'});await expect(stops.first()).toHaveAttribute('aria-pressed','true');
 for(const theme of ['light','dark']){await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);await page.screenshot({path:info.outputPath(`sug-${theme}.png`)});}
 await page.locator('[data-settings-button]').click();await page.getByRole('dialog').getByRole('button',{name:'编辑',exact:true}).click();
 const select=page.getByLabel('打轴风格',{exact:true});await select.selectOption('amll');await page.keyboard.press('Escape');
 await expect(page.locator('main [data-sync-marker="stop"]')).toHaveCount(0);
 await expect(page.getByLabel('选中对象结束秒数')).toHaveValue('2.5');
});
