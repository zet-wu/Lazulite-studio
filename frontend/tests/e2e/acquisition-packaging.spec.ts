import { expect, test } from '@playwright/test';
import { importLyrics } from '../fixtures/import-lyrics';
const xml = (word: string, metadata: string) => `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:amll="http://www.example.com/ns/amll"><head><metadata>${metadata}</metadata></head><body><p begin="1" end="3"><span begin="1" end="2">${word}</span></p></body></tt>`;
const meta = (key: string, value: string) => `<amll:meta key="${key}" value="${value}"/>`;
const source = xml('原文',meta('artists',' A ')+meta('artists','B')+meta('album','保留'));
const incoming = xml('新词',meta('artists','C')+meta('musicName','新歌'));
const file = (buffer: string) => ({ name:'synthetic.ttml',mimeType:'application/xml',buffer:Buffer.from(buffer) });

test('preview is read-only; metadata selection and body replacement undo together',async ({page})=>{
 await page.goto('/projects/sample-project/edit?scenario=no-music'); await importLyrics(page,file(source));
 await page.getByRole('button',{name:'歌词获取',exact:true}).click();
 await page.locator('input[type=file]').setInputFiles(file(incoming));
 await expect(page.getByRole('button',{name:'artist 原值',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'artist 待导入值',exact:true}).click();
 await page.getByRole('button',{name:'album 待导入值',exact:true}).focus(); await page.keyboard.press('Space');
 await page.getByRole('button',{name:'确认导入并替换歌词'}).click();
 await expect(page.getByRole('textbox',{name:'词 新词',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'撤销',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'词 原文',exact:true})).toBeVisible();
 for(const mode of ['歌词获取','文件打包','预览','打轴','编辑']) await page.getByRole('button',{name:mode,exact:true}).click();
 await expect(page.getByRole('textbox',{name:'词 原文',exact:true})).toBeVisible();
 await expect(page.locator('[data-top-menu="file"]')).toHaveCount(0);
});

test('stale candidate response never replaces a newer selection and ID association is independent',async ({page})=>{
 await page.goto('/projects/sample-project/edit?scenario=no-music');
 await page.getByRole('button',{name:'歌词获取',exact:true}).waitFor();
 await page.evaluate(() => {
   const original = window.fetch;
   window.fetch = async (input, init) => {
     const url = String(input), body = JSON.parse(String(init?.body ?? '{}'));
     if (url.endsWith('/lyric-sources/search')) return Response.json({items:['1','2'].map(id=>({source:'netease',id,title:`候选${id}`,artists:[],album:'',duration_ms:1000}))});
     if (url.endsWith('/lyric-sources/fetch')) {
       if (body.id === '1') await new Promise<void>(resolve => { (window as unknown as {release:()=>void}).release=resolve; });
       return Response.json({empty:false,format:'lrc',content:`[00:01]歌词${body.id}`,metadata:{ncmMusicId:[body.id]}});
     }
     return original(input,init);
   };
 });
 await page.getByRole('button',{name:'歌词获取',exact:true}).click();await page.getByRole('tab',{name:'网易云音乐'}).click();
 await page.getByRole('textbox',{name:'搜索标题'}).fill('synthetic');await page.getByRole('button',{name:'搜索',exact:true}).click();
 await page.getByRole('button',{name:/候选1/}).click();await page.getByRole('button',{name:/候选2/}).click();
 await expect(page.getByText('歌词2',{exact:true})).toBeVisible();await page.evaluate(()=>(window as unknown as {release:()=>void}).release());await expect(page.getByText('歌词1',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'仅关联歌曲 ID'}).click();await expect(page.getByText('歌曲 ID 已关联，可撤销')).toBeVisible();
 await page.getByRole('button',{name:'仅关联歌曲 ID'}).click();await expect(page.getByText('此歌曲 ID 已关联')).toBeVisible();
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.getByRole('button',{name:'撤销',exact:true})).toBeDisabled();
});

for(const width of [1280,1440,1920])for(const theme of ['light','dark'])test(`acquisition layout ${width} ${theme}`,async ({page})=>{
 await page.setViewportSize({width,height:900});await page.addInitScript(theme=>localStorage.setItem('lazulite-editor-theme',theme),theme);
 await page.goto('/projects/sample-project/edit?scenario=no-music');await importLyrics(page,file(source));await page.getByRole('button',{name:'歌词获取',exact:true}).click();await page.locator('input[type=file]').setInputFiles(file(incoming));
 await expect(page.getByRole('button',{name:'确认导入并替换歌词'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(1);
 await page.screenshot({path:test.info().outputPath(`acquisition-${width}-${theme}.png`)});
});

test('binary KRC file is decoded locally and previews before one import transaction',async ({page})=>{
 const {deflateSync}=await import('node:zlib');
 const key=[64,71,97,119,94,50,116,71,81,54,49,45,206,210,110,105];
 const compressed=deflateSync(Buffer.from('[1000,2000]<0,1000,0>本地<1000,1000,0>歌词'));
 const bytes=Buffer.concat([Buffer.from('krc1'),compressed.map((v,i)=>v^key[i%16])]);
 await page.goto('/projects/sample-project/edit?scenario=no-music');
 await page.getByRole('button',{name:'歌词获取',exact:true}).click();
 await page.locator('input[type=file]').setInputFiles({name:'synthetic.krc',mimeType:'application/octet-stream',buffer:bytes});
 await expect(page.getByText('本地歌词',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'撤销',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'确认导入并替换歌词'}).click();
 await expect(page.getByRole('textbox',{name:'词 本地',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'撤销',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'词 本地',exact:true})).toHaveCount(0);
});
