import { uploadFixtureMusic } from '../../fixtures/upload-music';
import { expect, test, type Page } from '@playwright/test';

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
  for(let i=0;i<4;i++) {
    await page.waitForTimeout(1000);
    populated.push(!!await page.locator('[aria-label="人声能量"] polyline').getAttribute('points'));
  }
  expect(requests).toBeLessThan(20);
  expect(populated.every(Boolean)).toBeTruthy();
  const time=await page.locator('audio').evaluate((el:HTMLAudioElement)=>el.currentTime);
  expect(time).toBeGreaterThan(3);
  await expect(page.locator('audio')).toHaveCount(1);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.unrouteAll({ behavior: 'wait' });
});
