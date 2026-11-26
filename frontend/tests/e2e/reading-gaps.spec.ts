import {expect,test} from '@playwright/test';
import {loadTimeline} from '../fixtures/timeline-setup';
import {importLyrics} from '../fixtures/import-lyrics';

for(const theme of ['light','dark'])test(`reading gaps support keyboard batch toggle and timeline closure with history: ${theme}`,async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await loadTimeline(page);
 const xml=await page.evaluate(async()=>{
  const dp='/src/domain/lyric-document.ts',cp='/src/adapters/ttml/lyric-codec.ts';const d=await import(dp),c=await import(cp),doc=d.createLyricDocument('');
  doc.lines=[{...d.createLine('','line'),beginMs:1000,endMs:2600,words:[{...d.createWord('愛','word'),beginMs:1000,endMs:2000,rubyUnits:[{id:'r1',reading:'ai',beginMs:1000,endMs:1400},{id:'r2',reading:'a',beginMs:1420,endMs:2000}]},{...d.createWord('love','western'),beginMs:2020,endMs:2600}]}];return c.serializeLyricTtml(doc,{draft:true});
 });
 await importLyrics(page,{name:'reading-gaps.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
 await page.locator('[data-outline-drag]').first().click();
 await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 await page.locator('[data-top-menu="tools"] summary').click();await page.getByRole('button',{name:'批处理',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'批处理',exact:true});await dialog.getByRole('button',{name:'消除读音间空隙',exact:true}).click();
 await dialog.getByLabel(/间隙或重叠阈值/).fill('25');await expect(dialog.getByRole('status')).toContainText('将调整 0 处读音边界');
 const toggle=dialog.getByRole('switch',{name:'包含非中日韩词与注音',exact:true});await expect(toggle).not.toBeChecked();await toggle.focus();await page.keyboard.press('Space');await expect(toggle).toBeChecked();
 await expect(dialog.getByRole('status')).toContainText('将调整 2 处读音边界');
 await page.screenshot({path:`${process.env.STUDIO_REVIEW_DIR??'test-results'}/reading-gaps-${theme}.png`});
 await dialog.getByRole('button',{name:'应用',exact:true}).click();await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'时间轴词 愛',exact:true}).click();await expect(page.getByLabel('词 愛结束秒数',{exact:true})).toHaveValue('2.01');
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.getByLabel('词 愛结束秒数',{exact:true})).toHaveValue('2');
 await page.getByRole('button',{name:'重做',exact:true}).click();await expect(page.getByLabel('词 愛结束秒数',{exact:true})).toHaveValue('2.01');
 await page.getByRole('button',{name:'撤销',exact:true}).click();
 const gapToggle=page.getByRole('button',{name:'空隙',exact:true}).first();if(await gapToggle.getAttribute('aria-pressed')!=='true')await gapToggle.click();
 const gaps=page.locator('[class*="gapBar"]');await expect(gaps).toHaveCount(2);
 await gaps.last().focus();await page.keyboard.press('Enter');await expect(gaps).toHaveCount(1);
 await expect(page.getByLabel('词 愛结束秒数',{exact:true})).toHaveValue('2.01');
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(gaps).toHaveCount(2);await expect(page.getByLabel('词 愛结束秒数',{exact:true})).toHaveValue('2');
});
