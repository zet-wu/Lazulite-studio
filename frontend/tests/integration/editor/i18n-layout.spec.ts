import {expect,test} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {chooseLanguage} from '../../fixtures/language';

test('records desktop modes across languages, themes, audio and lyric states',async({page},info)=>{
 test.skip(!process.env.STUDIO_LAYOUT_EVIDENCE, 'Explicit screenshot evidence capture');
 test.setTimeout(240_000);
 await page.setViewportSize({width:1440,height:1000});
 const headers={origin:'http://127.0.0.1:5175'},errors:string[]=[],report:unknown[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 for(const audio of [false,true])for(const lyrics of [false,true]){
  const pid=(await(await page.request.post('/api/v1/projects',{headers,data:{name:`Layout ${audio} ${lyrics}`}})).json()).id;
  const url=`/api/v1/projects/${pid}`;
  const before=await(await page.request.get(url+'/document')).json();
  if(lyrics){
   const xml='<tt xmlns="http://www.w3.org/ns/ttml"><body><p xml:id="line" begin="0s" end="1.5s"><span begin="0s" end="1.5s">歌词 Lyrics 歌詞</span></p></body></tt>';
   expect((await page.request.put(url+'/document',{headers:{...headers,'if-match':before.revision},data:{...before,document:{...before.document,lyrics:{draftTtml:xml}}}})).ok()).toBeTruthy();
  }
  await page.goto(`/projects/${pid}/edit`);
  await expect(page.locator('nav[aria-label] button[aria-current]')).toBeVisible();
  if(audio){
   const source=await page.request.get('/api/v1/projects/media-offset/audio');
   await page.getByLabel('导入音频文件').setInputFiles({name:'layout.wav',mimeType:'audio/wav',buffer:await source.body()});
   await expect.poll(async()=>((await(await page.request.get(url)).json()).asset?.id)).toBeTruthy();
  }
  for(const language of ['zh-Hans','zh-Hant','en']){
   await chooseLanguage(page,language);
   for(const theme of ['light','dark']){
    if(await page.locator('html').getAttribute('data-theme')!==theme){
     await page.locator('[data-top-menu="view"] summary').click();
     await page.locator('[data-top-menu="view"] button').last().click();
    }
    for(let mode=0;mode<7;mode++){
     if(process.env.STUDIO_COMPACT_EVIDENCE && mode!==1 && mode!==5)continue;
     const nav=page.locator('nav[aria-label]').filter({has:page.locator('button[aria-current]')});
     await nav.getByRole('button').nth(mode).click();
     await expect(page.locator('header')).toBeVisible();
     if(mode===5)await expect(page.locator('[class*=previewSettings]')).toBeVisible();
     if(mode===6)await expect(page.locator('[role=tabpanel][aria-busy=false]')).toBeVisible();
     await page.waitForTimeout(150);
     const name=`${audio?'audio':'silent'}-${lyrics?'lyrics':'empty'}-${language}-${theme}-${mode}`;
     await page.screenshot({path:info.outputPath(name+'.png')});
     const geometry=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,width:innerWidth,header:document.querySelector('header')?.getBoundingClientRect().toJSON(),toolbars:[...document.querySelectorAll('[class*="ribbon"],[class*="previewSettings"]')].filter(x=>x.getClientRects().length).map(x=>({text:x.textContent,rect:x.getBoundingClientRect().toJSON()}))}));
     report.push({name,geometry});
     if(mode===1||mode===5){
      await page.setViewportSize({width:1152,height:800});
      await page.screenshot({path:info.outputPath(name+'-viewport1152.png')});
      await page.setViewportSize({width:1440,height:1000});
     }
    }
   }
  }
  await chooseLanguage(page,'zh-Hans');
 }
 await writeFile(info.outputPath('layout-report.json'),JSON.stringify({errors,report},null,2));
 expect(errors).toEqual([]);
});
