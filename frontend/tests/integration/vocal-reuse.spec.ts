import { uploadFixtureMusic } from '../fixtures/upload-music';
import { test, expect } from '@playwright/test';

test('one vocal source across reanalysis, undo, reload and cached separation adoption',async({page})=>{
 const asset = await uploadFixtureMusic(page);
 const created=await page.request.post('/api/v1/projects',{headers:{origin:'http://127.0.0.1:5175'},data:{name:'共享人声',upload_id:asset}});
 const pid=(await created.json()).id;
 const current=async()=>(await(await page.request.get(`/api/v1/projects/${pid}/document`)).json()).document.acoustics;
 await page.goto(`/projects/${pid}/edit`);
 await page.getByRole('button',{name:'音频处理',exact:true}).click();
 await page.getByRole('button',{name:'分离人声',exact:true}).click();
 await expect.poll(async()=>(await current()).analysisId).toBeTruthy();
 const original=await current();
 const checkSources=async()=>{
  for(const name of ['播放音源','波形／声谱图音源']){
   await page.getByLabel(name,{exact:true}).click();
   await expect(page.getByRole('listbox').getByRole('option')).toHaveText(['原曲','人声']);
   await page.keyboard.press('Escape');
  }
 };
 await checkSources();
 await page.locator('[data-top-menu="audio-analysis"] summary').click();
 await expect(page.getByRole('button',{name:'重新分离并分析',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'更新人声分离结果',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'重新进行声学分析',exact:true}).click();
 await expect.poll(async()=>(await current()).analysisId).not.toBe(original.analysisId);
 await checkSources();
 const items=(await(await page.request.get(`/api/v1/projects/${pid}/vocals`)).json()).items;
 expect(items).toHaveLength(2);
 expect(new Set(items.map((r:{audio_id:string})=>r.audio_id)).size).toBe(1);
 await page.getByRole('button',{name:'撤销',exact:true}).click();
 await expect.poll(async()=>(await current()).analysisId).toBe(original.analysisId);
 await page.getByRole('button',{name:'撤销',exact:true}).click();
 await expect.poll(async()=>(await current()).analysisId).toBeNull();
 await page.getByRole('button',{name:'使用已有人声',exact:true}).click();
 await expect.poll(async()=>(await current()).analysisId).toBe(items[0].id);
 expect((await(await page.request.get(`/api/v1/projects/${pid}/vocals`)).json()).items).toHaveLength(2);
 await page.reload();await page.getByRole('button',{name:'音频处理',exact:true}).click();
 await expect(page.locator('[data-segment-id]').first()).toBeVisible();
 await checkSources();
 await page.getByLabel('播放音源',{exact:true}).click();await page.getByRole('listbox').getByRole('option',{name:'人声',exact:true}).click();
 await expect(page.locator('audio')).toHaveAttribute('src',new RegExp(`vocal=${original.analysisId}$`));
 await expect.poll(()=>page.locator('audio').evaluate((el:HTMLAudioElement)=>el.readyState)).toBeGreaterThanOrEqual(1);
});
