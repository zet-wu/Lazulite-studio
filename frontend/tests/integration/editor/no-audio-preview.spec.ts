import {expect,test} from '@playwright/test';
test('empty, untimed and timed lyrics retain the correct no-audio preview and validation behavior',async({page})=>{
 const headers={origin:'http://127.0.0.1:5175'};
 const pid=(await(await page.request.post('/api/v1/projects',{headers,data:{name:'Preview without audio'}})).json()).id;
 const url=`/api/v1/projects/${pid}/document`;
 for(const state of ['empty','untimed','timed']){
  const before=await(await page.request.get(url)).json();
  const body=state==='empty'?'':state==='untimed'?'<p xml:id="a">lyrics</p>':'<p xml:id="a" begin="0s" end="2s"><span begin="0s" end="2s">lyrics</span></p>';
  expect((await page.request.put(url,{headers:{...headers,'if-match':before.revision},data:{...before,document:{...before.document,lyrics:{draftTtml:`<tt xmlns="http://www.w3.org/ns/ttml"><body>${body}</body></tt>`}}}})).ok()).toBeTruthy();
  await page.goto(`/projects/${pid}/edit`);
  await page.getByRole('button',{name:'AMLL 预览',exact:true}).click();
  const slider=page.getByRole('slider',{name:'预览位置'});
  if(state==='timed'){await expect(slider).toBeEnabled();await slider.fill('1000');await expect(slider).toHaveValue('1000');}
  else await expect(slider).toBeDisabled();
  if(state==='empty')await expect(page.getByText('暂无歌词可预览')).toBeVisible();
  await page.getByRole('button',{name:'文件打包',exact:true}).click();
  if(state==='empty')await expect(page.getByText('暂无歌词可校验')).toBeVisible();
  else await expect(page.getByText('暂无歌词可校验')).toHaveCount(0);
  if(state==='timed'){const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载歌词',exact:true}).click();expect((await download).suggestedFilename()).toMatch(/\.ttml$/);}
 }
});
