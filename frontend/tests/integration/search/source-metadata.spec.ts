import { expect,test } from '@playwright/test';
function wav(){const data=Buffer.alloc(44+16000*2);data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(16000,24);data.writeUInt32LE(32000,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(32000,40);return data;}
test('fills metadata after later audio upload in one save, preserves results, supports click and Enter search',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await page.goto('/projects');await page.getByRole('button',{name:'新建项目',exact:true}).click();await page.getByLabel('项目名称',{exact:true}).fill('Source metadata');await page.getByRole('button',{name:'创建项目',exact:true}).click();await page.waitForURL(/\/projects\/[^/]+\/edit/);
 const id=page.url().split('/projects/')[1].split('/')[0];await page.getByRole('button',{name:'歌词获取',exact:true}).click();await page.getByRole('tab',{name:'网易云音乐'}).click();const fill=page.getByRole('button',{name:'填入歌曲元数据'});await expect(fill).toBeDisabled();
 await page.getByLabel('搜索标题',{exact:true}).fill('手工条件');await page.getByLabel('搜索艺术家',{exact:true}).fill('旧艺术家');await page.getByLabel('搜索专辑',{exact:true}).fill('旧专辑');
 await page.getByLabel('上传音乐文件',{exact:true}).setInputFiles({name:'源歌曲.wav',mimeType:'audio/wav',buffer:wav()});await expect(fill).toBeEnabled({timeout:20000});await expect(page.getByLabel('搜索标题',{exact:true})).toHaveValue('手工条件');
 const saves:string[]=[];let searches=0;page.on('request',r=>{if(r.url().endsWith('/search-conditions')&&r.method()==='PUT')saves.push(r.postData()!);if(r.url().includes('/lyric-sources/')&&r.url().includes('/search'))searches++;});
 const before=await(await page.request.get(`/api/v1/projects/${id}/document`)).json();await fill.click();await expect(page.getByLabel('搜索标题',{exact:true})).toHaveValue('源歌曲');await expect(page.getByLabel('搜索艺术家',{exact:true})).toHaveValue('');await expect(page.getByLabel('搜索专辑',{exact:true})).toHaveValue('');await expect.poll(()=>saves.length).toBe(1);expect(searches).toBe(0);
 expect((await(await page.request.get(`/api/v1/projects/${id}/document`)).json()).document).toEqual(before.document);
 await expect(page.getByRole('button',{name:'搜索',exact:true})).toHaveAttribute('type','submit');
 // Search requests use a local fixture so this verifies submission without external providers.
 let submitted=0;await page.route('**/lyric-sources/search',route=>{submitted++;return route.fulfill({json:{items:[],next_cursor:null}});});
 await page.getByRole('button',{name:'搜索',exact:true}).click();await expect.poll(()=>submitted).toBeGreaterThan(0);const previous=submitted;await page.getByLabel('搜索标题',{exact:true}).fill('Enter 搜索');await page.getByLabel('搜索标题',{exact:true}).press('Enter');await expect.poll(()=>submitted).toBeGreaterThan(previous);
});
