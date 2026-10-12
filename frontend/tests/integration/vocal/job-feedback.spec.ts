import { expect, test, type Page } from '@playwright/test';
import { uploadFixtureMusic } from '../../fixtures/upload-music';
async function setup(page:Page,old=true){
 const asset=await uploadFixtureMusic(page);
 const response=await page.request.post('/api/v1/projects',{headers:{origin:'http://127.0.0.1:5175'},data:{name:'人声任务反馈',upload_id:asset}});
 const pid=(await response.json()).id;
 const url=`/api/v1/projects/${pid}/document`,envelope=await(await page.request.get(url)).json();
 if(old){envelope.document.acoustics={analysisId:null,segments:[{id:'old1',beginMs:100,endMs:500},{id:'old2',beginMs:800,endMs:1200}]};
  expect((await page.request.put(url,{headers:{origin:'http://127.0.0.1:5175','if-match':envelope.revision},data:envelope})).ok()).toBe(true);}
 const state={started:false,status:'queued',cancelFails:true,readsFail:false,retries:0,resultAsset:asset};
 const job=()=>({id:'vocal-feedback-job',kind:'vocal',status:state.status,stage:'separating',request:{asset_id:asset,bound_revision:envelope.revision,devices:{vocal:{preferred:'auto',actual:'cuda',label:'CUDA'}}},error:state.status==='failed'?{message:'GPU 人声测试失败',cpu_retry:true}:null});
 await page.route(`**/projects/${pid}/jobs/vocal`,route=>{state.started=true;return route.fulfill({json:job()});});
 await page.route(`**/projects/${pid}/jobs`,route=>state.readsFail?route.fulfill({status:503,json:{message:'测试连接中断'}}):route.fulfill({json:{schema_version:'studio-job-list-v1',items:state.started?[job()]:[]}}));
 await page.route('**/jobs/vocal-feedback-job/cancel',route=>{if(state.cancelFails)return route.fulfill({status:500,json:{message:'取消测试失败'}});state.status='cancel_requested';return route.fulfill({json:job()});});
 await page.route('**/jobs/vocal-feedback-job/retry-cpu',route=>{state.retries++;state.status='running';return route.fulfill({json:job()});});
 await page.route('**/jobs/vocal-feedback-job/result',route=>route.fulfill({json:{kind:'vocal',analysis_id:'vocal-feedback-result'}}));
 await page.route(`**/projects/${pid}/vocals`,route=>route.fulfill({json:{items:state.status==='succeeded'?[{id:'vocal-feedback-result',status:'ready',source_asset_id:state.resultAsset,audio_id:'audio15',audio_state:'current',segments:[{id:'new15',beginMs:300,endMs:900}]}]:[]}}));
 await page.goto(`/projects/${pid}/edit`);await page.getByRole('button',{name:'音频处理',exact:true}).click();
 if(old)await page.locator('[data-top-menu="audio-analysis"] summary').click();
 await page.getByRole('button',{name:'分离人声',exact:true}).click();
 await expect(page.getByRole('button',{name:'取消任务',exact:true})).toBeVisible();
 return {pid,state};
}
test('vocal running status remains reachable, failures close independently and old timeline stays available',async({page})=>{
 const {state}=await setup(page);
 const running=page.locator('[data-message-bar]').filter({has:page.getByRole('button',{name:'取消任务',exact:true})});
 await expect(running).toContainText('CUDA');await expect(running.getByRole('button',{name:'关闭提示'})).toHaveCount(0);
 await expect(page.locator('[data-segment-id]').first()).toBeVisible();
 await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByRole('button',{name:'取消任务',exact:true}).click();
 await expect(page.getByRole('alert').filter({hasText:'取消测试失败'})).toBeVisible();await expect(running).toBeVisible();
 state.readsFail=true;await expect(page.getByRole('alert').filter({hasText:'读取失败'})).toBeVisible();await expect(running).toBeVisible();state.readsFail=false;
 state.status='failed';await expect(page.getByRole('button',{name:'使用 CPU 重试'})).toBeVisible();
 const failure=page.locator('[data-message-bar]').filter({hasText:'GPU 人声测试失败'});await failure.getByRole('button',{name:'关闭提示'}).click();
 await expect(page.getByRole('button',{name:'使用 CPU 重试'})).toHaveCount(0);
 await page.getByRole('button',{name:'音频处理',exact:true}).click();await expect(page.locator('[data-segment-id]').first()).toBeVisible();
 await page.getByRole('button',{name:'查看最近处理结果'}).click();await failure.getByRole('button',{name:'使用 CPU 重试'}).click();await expect.poll(()=>state.retries).toBe(1);
 await expect(failure).toHaveCount(0);await expect(running).toBeVisible();
});
test('closing success leaves result replacement decisions intact',async({page})=>{
 const {state}=await setup(page);
 await page.locator('[data-segment-id]').first().click({button:'right'});await page.getByRole('menuitem',{name:'删除选中片段'}).click();
 await expect(page.locator('[data-segment-id]')).toHaveCount(1);
 state.status='succeeded';await expect(page.getByRole('button',{name:'替换当前片段'})).toBeVisible();
 await page.locator('[data-message-bar]').filter({hasText:'人声处理完成'}).getByRole('button',{name:'关闭提示'}).click();
 await expect(page.getByRole('button',{name:'替换当前片段'})).toBeVisible();await page.getByRole('button',{name:'返回上次结果'}).click();
 await expect(page.locator('[data-segment-id="old2"]')).toBeVisible();await page.getByRole('button',{name:'查看最近处理结果'}).click();
 await page.getByRole('button',{name:'替换当前片段'}).click();await expect(page.locator('[data-segment-id="new15"]')).toBeVisible();
});
test('no-result state stays actionable and cancellation waits for the terminal status',async({page})=>{
 const {state}=await setup(page,false);state.cancelFails=false;
 await expect(page.getByText('正在处理音频，可在上方查看任务状态。')).toBeVisible();
 await page.getByRole('button',{name:'取消任务',exact:true}).click();await expect(page.getByRole('button',{name:'取消任务',exact:true})).toBeDisabled();
 state.status='cancelled';await expect(page.getByRole('status').filter({hasText:'人声处理已取消'})).toBeVisible();
 await expect(page.getByRole('button',{name:'分离人声',exact:true})).toBeEnabled();await expect(page.getByText('尚无可用片段，请通过音频工具分离人声。')).toBeVisible();
});

test('a stale source result is rejected without replacing existing segments',async({page})=>{
 const {state}=await setup(page);state.resultAsset='other-source';state.status='succeeded';
 await expect(page.getByRole('alert').filter({hasText:'音源已改变'})).toBeVisible();
 await expect(page.locator('[data-segment-id="old1"]')).toBeVisible();await expect(page.locator('[data-segment-id="new15"]')).toHaveCount(0);
});
