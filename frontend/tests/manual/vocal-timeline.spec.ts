import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
test('production vocal project uses bounded visible segments and one shared media clock',async({page})=>{
 test.setTimeout(60000);
 const clock=(n:number)=>`00:${String(Math.floor(n/60)).padStart(2,'0')}:${(n%60).toFixed(3).padStart(6,'0')}`;
 const before=await(await page.request.get('/api/v1/projects/synthetic/document')).json();
 const lines=Array.from({length:2000},(_,i)=>`<p xml:id="line-${i}" begin="${clock(i*.3)}" end="${clock(i*.3+.2)}"><span begin="${clock(i*.3)}" end="${clock(i*.3+.2)}">测试歌词${i}</span></p>`).join('');
 const segments=Array.from({length:2000},(_,i)=>({id:`segment-${i}`,beginMs:i*300,endMs:i*300+200}));
 const saved=await page.request.put('/api/v1/projects/synthetic/document',{headers:{origin:'http://127.0.0.1:5176','if-match':before.revision},data:{schema_version:before.schema_version,project_id:'synthetic',revision:before.revision,document:{...before.document,lyrics:{draftTtml:`<tt xmlns="http://www.w3.org/ns/ttml"><body><div>${lines}</div></body></tt>`},acoustics:{analysisId:null,segments}}}});expect(saved.ok()).toBeTruthy();
 const began=Date.now();await page.goto('/projects/synthetic/edit');await page.getByRole('button',{name:'音频处理',exact:true}).click();await expect(page.locator('[data-segment-id]')).toHaveCount(2000);const openedMs=Date.now()-began;
 for(let i=0;i<7;i++)await page.getByRole('button',{name:'放大波形',exact:true}).click();
 const mounted=await page.locator('[data-segment-id]').count();expect(mounted).toBeLessThan(30);
 const samples:number[]=[];
 for(let i=0;i<8;i++){
  const item=page.locator('[data-segment-id]').nth(2),box=(await item.boundingBox())!;const t=Date.now();
  await page.mouse.move(box.x+box.width/2,box.y+12);await page.mouse.down();await page.mouse.move(box.x+box.width/2+5,box.y+12,{steps:4});await page.mouse.up();await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));samples.push(Date.now()-t);
 }
 await expect(page.locator('audio')).toHaveCount(1);
 await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByRole('button',{name:'音频处理',exact:true}).click();expect(await page.locator('[data-segment-id]').count()).toBeLessThan(30);
 const memory=await page.evaluate(()=>('memory' in performance ? (performance as unknown as {memory:{usedJSHeapSize:number}}).memory.usedJSHeapSize:null));
 const sorted=[...samples].sort((a,b)=>a-b);
 await writeFile(test.info().outputPath('vocal-performance.json'),JSON.stringify({sourceDurationMs:640123,lyricRows:2000,segments:2000,openedMs,mountedAfterZoom:mounted,dragActionToTwoRafMs:samples,p95Ms:sorted[Math.ceil(sorted.length*.95)-1],usedJSHeapBytes:memory,scope:'Linux Chromium production; Playwright mouse actions to two RAF, includes automation overhead. Not a native input latency budget or Windows/macOS measurement.'},null,2));
});
