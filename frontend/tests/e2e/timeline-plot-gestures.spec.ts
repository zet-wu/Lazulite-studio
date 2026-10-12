import { expect, test, type Page, type Locator } from '@playwright/test';
import { loadTimeline as load } from '../fixtures/timeline-setup';
async function gesture(page:Page,plot:Locator,delta:number,cancel=false,back=false) {
  await plot.scrollIntoViewIfNeeded(); const b=(await plot.boundingBox())!;
  const x=b.x+b.width*.8,y=b.y+b.height*.5;
  await page.mouse.move(x,y); await page.mouse.down(); await page.mouse.move(x+delta,y,{steps:5});
  if(back) await page.mouse.move(x,y,{steps:3});
  if(cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
}
for(const theme of ['light','dark']) for(const audio of [false,true]) test(`geometry and surfaces ${theme} audio=${audio}`,async({page})=>{
  await page.setViewportSize({width:1280,height:800});
  await page.addInitScript(theme=>localStorage.setItem('lazulite-editor-theme',theme),theme);
  await load(page,audio);
  const measure=()=>page.locator('#timeline-plots').evaluate(el=>{
    const rows=Array.from(el.querySelectorAll<HTMLElement>('[data-track-lane]')).map(lane=>{
      const l=lane.getBoundingClientRect(),r=lane.parentElement!.getBoundingClientRect();
      return {group:lane.closest('section[aria-label]')?.getAttribute('aria-label')??null,name:lane.parentElement!.textContent,row:r.height,lane:l.height,top:r.top,bottom:r.bottom,bars:Array.from(lane.children).map(b=>{const q=b.getBoundingClientRect();return {top:q.top-l.top,bottom:q.bottom-l.top,height:q.height,bg:getComputedStyle(b).backgroundColor};})};
    });
    return {height:el.clientHeight,scroll:el.scrollHeight,rows,surfaces:Array.from(el.querySelectorAll('[data-timeline-pan], [data-track-lane]')).filter(e=>e.tagName!=='CANVAS'&&e.getAttribute('aria-label')!=='时间标尺').map(e=>getComputedStyle(e).backgroundColor)};
  });
  for(const height of [800,650]) {
    await page.setViewportSize({width:1280,height});
    const m=await measure();
    for(const r of m.rows) {expect(r.row).toBeGreaterThanOrEqual(r.lane);for(const b of r.bars){expect(b.height).toBe(20);expect(b.top).toBeGreaterThanOrEqual(1);expect(b.bottom).toBeLessThanOrEqual(r.lane-1);}}
    expect(m.rows.filter(r=>r.lane===66)).toHaveLength(2);
    for(let i=1;i<m.rows.length;i++) if(m.rows[i].group===m.rows[i-1].group) expect(m.rows[i].top-m.rows[i-1].bottom).toBe(4);
    expect(await page.getByRole('region',{name:'L1 子轨',exact:true}).getByText('L1',{exact:true}).count()).toBe(1);
    expect(new Set(m.surfaces).size).toBe(1);
    if(!audio){expect(m.height).toBeLessThanOrEqual(300);expect(m.scroll).toBeGreaterThan(m.height);}
    const gap=m.rows.find(r=>r.name?.startsWith('空隙'))!;expect(new Set(gap.bars.map(b=>b.bg)).size).toBe(2);
  }
  await page.screenshot({path:test.info().outputPath('timeline.png')});
  await page.getByRole('button',{name:'注音',exact:true}).click();
  expect((await measure()).rows.filter(r=>r.lane===66)).toHaveLength(1);
});
for(const region of ['energy','segments','spectrum']) test(`plot gesture ${region}: click, threshold, cancel and history`,async({page})=>{
  await load(page,true);
  const plot=region==='energy'?page.locator('[data-timeline-pan="seek"]').filter({has:page.getByLabel('人声能量')}):region==='segments'?page.locator('[data-vocal-lane]'):page.getByLabel('声谱图',{exact:true});
  const wave=page.getByRole('slider',{name:'波形进度'}), range=page.locator('span').filter({hasText:/^视窗 \d/}).first();
  const original=await range.textContent();
  await page.locator('audio').evaluate((a:HTMLAudioElement)=>{a.currentTime=1;});
  await expect(wave).toHaveAttribute('aria-valuenow','1');
  const undo=page.getByRole('button',{name:'撤销',exact:true});const history=await undo.isEnabled();
  await gesture(page,plot,-80,true); await expect(range).toHaveText(original!);await expect(wave).toHaveAttribute('aria-valuenow','1');
  await gesture(page,plot,-80,false,true);await expect(wave).toHaveAttribute('aria-valuenow','1');
  await gesture(page,plot,-80);await expect(range).not.toHaveText(original!);await expect(wave).toHaveAttribute('aria-valuenow','1');
  await gesture(page,plot,2);if(region==='segments')await expect(wave).toHaveAttribute('aria-valuenow','1');else await expect.poll(()=>wave.getAttribute('aria-valuenow')).not.toBe('1');
  expect(await undo.isEnabled()).toBe(history);expect(await page.locator('audio').evaluate((a:HTMLAudioElement)=>a.paused)).toBe(true);
  if(region!=='segments') {
    await page.getByRole('button',{name:'播放',exact:true}).click();
    await gesture(page,plot,0);
    expect(await page.locator('audio').evaluate((a:HTMLAudioElement)=>a.paused)).toBe(false);
    await page.getByRole('button',{name:'暂停',exact:true}).click();
  }
  const beforeCancel=await range.textContent();await plot.scrollIntoViewIfNeeded();const b=(await plot.boundingBox())!;
  await page.mouse.move(b.x+b.width*.8,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width*.6,b.y+b.height/2);
  await page.locator('#timeline-plots').evaluate(e=>{for(let id=1;id<5;id++)if(e.hasPointerCapture(id))e.releasePointerCapture(id);});
  await page.mouse.up();await expect(range).toHaveText(beforeCancel!);
});

test('segment edits and add mode retain priority over plot panning',async({page})=>{
  await load(page,true);
  const range=page.locator('span').filter({hasText:/^视窗 \d/}).first(),original=await range.textContent();
  const segment=page.locator('[data-segment-id="s1"]');
  const before=await segment.getAttribute('aria-label');await gesture(page,segment,25);
  await expect(segment).not.toHaveAttribute('aria-label',before!);await expect(range).toHaveText(original!);
  await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(segment).toHaveAttribute('aria-label',before!);
  await page.getByRole('button',{name:'新建人声片段',exact:true}).click();
  const lane=page.locator('[data-vocal-lane]');await gesture(page,lane,-60);
  await expect(page.locator('[data-segment-id]')).toHaveCount(2);await expect(range).toHaveText(original!);
  await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.locator('[data-segment-id]')).toHaveCount(1);
});
