import { expect, test } from '@playwright/test';
import { importLyrics } from '../fixtures/import-lyrics';
for(const theme of ['light','dark']) test(`mixed ruby preview aligns bases and keeps states unwrapped in ${theme}`,async({page})=>{
 await page.addInitScript(theme=>{
  localStorage.setItem('lazulite-editor-theme',theme);
  const original=window.fetch;
  window.fetch=async(input,init)=>{
   if(String(input).endsWith('/reading/analyze')){
    const {lines}=JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ranges:lines.flatMap((line:{id:string})=>[
     {line_id:line.id,base:'坂',base_start:0,base_end:1,reading:'さか'},
     {line_id:line.id,base:'道',base_start:1,base_end:2,reading:'みち'},
     {line_id:line.id,base:'今日',base_start:3,base_end:5,reading:'きょう'}])}));
   }
   return original(input,init);
  };
 },theme);
 await page.goto('/projects/sample-project/edit?scenario=no-music');
 const xml='<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling"><body><p begin="0" end="6"><span begin="0" end="2">坂道</span><span begin="2" end="3">を</span><span begin="3" end="4">今</span><span begin="4" end="5">日</span><span begin="5" end="6" tts:ruby="container"><span tts:ruby="base">魂</span><span tts:ruby="textContainer"><span tts:ruby="text" begin="5" end="6">たましい</span></span></span></p></body></tt>';
 await importLyrics(page,{name:'phase15.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
 await page.locator('[data-outline-drag]').first().click({button:'right'});await page.getByRole('menuitem',{name:'生成日文注音…',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'生成日文注音',exact:true});
 await expect(dialog.getByLabel('坂完整读音')).toHaveValue('さか');await expect(dialog.getByLabel('道完整读音')).toHaveValue('みち');
 await expect(dialog.getByRole('checkbox')).not.toBeChecked();await dialog.getByRole('checkbox').check();
 await expect(dialog.getByLabel('今日完整读音')).toHaveValue('きょう');
 for(const width of [1440,900]){
  await page.setViewportSize({width,height:900});
  await expect.poll(()=>dialog.locator('[data-reading-body]').evaluateAll(nodes=>Math.max(...nodes.map(n=>n.getBoundingClientRect().bottom))-Math.min(...nodes.map(n=>n.getBoundingClientRect().bottom)))).toBeLessThan(2);
  for(const status of await dialog.locator('[data-reading-status]').all()){
   const check=await status.evaluate(node=>{const style=getComputedStyle(node);return {color:style.color,expected:getComputedStyle(document.documentElement).getPropertyValue('--muted').trim(),whiteSpace:style.whiteSpace,height:node.getBoundingClientRect().height,lineHeight:parseFloat(style.lineHeight)};});
   expect(check.whiteSpace).toBe('nowrap');expect(check.height).toBeLessThan(25);
   expect(await status.evaluate(node=>{const probe=document.createElement('span');probe.style.color='var(--muted)';node.append(probe);const matches=getComputedStyle(probe).color===getComputedStyle(node).color;probe.remove();return matches;})).toBe(true);
  }
 }
 await page.screenshot({path:test.info().outputPath(`phase15-ruby-${theme}.png`)});
 await dialog.getByRole('button',{name:'应用',exact:true}).click();
 await expect(page.getByLabel('词 今日',{exact:true})).toHaveCount(1);await expect(page.getByLabel('词 坂',{exact:true})).toHaveCount(1);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.getByLabel('词 坂道',{exact:true})).toHaveCount(1);await expect(page.getByLabel('词 今',{exact:true})).toHaveCount(1);
});
for(const target of ['windows-x64-cpu','windows-x64-cuda','macos-arm64'])test(`settings menu exposes devices without leaving editor: ${target}`,async({page})=>{
 await page.addInitScript(target=>{
  const original=window.fetch;
  window.fetch=async(input,init)=>{
   if(String(input).endsWith('/session'))return new Response(JSON.stringify({schema_version:'studio-session-v1',authenticated:true,mode:'local',user:null}));
   if(String(input).endsWith('/runtime'))return new Response(JSON.stringify({target}));
   return original(input,init);
  };
 },target);
 await page.goto('/projects/sample-project/edit?scenario=no-music');
 for(const width of [1440,900])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:900});await page.evaluate(({theme,zoom})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.zoom=zoom;},{theme,zoom:width===900?'1.25':'1'});
  const summary=page.locator('[data-top-menu="settings"] summary');await summary.click();
  const label=page.getByRole('button',{name:'音译生成假名高亮',exact:true});
  const bounds=await label.boundingBox();expect(bounds!.height).toBeLessThan(width===900?50:40);expect(bounds!.x).toBeGreaterThan(0);expect(bounds!.x+bounds!.width).toBeLessThan(width);
  await page.getByRole('button',{name:'计算设备…',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'计算设备',exact:true});await expect(dialog).toBeVisible();
  const vocal=dialog.getByLabel('人声分离计算设备');
  if(target==='windows-x64-cpu'){await expect(vocal).toBeDisabled();await expect(vocal.locator('option')).toHaveText(['CPU']);}
  else {await expect(vocal.locator('option')).toHaveText(['自动','CPU']);}
  await dialog.getByRole('button',{name:'关闭计算设备',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(summary).toBeFocused();
  await expect(page).toHaveURL(/\/edit/);
 }
});
