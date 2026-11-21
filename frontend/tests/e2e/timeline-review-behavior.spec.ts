import {writeFile} from 'node:fs/promises';
import {expect,test,type Page} from '@playwright/test';
import {loadTimeline} from '../fixtures/timeline-setup';
import {importLyrics} from '../fixtures/import-lyrics';
async function preference(page:Page,key:string,value:string){await page.evaluate(async({key,value})=>{const path='/src/adapters/preferences.ts';const {savePreference}=await import(path);await savePreference(key,value);},{key,value});}
async function load(page:Page,audio=true){
 await page.setViewportSize({width:1440,height:1050});await loadTimeline(page,audio);
 await page.getByRole('button',{name:'编辑',exact:true}).click();
 const xml=await page.evaluate(async()=>{
  const dp='/src/domain/lyric-document.ts',cp='/src/adapters/ttml/lyric-codec.ts';const d=await import(dp),c=await import(cp);const doc=d.createLyricDocument('');
  doc.lines=Array.from({length:4},(_,i)=>{const line=d.createLine('歌',`row-${i}`);line.beginMs=1000+i*3000;line.endMs=3500+i*3000;line.words[0].id=`word-${i}`;line.words[0].beginMs=line.beginMs;line.words[0].endMs=line.endMs;line.words[0].rubyUnits=[{id:`ruby-${i}`,reading:'うた',beginMs:line.beginMs,endMs:line.endMs}];return line;});
  const bg=d.createLine('声','bg');bg.backgroundOf='row-0';bg.beginMs=1500;bg.endMs=4500;bg.words[0].id='bg-word';bg.words[0].beginMs=1500;bg.words[0].endMs=4500;doc.lines.splice(1,0,bg);
  doc.romanizationTracks=[{id:'roman',language:'ja-Latn',contents:[{id:'roman-content',lineId:'row-0',kind:'timed',units:[{id:'roman-unit',text:'uta',beginMs:1000,endMs:3500}]}]}];
  doc.translationTracks=[{id:'translation',language:'en',purpose:'subtitle',contents:[{id:'translation-content',lineId:'row-0',kind:'timed',units:[{id:'translation-unit',text:'song',beginMs:1000,endMs:3500}]}]}];
  return c.serializeLyricTtml(doc,{draft:true});
 });
 await importLyrics(page,{name:'timeline-review.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
 await page.locator('[data-outline-drag]').first().click();
 if(audio)await page.getByRole('button',{name:'音频处理',exact:true}).click();
}
const item=(page:Page,id:string)=>page.locator(`[data-timeline-key="${id}"]`);
const stage=(page:Page,id:string)=>page.locator(`[data-staging-key="${id}"]`);
async function bounds(page:Page){const text=await page.locator('span').filter({hasText:/^视窗\s*\d/}).first().textContent();return text!.match(/\d+:\d+\.\d+/g)!.map(value=>{const [m,s]=value.split(':').map(Number);return m*60+s;});}
async function dragIntoStaging(page:Page,id:string,cancel?:'Escape'|'capture'|'outside'){
 const source=item(page,id);await source.scrollIntoViewIfNeeded();const from=(await source.boundingBox())!;
 const drop=page.locator('[data-staging-drop]');await drop.scrollIntoViewIfNeeded();const to=(await drop.boundingBox())!;
 await page.mouse.move(from.x+from.width*.5,from.y+from.height*.5);await page.mouse.down();await page.mouse.move(to.x+to.width*.65,to.y+to.height*.6,{steps:8});
 await expect(drop).toHaveAttribute('data-clearing','true');await expect(drop).toContainText('清空时间');
 if(cancel==='Escape')await page.keyboard.press('Escape');
 if(cancel==='capture')await source.evaluate(e=>{for(let id=1;id<10;id++)if(e.hasPointerCapture(id))e.releasePointerCapture(id);});
 if(cancel==='outside')await page.mouse.move(10,10,{steps:3});
 await page.mouse.up();
}
test('follow wheel and buttons anchor the real paused playhead and preserve playback and lyrics',async({page})=>{
 await load(page);const follow=page.getByRole('checkbox',{name:'播放跟随',exact:true});await follow.check();
 const audio=page.locator('audio'),before=await item(page,'row-0').getAttribute('aria-label');
 await audio.evaluate((a:HTMLAudioElement)=>{a.currentTime=5;});await expect(page.getByRole('slider',{name:'波形进度'})).toHaveAttribute('aria-valuenow','5');
 await page.getByRole('button',{name:'放大波形',exact:true}).click();let [a,b]=await bounds(page);expect(Math.abs(a- (5-(b-a)*.35))).toBeLessThan(.003);await expect(follow).toBeChecked();
 const plot=page.getByRole('slider',{name:'波形进度'}),box=(await plot.boundingBox())!;await plot.dispatchEvent('wheel',{deltaY:-100,clientX:box.x+box.width*.8});[a,b]=await bounds(page);expect(Math.abs(a-(5-(b-a)*.35))).toBeLessThan(.003);await expect(follow).toBeChecked();
 await preference(page,'studio:timeline-swap-wheel','true');await plot.dispatchEvent('wheel',{deltaY:-100,shiftKey:true,clientX:box.x+box.width*.2});[a,b]=await bounds(page);expect(Math.abs(a-(5-(b-a)*.35))).toBeLessThan(.003);
 expect(await audio.evaluate((a:HTMLAudioElement)=>a.currentTime)).toBe(5);expect(await audio.evaluate((a:HTMLAudioElement)=>a.paused)).toBe(true);await expect(item(page,'row-0')).toHaveAttribute('aria-label',before!);
 for(const time of [0,119]){await audio.evaluate((a:HTMLAudioElement,time)=>{a.currentTime=time;},time);await page.getByRole('button',{name:'缩小波形',exact:true}).click();[a,b]=await bounds(page);expect(time===0?a:120-b).toBeLessThan(.002);await expect(follow).toBeChecked();}
 await page.getByRole('button',{name:'全曲',exact:true}).click();await expect(follow).not.toBeChecked();
});
test('paused active overlaps expand independently, manual rows and selection remain',async({page})=>{
 await load(page);const follow=page.getByRole('checkbox',{name:'播放跟随',exact:true});await follow.check();
 await page.locator('audio').evaluate((a:HTMLAudioElement)=>{a.currentTime=4.2;});await expect(page.locator('[data-expanded-line="row-1"]')).toBeVisible();await expect(page.locator('[data-expanded-line="bg"]')).toBeVisible();await expect(page.locator('[data-expanded-line="row-0"]')).toBeVisible();
 await follow.uncheck();await expect(page.locator('[data-expanded-line="row-1"]')).toHaveCount(0);await expect(page.locator('[data-expanded-line="bg"]')).toHaveCount(0);
 await preference(page,'studio:timeline-auto-expand','always');await expect(page.locator('[data-expanded-line="row-1"]')).toBeVisible();
 await preference(page,'studio:timeline-auto-expand','off');await expect(page.locator('[data-expanded-line="row-1"]')).toHaveCount(0);await expect(page.locator('[data-expanded-line="row-0"]')).toBeVisible();
});
test('empty staging accepts a line without clearing descendants; cancel, invalid release, undo redo and focus survive',async({page})=>{
 await load(page);const drop=page.locator('[data-staging-drop]');await expect(drop).toBeVisible();await expect(drop.locator('[data-staging-key]')).toHaveCount(0);
 for(const cancel of ['Escape','capture','outside'] as const){await dragIntoStaging(page,'row-0',cancel);await expect(item(page,'row-0')).toBeVisible();await expect(stage(page,'row-0')).toHaveCount(0);}
 await dragIntoStaging(page,'row-0');await expect(item(page,'row-0')).toHaveCount(0);await expect(page.locator('[data-staging-drop]')).toBeFocused();await expect(item(page,'word-0')).toBeVisible();await expect(item(page,'ruby-0')).toBeVisible();await expect(item(page,'roman-unit')).toBeVisible();await expect(item(page,'translation-unit')).toBeVisible();
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(item(page,'row-0')).toBeVisible();await page.getByRole('button',{name:'重做',exact:true}).click();await expect(item(page,'row-0')).toHaveCount(0);await expect(item(page,'word-0')).toBeVisible();
});
test('shared keyboard menu clears each child kind, preserving descendants and filtered selection',async({page})=>{
 await load(page);
 for(const id of ['word-0','ruby-0','roman-unit','translation-unit']){
  const target=item(page,id);await target.focus();await target.press('Shift+F10');await page.getByRole('menuitem',{name:'清空时间',exact:true}).click();await expect(target).toHaveCount(0);await expect(stage(page,id)).toBeFocused();await expect(item(page,'row-0')).toBeVisible();
  if(id==='word-0')await expect(item(page,'ruby-0')).toBeVisible();
  await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(item(page,id)).toBeVisible();
 }
 await preference(page,'studio:staging-ignored-characters','歌');await dragIntoStaging(page,'word-0');await expect(stage(page,'word-0')).toHaveCount(0);await expect(item(page,'row-0')).toBeFocused();
});
for(const audio of [false,true])test(`native names/ticks and plot gestures retain separate selection and clipboard (${audio})`,async({page})=>{
 await load(page,audio);const audioElement=page.locator('audio'),before=await bounds(page),head=await audioElement.evaluate((a:HTMLAudioElement)=>a.currentTime);
 const tick=page.locator('[data-tick-ms]').nth(1),name=page.locator('[data-timeline-text]').filter({hasText:/^行$/}).first();
 for(const label of [tick,name]){
  await label.scrollIntoViewIfNeeded();const box=(await label.boundingBox())!;await page.mouse.move(box.x+1,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width-1,box.y+box.height/2,{steps:8});await page.mouse.up();expect(await page.evaluate(()=>getSelection()?.toString())).not.toBe('');expect(await bounds(page)).toEqual(before);expect(await audioElement.evaluate((a:HTMLAudioElement)=>a.currentTime)).toBe(head);
  expect(await label.evaluate(node=>{const event=new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:new DataTransfer()});return node.dispatchEvent(event);})).toBe(true);
 }
 const wave=page.getByRole('slider',{name:'波形进度'});await wave.scrollIntoViewIfNeeded();const box=(await wave.boundingBox())!,to=(await name.boundingBox())!;
 await page.mouse.move(box.x+box.width*.8,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:10});expect(await page.evaluate(()=>getSelection()?.toString())).toBe('');await page.mouse.up();expect(await bounds(page)).not.toEqual(before);expect(await audioElement.evaluate((a:HTMLAudioElement)=>a.currentTime)).toBe(head);
 const bpm=page.getByRole('spinbutton',{name:'BPM'});await bpm.fill('135');await expect(bpm).toHaveValue('135');
 await page.getByRole('button',{name:'全曲',exact:true}).click();await item(page,'row-0').focus();expect(await item(page,'row-0').evaluate(node=>{const data=new DataTransfer(),event=new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data});node.dispatchEvent(event);return data.getData('application/x-lazulite-lyric');})).not.toBe('');
});

