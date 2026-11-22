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

for(const dpr of [1,2])for(const theme of ['light','dark'])test.describe(`motion DPR ${dpr} ${theme}`,()=>{
 test.use({deviceScaleFactor:dpr});
 test('long labels, overlaps and active-row changes use stable complete widths',async({page},info)=>{
  await page.setViewportSize({width:1440,height:1000});await loadTimeline(page,true);
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  const xml='<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft"><body><p xml:id="long" begin="0" end="20"><span studio:id="long-word" begin="7" end="20">'+('完整长词 Long é '.repeat(60))+'</span><span studio:id="overlap-a" begin="8.3" end="8.8">短词</span><span studio:id="overlap-b" begin="8.5" end="9.5">'+('重叠存续长词'.repeat(30))+'</span></p><p begin="7" end="9"><span begin="7" end="9">活动行一</span></p><p begin="9" end="11"><span begin="9" end="11">活动行二</span></p></body></tt>';
  const {importLyrics}=await import('../fixtures/import-lyrics');await importLyrics(page,{name:'motion.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});await page.locator('[data-outline-drag]').first().click();
  for(let i=0;i<4;i++)await page.getByRole('button',{name:'放大波形',exact:true}).click();
  await page.getByRole('checkbox',{name:'播放跟随',exact:true}).check();await page.locator('audio').evaluate(async(a:HTMLAudioElement)=>{a.currentTime=8;await a.play();});
  await expect(page.locator('[data-expanded-line="long"] [data-timeline-key="long-word"]')).toBeAttached();
  const samples=await page.evaluate(()=>new Promise<unknown[]>(resolve=>{
   const bar=document.querySelector<HTMLElement>('[data-expanded-line="long"] [data-timeline-key]')!,audio=document.querySelector('audio')!,rows:unknown[]=[];let first=0;
   const frame=(now:number)=>{first ||= now;const rect=bar.getBoundingClientRect();rows.push({now,time:audio.currentTime,left:rect.left,width:rect.width,top:rect.top,connected:bar.isConnected,font:getComputedStyle(bar).font,tracks:Array.from(document.querySelectorAll<HTMLElement>('[data-timeline-key]'),node=>({id:node.dataset.timelineKey,top:node.getBoundingClientRect().top})),groups:Array.from(document.querySelectorAll<HTMLElement>('[data-expanded-line]'),node=>node.dataset.expandedLine)});if(now-first<1600)requestAnimationFrame(frame);else resolve(rows);};requestAnimationFrame(frame);
  }));
  await page.locator('audio').evaluate((a:HTMLAudioElement)=>a.pause());
  expect(new Set((samples as {width:number}[]).map(row=>Math.round(row.width)))).toHaveProperty('size',1);
  expect((samples as {connected:boolean}[]).every(row=>row.connected)).toBe(true);
  const overlapTops=(samples as {tracks:{id:string;top:number}[]}[]).flatMap(row=>row.tracks.filter(track=>track.id==='overlap-b').map(track=>track.top));expect(overlapTops.length).toBeGreaterThan(1);
  // Record vertical changes separately: empty lanes may collapse during follow.
  const dir=process.env.MOTION_EVIDENCE??info.outputPath('motion');await mkdir(dir,{recursive:true});await writeFile(`${dir}/dpr${dpr}-${theme}.json`,JSON.stringify(samples,null,2));await page.screenshot({path:`${dir}/dpr${dpr}-${theme}.png`});
 });
});
