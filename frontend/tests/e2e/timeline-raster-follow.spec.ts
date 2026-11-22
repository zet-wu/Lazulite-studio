import {expect,test} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {loadTimeline} from '../fixtures/timeline-setup';

test.use({video:'on'});
for(const dpr of [1,2])test.describe(`raster follow DPR ${dpr}`,()=>{
 test.use({deviceScaleFactor:dpr});
 test('waveform and cached spectrum stay aligned with the live viewport across rebases',async({page},info)=>{
  await page.setViewportSize({width:1440,height:1000});
  await page.addInitScript(()=>{
   const fetchOriginal=window.fetch;
   window.fetch=async(input,init)=>{
    if(String(input).includes('/waveform?'))return Response.json({schema_version:'studio-waveform-v1',asset_id:'sample-asset',asset_hash:'sample',version:'peaks-v1',level:0,start_ms:0,end_ms:120000,bucket_ms:1000,maximum:Array.from({length:120},(_,i)=>i===10?1:0),minimum:Array.from({length:120},(_,i)=>i===10?-1:0)});
    return fetchOriginal(input,init);
   };
  });
  await loadTimeline(page,true);
  await page.evaluate(()=>{
   const wave=new WeakMap<HTMLCanvasElement,number>(),spectrum=new WeakMap<HTMLCanvasElement,number[]>();
   const proto=CanvasRenderingContext2D.prototype,move=proto.moveTo,fill=proto.fillRect,draw=proto.drawImage;
   proto.moveTo=function(x,y){if(y===0&&this.canvas.closest('[role=slider]'))wave.set(this.canvas,x);return move.call(this,x,y);};
   proto.fillRect=function(x,y,w,h){if(x===0&&y===0&&w===this.canvas.width&&h===this.canvas.height)spectrum.set(this.canvas,[]);return fill.call(this,x,y,w,h);};
   proto.drawImage=function(image:CanvasImageSource,...args:number[]){if(this.canvas.closest('[data-spectrum-ready]')&&args.length===4){const tiles=spectrum.get(this.canvas)!;if(!tiles.length)tiles.push(args[0],args[2]);}return Reflect.apply(draw,this,[image,...args]);};
   (window as unknown as {rasterMarkers:unknown}).rasterMarkers={wave,spectrum};
  });
  await page.getByRole('checkbox',{name:'播放跟随',exact:true}).check();
  await page.locator('audio').evaluate(async(audio:HTMLAudioElement)=>{audio.currentTime=8;await audio.play();});
  const samples=await page.evaluate(()=>new Promise<{now:number;time:number;start:number;waveError:number;spectrumError:number}[]>(resolve=>{
   const markers=(window as unknown as {rasterMarkers:{wave:WeakMap<HTMLCanvasElement,number>;spectrum:WeakMap<HTMLCanvasElement,number[]>}}).rasterMarkers;
   const wave=document.querySelector<HTMLCanvasElement>('[role=slider] canvas')!,spectrum=document.querySelector<HTMLCanvasElement>('[data-spectrum-ready] canvas')!,audio=document.querySelector('audio')!,rows:{now:number;time:number;start:number;waveError:number;spectrumError:number}[]=[];
   const error=(canvas:HTMLCanvasElement,time:number,pixel:number)=>{const layer=canvas.parentElement!,r=layer.getBoundingClientRect(),shift=new DOMMatrix(getComputedStyle(layer).transform).m41,start=Number(document.querySelector<HTMLElement>('#timeline-plots')!.dataset.viewStart),expected=r.left-shift+(time-start)/15000*r.width;return canvas.getBoundingClientRect().left+pixel-expected;};
   // At 8–10 s in a 15 s follow viewport, the first cached tile remains 0–4 s.
   let first=0;const frame=(now:number)=>{first ||= now;const wx=markers.wave.get(wave),tile=markers.spectrum.get(spectrum);if(wx!==undefined&&tile?.length)rows.push({now,time:audio.currentTime,start:Number(document.querySelector<HTMLElement>('#timeline-plots')!.dataset.viewStart),waveError:error(wave,10500,wx),spectrumError:error(spectrum,10000,(tile[0]+tile[1]*2.5)/spectrum.width*spectrum.getBoundingClientRect().width)});if(now-first<1800)requestAnimationFrame(frame);else resolve(rows);};requestAnimationFrame(frame);
  }));
  await page.locator('audio').evaluate((audio:HTMLAudioElement)=>audio.pause());
  const dir=process.env.RASTER_EVIDENCE??info.outputPath('raster');await mkdir(dir,{recursive:true});await writeFile(`${dir}/dpr${dpr}.json`,JSON.stringify(samples,null,2));await page.screenshot({path:`${dir}/dpr${dpr}.png`});
  expect(samples.length).toBeGreaterThan(20);
  expect(Math.max(...samples.map(row=>Math.abs(row.waveError)))).toBeLessThan(.2);
  expect(Math.max(...samples.map(row=>Math.abs(row.spectrumError)))).toBeLessThan(.2);
 });
});
