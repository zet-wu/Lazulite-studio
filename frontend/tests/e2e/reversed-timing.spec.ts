import {expect,test} from '@playwright/test';
import {loadTimeline} from '../fixtures/timeline-setup';
import {importLyrics} from '../fixtures/import-lyrics';

test('single boundary crosses its opposite end, swaps physical handles and stays unhighlighted during playback',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await loadTimeline(page);
 await importLyrics(page,{name:'reverse.ttml',mimeType:'application/xml',buffer:Buffer.from('<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="0" end="5"><span begin="1" end="2">甲</span><span begin="3" end="4">乙</span></p></body></tt>')});
 await page.locator('[data-outline-drag]').first().click();await page.getByRole('checkbox',{name:'吸附',exact:true}).uncheck();
 const bar=page.getByRole('button',{name:'时间轴词 甲',exact:true}),end=bar.getByLabel('时间轴词 甲结束边界',{exact:true});
 const original=(await bar.boundingBox())!,r=(await end.boundingBox())!;
 await page.keyboard.down('Control');await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width/2-original.width*1.5,r.y+r.height/2,{steps:6});await page.mouse.up();await page.keyboard.up('Control');
 await expect(bar).toHaveAttribute('data-reversed','true');
 expect((await end.boundingBox())!.x).toBeLessThan((await bar.getByLabel('时间轴词 甲开始边界',{exact:true}).boundingBox())!.x);
 await page.locator('audio').evaluate((a:HTMLAudioElement)=>{a.currentTime=.75;});
 await expect(bar).not.toHaveAttribute('aria-current','time');
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(bar).not.toHaveAttribute('data-reversed','true');
 await page.getByRole('button',{name:'重做',exact:true}).click();await expect(bar).toHaveAttribute('data-reversed','true');
});
