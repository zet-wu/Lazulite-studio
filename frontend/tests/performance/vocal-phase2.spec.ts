import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

test('complete real song follow, both graphic sources, speed and A/B remain responsive',async({page})=>{
  test.skip(!process.env.STUDIO_FOLLOW_URL || !process.env.STUDIO_FOLLOW_PROJECT,'Requires an isolated real-media project and running server');
  const requests=new Map<import('@playwright/test').Request,number>();
  const stats={waveform:0,energy:0,cancelled:0,maxInFlight:0,latenciesMs:[] as number[],samples:[] as unknown[],errors:[] as string[]};
  page.on('request',r=>{if(/\/(waveform|energy)\?/.test(r.url())){stats[r.url().includes('/energy?')?'energy':'waveform']++;requests.set(r,Date.now());stats.maxInFlight=Math.max(stats.maxInFlight,requests.size);}});
  page.on('requestfinished',r=>{if(requests.has(r)){stats.latenciesMs.push(Date.now()-requests.get(r)!);requests.delete(r);}});
  page.on('requestfailed',r=>{if(requests.delete(r))stats.cancelled++;});
  page.on('pageerror',e=>stats.errors.push(e.message));
  const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
  await page.goto(`/projects/${process.env.STUDIO_FOLLOW_PROJECT}/edit`);
  await page.getByRole('button',{name:'音频处理',exact:true}).click();
  await expect(page.locator('[data-segment-id]').first()).toBeVisible();
  const duration=await page.locator('audio').evaluate((el:HTMLAudioElement)=>el.duration);
  const initialStats=await page.request.get(`/api/v1/projects/${process.env.STUDIO_FOLLOW_PROJECT}/document`);
  const revision=(await initialStats.json()).revision;
  for(let i=0;i<5;i++)await page.getByRole('button',{name:'放大波形',exact:true}).click();
  await page.getByLabel('播放跟随',{exact:true}).check();
  await page.getByRole('button',{name:'播放',exact:true}).click();
  async function sample(phase:string) {
    const start=Date.now();const health=await page.request.get('/api/v1/session',{timeout:3000});
    expect(health.ok()).toBeTruthy();
    const display=await page.evaluate(()=>{
      const audio=document.querySelector('audio')!;
      const canvas=document.querySelector('[aria-label="波形进度"] canvas') as HTMLCanvasElement|null;
      const pixels=canvas?.getContext('2d')?.getImageData(0,0,canvas.width,canvas.height).data;
      return {time:audio.currentTime,paused:audio.paused,energyPoints:document.querySelector('[aria-label="人声能量"] polyline')?.getAttribute('points')?.length??0,wavePainted:pixels?.some((v,i)=>i%4===3&&v>0)};
    });
    const metrics=(await cdp.send('Performance.getMetrics')).metrics;
    stats.samples.push({phase,healthMs:Date.now()-start,...display,metrics:Object.fromEntries(metrics.filter(m=>['JSHeapUsedSize','Nodes','TaskDuration','ScriptDuration','LayoutDuration'].includes(m.name)).map(m=>[m.name,m.value]))});
    expect(display.energyPoints).toBeGreaterThan(0);expect(display.wavePainted).toBeTruthy();
    await expect(page.locator('audio')).toHaveCount(1);
    return display;
  }
  // Real elapsed playback, no advancing the media clock to simulate completion.
  for(const phase of ['vocal-narrow-1x','original-wide-2x']) {
    if(phase==='original-wide-2x') {
      const source=page.getByRole('combobox',{name:'波形／声谱图音源',exact:true});
      await source.click();await page.keyboard.press('Home');await page.keyboard.press('Enter');
      for(let i=0;i<3;i++)await page.getByRole('button',{name:'缩小波形',exact:true}).click();
      await page.getByLabel('播放跟随',{exact:true}).check();
      await page.getByRole('slider',{name:'播放速度',exact:true}).focus();await page.keyboard.press('End');
      await page.locator('audio').evaluate((el:HTMLAudioElement)=>{el.currentTime=0;});
      await page.getByRole('button',{name:'播放',exact:true}).click();
    }
    let time=0;
    while(time<duration-.2) {
      await page.waitForTimeout(2000);
      time=(await sample(phase)).time;
    }
  }
  // Existing single A/B loop, captured from real transport controls.
  await page.getByRole('button',{name:'恢复 1 倍速度',exact:true}).click();
  await page.locator('audio').evaluate((el:HTMLAudioElement)=>{el.currentTime=20;});
  await page.getByRole('button',{name:/^A /}).click();
  await page.locator('audio').evaluate((el:HTMLAudioElement)=>{el.currentTime=23;});
  await page.getByRole('button',{name:/^B /}).click();
  await page.getByRole('button',{name:'循环 A/B',exact:true}).click();
  await page.getByRole('button',{name:'播放',exact:true}).click();
  for(let i=0;i<5;i++){await page.waitForTimeout(2000);const s=await sample('ab');expect(s.time).toBeGreaterThanOrEqual(19.9);expect(s.time).toBeLessThan(23.2);}
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  expect((await (await page.request.get(`/api/v1/projects/${process.env.STUDIO_FOLLOW_PROJECT}/document`)).json()).revision).toBe(revision);
  expect(stats.energy).toBeLessThan(400);expect(stats.maxInFlight).toBeLessThanOrEqual(6);expect(stats.errors).toEqual([]);
  await writeFile(test.info().outputPath('follow.json'),JSON.stringify({duration,environment:'Linux Chromium, real media in isolated project copy; development server',...stats},null,2));
});