for(const dpr of [1,2])test.describe(`spectrogram DPR ${dpr}`,()=>{
test.use({deviceScaleFactor:dpr});
test('height endpoints repaint at DPR without fetching PCM or rebuilding workers, with both hosts and themes',async({page},testInfo)=>{
 let workers=0,pcm=0;page.on('worker',()=>workers++);page.on('request',request=>{if(request.url().includes('/pcm?'))pcm++;});
 await loadTimeline(page,false);await expect(page.locator('[data-spectrum-ready]')).toHaveAttribute('data-spectrum-ready',/[1-9]/);
 const metrics=[];
 for(const host of ['bottom','audio']){
  if(host==='audio')await page.getByRole('button',{name:'音频处理',exact:true}).click();
  await expect(page.locator('[data-spectrum-ready]')).toHaveAttribute('data-spectrum-ready',/[1-9]/);
  await expect.poll(()=>page.locator('[data-spectrum-ready]').evaluate((node:HTMLElement)=>node.dataset.spectrumReady===node.dataset.spectrumWanted)).toBe(true);
  const baseline={workers,pcm};
  for(const theme of ['light','dark'])for(const height of [36,216]){
   await preference(page,'lazulite-editor-theme',theme);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   await preference(page,'studio:spectrum-height',String(height));const plot=page.getByLabel('声谱图',{exact:true});
   await expect.poll(()=>plot.evaluate((canvas:HTMLCanvasElement)=>canvas.height)).toBe(Math.round(height*await page.evaluate(()=>devicePixelRatio)));
   const measured=await plot.evaluate((canvas:HTMLCanvasElement)=>({css:canvas.getBoundingClientRect().height,pixels:canvas.height,ratio:devicePixelRatio}));expect(measured.css).toBe(height);
   await plot.scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath(`${host}-${theme}-${height}-dpr${dpr}.png`)});
   metrics.push({host,theme,height,...measured,workers,pcm});
  }
  expect({workers,pcm}).toEqual(baseline);
 }
 const path=testInfo.outputPath(`spectrum-measurements-dpr${dpr}.json`);await writeFile(path,JSON.stringify(metrics,null,2));await testInfo.attach('spectrum-measurements',{path,contentType:'application/json'});
 if(dpr===1){await page.locator('[data-settings-button]').click();const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'时间轴',exact:true}).click();for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:testInfo.outputPath(`settings-${theme}.png`)});}}
});
});

