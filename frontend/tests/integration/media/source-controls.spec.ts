import { uploadFixtureMusic } from '../../fixtures/upload-music';
import { test, expect, type Page } from '@playwright/test';

async function setup(page: Page) {
 const asset = await uploadFixtureMusic(page);
  const response = await page.request.post('/api/v1/projects', {headers:{origin:'http://127.0.0.1:5175'},data:{name:'Audio sources',upload_id:asset}});
  const pid = (await response.json()).id;
  await page.goto(`/projects/${pid}/edit`);
  await page.getByRole('button',{name:'音频处理',exact:true}).click();
  await page.getByRole('button',{name:'分离人声'}).click();
  await expect(page.locator('[data-segment-id]').first()).toBeVisible({timeout:30000});
  return pid;
}

for (const width of [1280,1440,1920]) for (const theme of ['light','dark']) {
  test(`source popup stays attached above the compact transport ${width} ${theme}`, async ({page}) => {
    await page.setViewportSize({width,height:620});
    await setup(page);
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    const source=page.getByRole('combobox',{name:'播放音源',exact:true});
    for (const mode of ['音频处理','编辑','音频处理']) {
      await page.getByRole('button',{name:mode,exact:true}).click();
      if(mode==='编辑')await page.getByRole('button',{name:'收起时间轴',exact:true}).click();
      await source.click();
      const popup=page.getByRole('listbox');await expect(popup).toBeVisible();
      const a=(await source.boundingBox())!, b=(await popup.boundingBox())!;
      expect(Math.abs(a.y-b.y-b.height-4)).toBeLessThan(1);
      expect(b.x).toBeGreaterThanOrEqual(8);expect(b.x+b.width).toBeLessThanOrEqual(width-8);
      await page.keyboard.press('End');await page.keyboard.press('Enter');
      await expect(source).toBeFocused();await expect(popup).toHaveCount(0);
    }
  });
}

test('follow reuses energy windows and preserves the curve across slow window crossings', async ({page}) => {
  test.setTimeout(45000);
  const pid=await setup(page);
  let requests=0;
  await page.route(`**/projects/${pid}/vocals/*/energy?**`,async route=>{
    requests++;
    const response=await route.fetch();
    await new Promise(resolve=>setTimeout(resolve,180));
    await route.fulfill({response});
  });
  for(let i=0;i<2;i++)await page.getByRole('button',{name:'放大波形',exact:true}).click();
  await expect(page.locator('[aria-label="人声能量"] polyline')).not.toHaveAttribute('points','');
  await page.getByLabel('播放跟随',{exact:true}).check();
  await page.getByRole('button',{name:'播放',exact:true}).click();
  const populated:boolean[]=[];
  for(let i=0;i<20;i++) {
    await page.waitForTimeout(200);
    populated.push(!!await page.locator('[aria-label="人声能量"] polyline').getAttribute('points'));
  }
  expect(requests).toBeLessThan(20);
  expect(populated.every(Boolean)).toBeTruthy();
  const time=await page.locator('audio').evaluate((el:HTMLAudioElement)=>el.currentTime);
  expect(time).toBeGreaterThan(3);
  await expect(page.locator('audio')).toHaveCount(1);
});

test('popup supports long lists, narrow available space and closes when its anchor moves',async({page})=>{
  const pid=await setup(page);

  await page.setViewportSize({width:1280,height:620});
  const source=page.getByRole('combobox',{name:'播放音源',exact:true});
  // Geometry-only fixture: product audio choices are intentionally limited to two.
  await source.evaluate((el:HTMLSelectElement)=>{for(let i=0;i<40;i++)el.add(new Option(`测试选项 ${i}`,`fixture-${i}`));});
  await source.click();
  const popup=page.getByRole('listbox');await expect(popup).toBeVisible();
  expect((await popup.boundingBox())!.height).toBeLessThanOrEqual(280);
  await page.keyboard.press('End');
  const active=popup.locator('[data-active=true]');await expect(active).toBeInViewport();
  expect(await popup.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press('Escape');await expect(source).toBeFocused();
  await source.click();await source.evaluate(el=>el.style.transform='translateX(10px)');
  await expect(popup).toHaveCount(0);
});
