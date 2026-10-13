import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTimeline as load } from '../fixtures/timeline-setup';
async function gesture(page:Page,plot:Locator,delta:number,cancel=false,back=false) {
  await plot.scrollIntoViewIfNeeded(); const b=(await plot.boundingBox())!;
  const x=b.x+b.width*.8,y=b.y+b.height*.5;
  await page.mouse.move(x,y); await page.mouse.down(); await page.mouse.move(x+delta,y,{steps:5});
  if(back) await page.mouse.move(x,y,{steps:3});
  if(cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
}
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