test('active groups keep focused and menu objects mounted across virtual scrolling',async({page})=>{
 await load(page);await page.getByRole('button',{name:'编辑',exact:true}).click();
 const xml=await page.evaluate(async()=>{const dp='/src/domain/lyric-document.ts',cp='/src/adapters/ttml/lyric-codec.ts';const d=await import(dp),c=await import(cp),doc=d.createLyricDocument('');doc.lines=Array.from({length:60},(_,i)=>{const line=d.createLine('歌',`virtual-${i}`);line.beginMs=1000;line.endMs=5000;line.words[0].id=`virtual-word-${i}`;line.words[0].beginMs=1000;line.words[0].endMs=5000;return line;});return c.serializeLyricTtml(doc,{draft:true});});
 await importLyrics(page,{name:'virtual-active.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});await page.locator('[data-outline-drag]').first().click();await page.getByRole('button',{name:'音频处理',exact:true}).click();await preference(page,'studio:timeline-auto-expand','always');await page.locator('audio').evaluate((a:HTMLAudioElement)=>{a.currentTime=2;});
 const first=item(page,'virtual-word-0');await first.focus();const group=page.locator('[data-expanded-line="virtual-0"]');
 const scroll=group.locator('..').locator('..');await scroll.evaluate(node=>node.scrollTop=node.scrollHeight);await expect(first).toBeAttached();await expect(first).toBeFocused();expect(await page.locator('[data-expanded-line]').count()).toBeLessThan(30);
 await first.press('Shift+F10');await expect(page.getByRole('menuitem',{name:'清空时间',exact:true})).toBeVisible();await page.locator('audio').evaluate((a:HTMLAudioElement)=>{a.currentTime=6;});await expect(group).toBeAttached();await page.keyboard.press('Escape');await expect(first).toBeFocused();
});
test('multi-line clear commits once and a playback line change preserves an in-progress word drag',async({page})=>{
 await load(page);const first=item(page,'row-0'),second=item(page,'row-1');await first.click();await second.click({modifiers:['ControlOrMeta']});await dragIntoStaging(page,'row-0');await expect(first).toHaveCount(0);await expect(second).toHaveCount(0);await expect(item(page,'word-0')).toBeVisible();await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(first).toBeVisible();await expect(second).toBeVisible();
 await first.click();await preference(page,'studio:timeline-auto-expand','always');const word=item(page,'word-0');const from=(await word.boundingBox())!,drop=page.locator('[data-staging-drop]'),to=(await drop.boundingBox())!;
 await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.locator('audio').evaluate((a:HTMLAudioElement)=>{a.currentTime=7.5;});await expect(page.locator('[data-expanded-line="row-2"]')).toBeAttached();expect(await word.evaluate(node=>node.hasPointerCapture(1))).toBe(true);const currentDrop=(await drop.boundingBox())!;await page.mouse.move(currentDrop.x+currentDrop.width*.5,currentDrop.y+currentDrop.height*.7,{steps:8});await expect(drop).toHaveAttribute('data-clearing','true');await page.mouse.up();await expect(word).toHaveCount(0);await expect(stage(page,'word-0')).toBeFocused();
});
