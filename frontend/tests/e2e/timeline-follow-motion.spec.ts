import {test,expect} from '@playwright/test';
import {writeFile,mkdir} from 'node:fs/promises';
test.use({video:'on'});
import {loadTimeline} from '../fixtures/timeline-setup';
for(const follow of [false,true])test(`sample media-clock motion follow=${follow}`,async({page},info)=>{
 await page.setViewportSize({width:1440,height:1000});await loadTimeline(page,true);
 await page.getByRole('checkbox',{name:'播放跟随',exact:true}).setChecked(follow);
 const audio=page.locator('audio');await audio.evaluate(async(a:HTMLAudioElement)=>{a.currentTime=8;await a.play();});
 const session=await page.context().newCDPSession(page);await session.send('Performance.enable');
 const before=await session.send('Performance.getMetrics');
 const samples=await page.evaluate(()=>new Promise<unknown[]>(resolve=>{
  const audio=document.querySelector('audio')!,bar=document.querySelector<HTMLElement>('[data-timeline-key]')!,lane=bar.closest('[data-track-lane]')!;
  const rows:unknown[]=[];let first=0;const frame=(now:number)=>{first ||= now;const rect=bar.getBoundingClientRect(),view=lane.getBoundingClientRect();rows.push({now,time:audio.currentTime,left:rect.left-view.left,width:rect.width,top:rect.top,connected:bar.isConnected,start:document.querySelector('#timeline-plots')?.getAttribute('data-view-start')});if(now-first<1600)requestAnimationFrame(frame);else resolve(rows);};requestAnimationFrame(frame);
 }));
 await audio.evaluate((a:HTMLAudioElement)=>a.pause());const after=await session.send('Performance.getMetrics');
 expect(samples.length).toBeGreaterThan(10);
 const dir=process.env.MOTION_EVIDENCE??info.outputPath('motion');await mkdir(dir,{recursive:true});
 await writeFile(`${dir}/${follow?'follow':'fixed'}.json`,JSON.stringify({samples,before,after},null,2));
 await page.screenshot({path:`${dir}/${follow?'follow':'fixed'}.png`});
});
