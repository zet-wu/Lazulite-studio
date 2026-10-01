import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { importLyrics } from '../fixtures/import-lyrics';
const file=(xml:string)=>({name:'synthetic.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
const issueXml=`<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:studio="urn:lazulite:studio:draft"><head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><transliterations>
<transliteration xml:lang="ja-Latn"><text for="line2"><span studio:id="space" studio:null="begin end">  </span><span studio:id="r1" studio:null="begin end">a</span></text></transliteration>
<transliteration xml:lang="ja-Latn"><text for="line2"><span studio:id="r2" studio:null="end" begin="2">b</span></text></transliteration></transliterations></iTunesMetadata></metadata></head>
<body><p xml:id="line1" begin="0" end="2"><span studio:id="word1" studio:null="begin end">word</span><span ttm:role="x-bg" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" studio:id="bg" studio:null="end" begin="0"><span studio:id="bgword" studio:null="begin end">background</span></span></p><p xml:id="line2" begin="2" end="4"><span begin="2" end="4">正文</span></p></body></tt>`;
test('pure TTML shows every relevant issue; error links select and focus exact track units',async({page})=>{
 await page.goto('/editor');await importLyrics(page,file(issueXml));
 await page.getByRole('button',{name:'文件打包',exact:true}).click();
 await expect(page.getByRole('button',{name:'下载草稿'})).toHaveCount(0);await expect(page.getByRole('button',{name:'最终 TTML'})).toHaveCount(0);
 await page.getByRole('button',{name:'下载歌词',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('有 2 项需要处理');
 const issue=page.getByRole('button',{name:'第 2 行 · ja-Latn 轨道 2 音译第 1 单元：缺少结束时间',exact:true});
 await issue.focus();await page.keyboard.press('Enter');
 await expect(page.locator('main [data-romanization-unit-id="r2"]')).toBeFocused();
 await expect(page.locator('main [data-romanization-unit-id="r2"]')).toHaveClass(/selectedWord/);
 await page.getByRole('button',{name:'文件打包',exact:true}).click();await page.getByLabel('导出格式').selectOption('lrc');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载歌词',exact:true}).click();
 expect(await readFile(await(await download).path(),'utf8')).toContain('word');
});

test('four-source round survives tabs and modes; edits retain results; explicit search starts fresh',async({page})=>{
 await page.goto('/editor');await page.getByRole('button',{name:'歌词获取',exact:true}).waitFor();
 await page.evaluate(()=>{
  const original=window.fetch;const state={searches:[] as string[],checks:[] as string[]};(window as any).probe=state;
  window.fetch=async(input,init)=>{
   const url=String(input),body=JSON.parse(String(init?.body??'{}'));
   if(url.endsWith('/lyric-sources/search')){state.searches.push(body.source+':'+body.query);return Response.json({items:[{source:body.source,id:'1',songmid:'mid',title:body.source+' song',artists:[],album:'',duration_ms:null}]});}
   if(url.endsWith('/lyric-sources/fetch')){state.checks.push(body.source);return Response.json({empty:false,format:'qrc',content:'[1000,500]'+body.source+'(1000,500)',metadata:{},translation:'broken sidecar'});}
   return original(input,init);
  };
 });
 await page.getByRole('button',{name:'歌词获取',exact:true}).click();await page.getByRole('tab',{name:'网易云音乐'}).click();
 await page.getByRole('textbox',{name:'搜索标题'}).fill('Song (Live)!');await page.getByRole('button',{name:'搜索',exact:true}).click();
 await page.getByRole('button',{name:/netease song/}).click();await expect(page.getByText('netease',{exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'QQ 音乐'}).click();await page.getByRole('button',{name:/qqmusic song/}).click();await expect(page.getByText('qqmusic',{exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'酷狗'}).click();await expect(page.getByText('qqmusic',{exact:true})).toHaveCount(0);
 await page.getByRole('tab',{name:'网易云音乐'}).click();await expect(page.getByText('netease',{exact:true})).toBeVisible();
 await expect(page.getByText('附属行出错',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'确认导入并替换歌词'})).toBeEnabled();
 const searches=await page.evaluate(()=>(window as any).probe.searches.length);
 expect(await page.evaluate(()=>new Set((window as any).probe.searches.map((s:string)=>s.split(':')[0])).size)).toBe(4);
 await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByRole('button',{name:'歌词获取',exact:true}).click();
 await expect(page.getByText('netease',{exact:true})).toBeVisible();expect(await page.evaluate(()=>(window as any).probe.searches.length)).toBe(searches);
 await page.getByRole('textbox',{name:'搜索标题'}).fill('Changed');await expect(page.getByText(/当前结果属于上次搜索/)).toBeVisible();await expect(page.getByText('netease',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).probe.searches.length)).toBe(searches);
 await page.getByRole('button',{name:'搜索',exact:true}).click();await expect(page.getByText('netease',{exact:true})).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>(window as any).probe.searches.length)).toBe(searches+4);
 await page.getByRole('button',{name:'搜索',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).probe.searches.length)).toBe(searches+8);
});

for(const width of [1280,1440,1920])for(const theme of ['light','dark'])test(`network long fields badges and errors ${width} ${theme}`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.addInitScript(theme=>localStorage.setItem('lazulite-editor-theme',theme),theme);
 await page.goto('/editor');await page.getByRole('button',{name:'歌词获取',exact:true}).waitFor();
 await page.evaluate(()=>{const original=window.fetch;window.fetch=async(input,init)=>{const url=String(input),body=JSON.parse(String(init?.body??'{}'));if(url.endsWith('/lyric-sources/search'))return Response.json({items:[{source:body.source,id:'1',songmid:'mid',title:'长标题'.repeat(20),artists:['长艺术家'.repeat(12)],album:'长专辑'.repeat(15),duration_ms:120000}]});if(url.endsWith('/lyric-sources/fetch'))return Response.json({empty:false,format:'qrc',content:'[1000,500]正文(1000,500)',metadata:{},translation:'broken'});return original(input,init);};});
 await page.getByRole('button',{name:'歌词获取',exact:true}).click();await page.getByRole('tab',{name:'网易云音乐'}).click();await page.getByRole('textbox',{name:'搜索标题'}).fill('长标题'.repeat(80));await page.getByRole('button',{name:'搜索',exact:true}).click();
 await page.getByRole('button',{name:/长标题长标题/}).click();await expect(page.getByRole('button',{name:'确认导入并替换歌词'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(1);
 await page.screenshot({path:test.info().outputPath(`network-${width}-${theme}.png`)});
});


test('packaging error links focus body, background and 注音 with visible main numbering',async({page})=>{
 await page.goto('/projects/sample-project/edit');
 await page.getByRole('button',{name:'歌词获取',exact:true}).waitFor();
 await page.evaluate(()=>{const original=window.fetch;window.fetch=async(input,init)=>String(input).endsWith('/packaging') ? Response.json({filename:'synthetic.m4a',format_label:'M4A（MP4 容器）',asset_id:'asset-1',container:'mp4',supported:true,tracks:[],error:null}) : original(input,init);});
 const rubyXml=issueXml.replace('<span begin="2" end="4">正文</span>','<span studio:id="rubyword" begin="2" end="4" tts:ruby="container"><span tts:ruby="base">正文</span><span tts:ruby="textContainer"><span studio:id="ruby1" studio:null="begin end" tts:ruby="text">よみ</span></span></span>');
 await importLyrics(page,file(rubyXml));
 const targets=[
  ['第 1 行第 1 词：缺少开始和结束时间','[data-word-id="word1"]'],
  ['第 1 行 · 背景：缺少结束时间','[data-line-id="bg"]'],
  ['第 1 行 · 背景第 1 词：缺少开始和结束时间','[data-word-id="bgword"]'],
  ['第 2 行第 1 词第 1 读音单元：缺少开始和结束时间','[data-ruby-id="ruby1"]'],
 ];
 for(const [name,selector] of targets){
  await page.getByRole('button',{name:'文件打包',exact:true}).click();
  await page.getByRole('button',{name:'保存并打包',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('有 6 项需要处理');
  const link=page.getByRole('button',{name,exact:true});await link.focus();await page.keyboard.press('Enter');
  await expect(page.locator('main '+selector)).toBeFocused();
 }
});

test('output issue mounts a distant virtual row and transfers keyboard focus',async({page})=>{
 await page.goto('/editor');
 const lines=Array.from({length:82},(_,i)=>`<p xml:id="virtual${i}" begin="${i*2}" ${i===81 ? 'studio:null="end"' : `end="${i*2+1}"`}><span begin="${i*2}" end="${i*2+1}">word${i}</span></p>`).join('');
 await importLyrics(page,file(`<tt xmlns="http://www.w3.org/ns/ttml" xmlns:studio="urn:lazulite:studio:draft"><body>${lines}</body></tt>`));
 await page.getByRole('button',{name:'文件打包',exact:true}).click();await page.getByLabel('导出格式').selectOption('qrc');await page.getByRole('button',{name:'下载歌词',exact:true}).click();
 const link=page.getByRole('button',{name:'第 82 行：缺少结束时间',exact:true});await link.focus();await page.keyboard.press('Enter');
 const row=page.locator('main [data-line-id="virtual81"]');await expect(row).toBeFocused();await expect(row).toBeInViewport();
});
