import {test,expect} from '@playwright/test';
import {loadTimeline} from '../fixtures/timeline-setup';
import {importLyrics} from '../fixtures/import-lyrics';
test('horizontal filtering bounds expanded groups before virtual layout and preserves their selection on return',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await loadTimeline(page,true);
 const xml=await page.evaluate(async()=>{
  const modelPath='/src/domain/lyric-document.ts',codecPath='/src/adapters/ttml/lyric-codec.ts';const model=await import(modelPath),codec=await import(codecPath);const doc=model.createLyricDocument('');
  doc.lines=Array.from({length:40},(_,i)=>{const line=model.createLine(`歌${i}`,`row-${i}`);Object.assign(line,{beginMs:i*3000,endMs:i*3000+800});Object.assign(line.words[0],{beginMs:line.beginMs,endMs:line.endMs});return line;});
  doc.lines[0].beginMs=null;doc.lines[0].endMs=null;
  const bg=model.createLine('背景','offscreen-bg');Object.assign(bg,{backgroundOf:'row-0',beginMs:100000,endMs:101000});Object.assign(bg.words[0],{beginMs:100000,endMs:101000});doc.lines.splice(1,0,bg);return codec.serializeLyricTtml(doc,{draft:true});
 });
 await importLyrics(page,{name:'viewport.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
 const outline=page.locator('[data-outline-drag]');await outline.first().click();await outline.last().click({modifiers:['Shift']});
 const groups=page.locator('[data-expanded-line]');await expect(groups).toHaveCount(6);await expect(page.locator('[data-expanded-line="row-0"]')).toBeAttached();await expect(page.locator('[data-expanded-line="offscreen-bg"]')).toHaveCount(0);
 const selected=await outline.first().getAttribute('aria-pressed');const plot=page.locator('[data-track-lane]').first(),width=(await plot.boundingBox())!.width;
 await plot.dispatchEvent('wheel',{deltaX:width*2,shiftKey:true});await expect(page.locator('[data-expanded-line="row-0"]')).toHaveCount(0);
 await plot.dispatchEvent('wheel',{deltaX:-width*2,shiftKey:true});await expect(page.locator('[data-expanded-line="row-0"]')).toBeAttached();expect(await outline.first().getAttribute('aria-pressed')).toBe(selected);
 const firstWord=page.locator('[data-expanded-line="row-0"] [data-timeline-key]').first(),box=(await firstWord.boundingBox())!;
 await firstWord.dispatchEvent('contextmenu',{clientX:box.x+4,clientY:box.y+4});await expect(page.getByRole('menu')).toBeVisible();
 await plot.dispatchEvent('wheel',{deltaX:width*2,shiftKey:true});await expect(page.locator('[data-expanded-line="row-0"]')).toBeAttached();expect(await groups.count()).toBeLessThan(8);
 await page.keyboard.press('Escape');await expect(firstWord).toBeFocused();await outline.first().focus();await expect(page.locator('[data-expanded-line="row-0"]')).toHaveCount(0);
 await plot.dispatchEvent('wheel',{deltaX:-width*2,shiftKey:true});await outline.first().click();await outline.last().click({modifiers:['Shift']});
 await page.getByRole('button',{name:'全曲',exact:true}).click();await expect.poll(()=>groups.count()).toBeGreaterThan(0);expect(await groups.count()).toBeLessThan(41);
 for(let i=0;i<3;i++)await page.getByRole('button',{name:'放大波形',exact:true}).click();await expect(page.locator('[data-expanded-line="offscreen-bg"]')).toHaveCount(0);expect(await groups.count()).toBeLessThan(8);
});
