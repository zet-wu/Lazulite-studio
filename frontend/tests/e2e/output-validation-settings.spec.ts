import { expect, test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { importLyrics } from '../fixtures/import-lyrics';
const xml=readFileSync('../tests/fixtures/ttml/amll-rich.ttml','utf8');
async function settings(page:Page) {
 await page.locator('[data-top-menu=settings] > summary').click();
 await expect(page.getByRole('switch',{name:'禁用词级歌手',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'AMLL 兼容设置',exact:true}).click();
 return page.getByRole('dialog',{name:'AMLL 兼容设置',exact:true});
}
async function load(page:Page) {
 await page.goto('/projects/sample-project/edit?scenario=no-music');const dialog=await settings(page);
 await dialog.getByRole('switch',{name:'禁用多行背景',exact:true}).uncheck();await dialog.getByRole('switch',{name:'禁用词级歌手',exact:true}).uncheck();await dialog.getByRole('button',{name:'关闭',exact:true}).click();
 await importLyrics(page,{name:'rich.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
}
test('settings dialog restores visible focus and navigates to the requested rule; tabs remember selection',async({page})=>{
 await load(page);await expect(page.locator('[data-top-menu=settings]')).not.toHaveAttribute('open');
 let dialog=await settings(page);await dialog.getByRole('button',{name:'关闭',exact:true}).click();
 await expect(page.locator('[data-top-menu=settings] > summary')).toBeFocused();
 dialog=await settings(page);await dialog.getByRole('switch',{name:'禁用多行背景',exact:true}).locator('..').locator('..').getByRole('button',{name:'定位兼容问题'}).click();
 await expect(dialog).toHaveCount(0);await expect(page.getByRole('tab',{name:'AMLL 兼容校验',exact:true})).toHaveAttribute('aria-selected','true');
 const target=page.locator('#amll-noMultipleBackgrounds > div > button[aria-expanded]');await expect(target).toHaveAttribute('aria-expanded','true');await expect(target).toBeFocused();
 await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByRole('button',{name:'文件打包',exact:true}).click();
 await expect(page.getByRole('tab',{name:'AMLL 兼容校验',exact:true})).toHaveAttribute('aria-selected','true');await expect(target).toHaveAttribute('aria-expanded','false');
 await page.getByRole('tab',{name:'AMLL 兼容校验',exact:true}).focus();await page.keyboard.press('ArrowLeft');
 await expect(page.getByRole('tab',{name:'歌词校验',exact:true})).toBeFocused();await expect(page.locator('#amll-noChorus')).toHaveCount(0);
 await page.keyboard.press('End');await expect(page.getByRole('tab',{name:'AMLL 兼容校验',exact:true})).toBeFocused();await expect(target).toBeVisible();
});
test('automatic refresh retains open rules and selected scope through undo and redo',async({page})=>{
 await load(page);await page.getByRole('button',{name:'文件打包',exact:true}).click();await expect(page.getByRole('tab',{name:'歌词校验',exact:true})).toHaveAttribute('aria-selected','true');
 await page.getByRole('tab',{name:'AMLL 兼容校验',exact:true}).click();const rule=page.locator('#amll-noWordAgents');
 await rule.locator('button[aria-expanded]').click();await rule.getByRole('button',{name:/^第 1 行/}).first().click();await rule.getByRole('checkbox').first().check();
 await rule.getByRole('button',{name:/^清除词级歌手/}).click();await expect(rule.getByText('范围：原选中问题已消失')).toBeVisible();await expect(rule.getByRole('button',{name:/处理选中 0 项/})).toBeDisabled();
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(rule.getByRole('button',{name:/^第 1 行/}).first()).toHaveAttribute('aria-expanded','false');
 await rule.getByRole('button',{name:/^第 1 行/}).first().click();await expect(rule.getByRole('checkbox').first()).toBeVisible();
 await page.getByRole('button',{name:'重做',exact:true}).click();await expect(rule.getByText('范围：原选中问题已消失')).toBeVisible();

});
test('embedded candidates share parsed badges, selection and full-width cards; errors stay explicit',async({page})=>{
 await page.goto('/projects/sample-project/edit');
 await expect(page.getByRole('button',{name:'编辑',exact:true})).toBeVisible();
 await page.evaluate(()=>{const original=window.fetch;window.fetch=(...args)=>String(args[0]).endsWith('/embedded-lyrics')?Promise.resolve(Response.json({asset_id:'sample-asset',candidates:[
  {id:'line',label:'STPP · 轨道 2 · jpn',format:'ttml',content:'<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="1" end="2">line only</p></body></tt>'},
  {id:'plain',label:'USLT · eng · alternate',format:'txt',content:'plain candidate'},
  {id:'bad',label:'结构错误',error:'不支持的 STPP 结构'},
  {id:'parse',label:'正文错误',format:'ttml',content:'broken'},
 ]})):original(...args);});
 await page.getByRole('button',{name:'歌词获取',exact:true}).click();await page.getByRole('tab',{name:'内嵌',exact:true}).click();
 const list=page.getByLabel('内嵌候选');const first=list.getByRole('button',{name:/^STPP/});await expect(first).toContainText('TTML');await expect(first).toContainText('逐行');
 await first.click();await expect(first).toHaveAttribute('aria-pressed','true');const second=list.getByRole('button',{name:/USLT/});await second.click();await expect(first).toHaveAttribute('aria-pressed','false');await expect(second).toContainText('无时间');
 await expect(list.getByRole('button',{name:/正文错误/})).toBeDisabled();await expect(list).toContainText('正文解析失败');
 await page.getByRole('button',{name:'确认导入并替换歌词',exact:true}).click();await expect(page.getByRole('textbox',{name:'词 plain candidate',exact:true})).toBeVisible();await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.getByRole('textbox',{name:'词 plain candidate',exact:true})).toHaveCount(0);
});
test('large document measures computation separately from automatic entry and interaction',async({page})=>{
 test.setTimeout(60000);await page.goto('/projects/sample-project/edit?scenario=no-music');
 const words=Array.from({length:2000},(_,i)=>`<span>word${i}</span>`).join('');const content=`<tt xmlns="http://www.w3.org/ns/ttml"><body><p xml:id="large">${words}</p></body></tt>`;
 await importLyrics(page,{name:'large.ttml',mimeType:'application/xml',buffer:Buffer.from(content)});
 const computation=await page.evaluate(async(content)=>{
   const {importLyricFile}=await import(/* @vite-ignore */ '/src/adapters/'+'lyric-formats.ts');const {validateLyrics,validateLyricsIncrementally}=await import(/* @vite-ignore */ '/src/adapters/'+'lyric-validation.ts');const {checkAmll}=await import(/* @vite-ignore */ '/src/domain/'+'amll-compatibility.ts');
   const doc=importLyricFile(content,'ttml');const measures=[];
   for(let i=0;i<3;i++){const start=performance.now();const issues=validateLyrics(doc);const middle=performance.now();checkAmll(doc);measures.push({lyricsMs:middle-start,amllMs:performance.now()-middle,issues:issues.length});}const {createProjectEditing}=await import(/* @vite-ignore */ '/src/domain/'+'project-editing.ts');
   const gaps:number[]=[];let last=performance.now();const timer=setInterval(()=>{const now=performance.now();gaps.push(now-last);last=now;},1);
   const start=performance.now();const result=await validateLyricsIncrementally(doc,createProjectEditing(),new AbortController().signal);const totalMs=performance.now()-start;clearInterval(timer);
   const {createLyricDocument,createLine,createWord}=await import(/* @vite-ignore */ '/src/domain/'+'lyric-document.ts');
   const valid=createLyricDocument();valid.lines=Array.from({length:200},(_,row)=>({...createLine(''),beginMs:row*10000,endMs:(row+1)*10000,
     words:Array.from({length:10},(_,col)=>({...createWord('word'),beginMs:row*10000+col*1000,endMs:row*10000+(col+1)*1000}))}));
   const validStart=performance.now();const validIssues=validateLyrics(valid);const validSyncMs=performance.now()-validStart;
   const validGaps:number[]=[];last=performance.now();const validTimer=setInterval(()=>{const now=performance.now();validGaps.push(now-last);last=now;},1);
   const validIncrementalStart=performance.now();await validateLyricsIncrementally(valid,createProjectEditing(),new AbortController().signal);const validIncrementalMs=performance.now()-validIncrementalStart;clearInterval(validTimer);
   return {synchronous:measures,incremental:{totalMs,maxTimerGapMs:Math.max(...gaps),issues:result.length},valid:{lines:200,words:2000,issues:validIssues.length,syncMs:validSyncMs,incrementalMs:validIncrementalMs,maxTimerGapMs:Math.max(...validGaps)}};
 },content);
 const enterStart=Date.now();await page.getByRole('button',{name:'文件打包',exact:true}).click();await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-busy','false');const entryMs=Date.now()-enterStart;
 const rule=page.getByRole('button',{name:/^缺少时间/});await rule.click();const expandStart=Date.now();await page.getByRole('button',{name:/^第 1 行/}).click();await expect(page.getByRole('tabpanel').locator('li')).toHaveCount(50);const expansionMs=Date.now()-expandStart;
 const switchStart=Date.now();await page.getByRole('tab',{name:'AMLL 兼容校验',exact:true}).click();await expect(page.locator('#amll-noWordAgents')).toBeVisible();const switchMs=Date.now()-switchStart;
 const updateStart=Date.now();await page.getByRole('button',{name:'撤销',exact:true}).click();await page.getByRole('button',{name:'重做',exact:true}).click();await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-busy','false');const updateMs=Date.now()-updateStart;
 writeFileSync(test.info().outputPath('performance.json'),JSON.stringify({computation,entryMs,expansionMs,switchMs,updateMs},null,2));
});

test('music packaging checks current data and blocks invalid output',async({page})=>{
 await page.goto('/projects/sample-project/edit');await expect(page.getByRole('button',{name:'编辑',exact:true})).toBeVisible();
 await page.evaluate(()=>{const original=window.fetch;window.fetch=(...args)=>String(args[0]).endsWith('/packaging')?Promise.resolve(Response.json({filename:'source.mp3',format_label:'MP3',asset_id:'sample-asset',supported:true,container:'mp3',tracks:[],error:null})):original(...args);});
 await importLyrics(page,{name:'untimed.txt',mimeType:'text/plain',buffer:Buffer.from('untimed')});await page.getByRole('button',{name:'文件打包',exact:true}).click();
 await page.getByRole('button',{name:'打包文件',exact:true}).click();await expect(page.locator('[data-blocking=true]')).not.toHaveCount(0);
});
