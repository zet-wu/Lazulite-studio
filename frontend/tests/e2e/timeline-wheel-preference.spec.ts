import {test,expect} from '@playwright/test';
import {loadTimeline} from '../fixtures/timeline-setup';
for(const swapped of [false,true])test(`wheel mapping ${swapped}: all plots pan without seek or scale, shift reverses mapping`,async({page})=>{
 await loadTimeline(page,true);
 if(swapped){await page.locator('[data-settings-button]').click();await page.getByRole('dialog').getByRole('button',{name:'时间轴',exact:true}).click();await page.getByRole('switch',{name:'交换滚轮操作'}).check();await page.keyboard.press('Escape');}
 const range=page.locator('span').filter({hasText:/^视窗\s*\d/}).first();const bounds=async()=>{const values=(await range.textContent())!.match(/\d+:\d+\.\d+/g)!.map(text=>{const [minutes,seconds]=text.split(':').map(Number);return minutes*60+seconds;});return [values[0],values[1]-values[0]];};
 const audio=page.locator('audio');const playhead=await audio.evaluate((a:HTMLAudioElement)=>a.currentTime);
 const plots=page.locator('[data-wheel-zoom]');
 for(let i=0;i<await plots.count();i++){
  const plot=plots.nth(i),box=await plot.boundingBox();if(!box||!box.height)continue;
  const before=await bounds();await plot.dispatchEvent('wheel',{deltaY:40,shiftKey:!swapped,clientX:box.x+box.width/2});const after=await bounds();expect(after[0]).toBeGreaterThan(before[0]);expect(Math.abs(after[1]-before[1])).toBeLessThan(.03);
 }
 const plot=plots.first(),box=(await plot.boundingBox())!;
 for(const deltaMode of [0,1,2]){const before=await bounds();await plot.dispatchEvent('wheel',{deltaX:deltaMode?1:40,deltaMode,shiftKey:!swapped});expect((await bounds())[0]).toBeGreaterThan(before[0]);}
 const before=await bounds();await plot.dispatchEvent('wheel',{deltaY:-100,shiftKey:swapped,clientX:box.x+box.width/2});const zoomed=await bounds();expect(zoomed[1]).toBeLessThan(before[1]);expect(Math.abs(zoomed[0]+zoomed[1]/2-before[0]-before[1]/2)).toBeLessThan(.03);expect(await audio.evaluate((a:HTMLAudioElement)=>a.currentTime)).toBe(playhead);
 await page.getByRole('checkbox',{name:'播放跟随',exact:true}).check();await plot.dispatchEvent('wheel',{deltaY:40,shiftKey:!swapped});await expect(page.getByRole('checkbox',{name:'播放跟随',exact:true})).not.toBeChecked();
 await plot.dispatchEvent('wheel',{deltaY:-1e6,shiftKey:!swapped});expect((await bounds())[0]).toBe(0);
 if(swapped){await page.locator('[data-settings-button]').click();await page.getByRole('dialog').getByRole('button',{name:'时间轴',exact:true}).click();await expect(page.getByRole('switch',{name:'交换滚轮操作'})).toBeChecked();}
});

test('wheel zoom and shift+wheel pan stay active across timeline collapse/expand and audio mode remounts',async({page})=>{
  await loadTimeline(page,false);
  const bounds=async()=>{const values=(await page.locator('span').filter({hasText:/^视窗\s*\d/}).first().textContent())!.match(/\d+:\d+\.\d+/g)!.map(text=>{const [m,s]=text.split(':').map(Number);return m*60+s;});return [values[0],values[1]-values[0]];};
  // Switch from edit mode to audio mode (mounts Portal timelineHost)
  await page.getByRole('button',{name:'音频处理',exact:true}).click();
  const portalPlot=page.locator('[data-wheel-zoom]').first();
  const portalBox=(await portalPlot.boundingBox())!;
  const beforePortal=await bounds();
  await portalPlot.dispatchEvent('wheel',{deltaY:-120,shiftKey:false,clientX:portalBox.x+portalBox.width/2});
  const zoomedPortal=await bounds();
  expect(zoomedPortal[1]).toBeLessThan(beforePortal[1]);
  await portalPlot.dispatchEvent('wheel',{deltaY:60,shiftKey:true,clientX:portalBox.x+portalBox.width/2});
  expect((await bounds())[0]).toBeGreaterThan(zoomedPortal[0]);

  // Switch back to edit mode and toggle collapse/expand
  await page.getByRole('button',{name:'编辑',exact:true}).click();
  await page.getByRole('button',{name:'收起时间轴',exact:true}).click();
  await page.getByRole('button',{name:'展开时间轴',exact:true}).click();
  const inlinePlot=page.locator('[data-wheel-zoom]').first();
  const inlineBox=(await inlinePlot.boundingBox())!;
  const beforeInline=await bounds();
  await inlinePlot.dispatchEvent('wheel',{deltaY:-120,shiftKey:false,clientX:inlineBox.x+inlineBox.width/2});
  const zoomedInline=await bounds();
  expect(zoomedInline[1]).toBeLessThan(beforeInline[1]);
  await inlinePlot.dispatchEvent('wheel',{deltaY:60,shiftKey:true,clientX:inlineBox.x+inlineBox.width/2});
  expect((await bounds())[0]).toBeGreaterThan(zoomedInline[0]);
});
