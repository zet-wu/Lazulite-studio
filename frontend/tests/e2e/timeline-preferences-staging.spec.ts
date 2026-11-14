import {expect,test,type Page} from '@playwright/test';
import {loadTimeline} from '../fixtures/timeline-setup';
import {importLyrics} from '../fixtures/import-lyrics';
const stage=(page:Page,id:string)=>page.locator(`[data-staging-key="${id}"]`);
async function load(page:Page){
 await page.setViewportSize({width:1440,height:1000});await loadTimeline(page,true);
 await page.getByRole('button',{name:'编辑',exact:true}).click();
 const xml=await page.evaluate(async()=>{
  const dp='/src/domain/lyric-document.ts',cp='/src/adapters/ttml/lyric-codec.ts';const d=await import(dp),c=await import(cp);
  const doc=d.createLyricDocument('');const line=doc.lines[0];line.id='row';line.beginMs=1000;line.endMs=8000;
  line.words=[{...d.createWord(' '),id:'ignored',rubyUnits:[{id:'child',reading:'あ',beginMs:null,endMs:null}]},{...d.createWord('无注音'),id:'plain'},
   {...d.createWord('長い歌詞の完全な親文字'),id:'parent',beginMs:3000,endMs:5000,rubyUnits:[{id:'r1',reading:'なが',beginMs:null,endMs:null},{id:'r2',reading:'ことば',beginMs:null,endMs:null},{id:'r3',reading:'の',beginMs:null,endMs:null}]},
   {...d.createWord('  '),id:'spaces'},{...d.createWord('　'),id:'fullspace'}];
  return c.serializeLyricTtml(doc,{draft:true});
 });
 await importLyrics(page,{name:'staging-tree.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
 await page.locator('[data-outline-drag]').first().click();await page.getByRole('button',{name:'音频处理',exact:true}).click();
}
async function settings(page:Page){await page.locator('[data-settings-button]').click();await page.getByRole('dialog').getByRole('button',{name:'时间轴',exact:true}).click();return page.getByRole('dialog');}
async function preference(page:Page,key:string,value:string){await page.evaluate(async({key,value})=>{const path='/src/adapters/preferences.ts';const {savePreference}=await import(path);await savePreference(key,value);},{key,value});}
for(const modifier of ['Control','Meta'] as const)test(`${modifier} removing the last selection restores staging overview and empty properties`,async({page})=>{
 await load(page);const child=stage(page,'child');await child.press('Enter');await expect(child).toBeVisible();
 await page.getByRole('button',{name:'编辑',exact:true}).click();
 const word=page.locator('main [data-word-id="plain"]');await word.click({position:{x:2,y:2}});await word.click({position:{x:2,y:2},modifiers:[modifier]});
 await expect(page.getByLabel('不雅用语',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'音频处理',exact:true}).click();await expect(stage(page,'row')).toBeVisible();await expect(stage(page,'plain')).toHaveCount(0);
 await stage(page,'row').press('Enter');await expect(stage(page,'plain')).toBeVisible();await expect(stage(page,'row')).toHaveCount(0);
});
test('settings and toolbar share saved layers, literal empty filtering, and project-independent preferences',async({page})=>{
 await load(page);await expect(stage(page,'spaces')).toHaveCount(0);await expect(stage(page,'fullspace')).toBeVisible();
 let dialog=await settings(page);const ignored=dialog.getByRole('textbox',{name:'暂存区忽略字符',exact:true});await expect(ignored).toHaveValue(' ');
 await ignored.fill('');await ignored.press('Tab');await expect(stage(page,'spaces')).toBeVisible();
 await dialog.getByRole('switch',{name:'时间轴暂存区',exact:true}).uncheck();await page.keyboard.press('Escape');
 const toggle=page.getByRole('button',{name:'时间轴暂存区',exact:true});await expect(toggle).toHaveAttribute('aria-pressed','false');await expect(stage(page,'plain')).toHaveCount(0);
 await toggle.click();await expect(stage(page,'spaces')).toBeVisible();
 dialog=await settings(page);await expect(dialog.getByRole('switch',{name:'时间轴暂存区',exact:true})).toBeChecked();
 await dialog.getByRole('switch',{name:'词',exact:true}).uncheck();await page.keyboard.press('Escape');await expect(stage(page,'parent')).toHaveCount(0);await expect(stage(page,'r1')).toBeVisible();
 await page.reload();await page.locator('[data-settings-button]').click();await page.getByRole('dialog').getByRole('button',{name:'时间轴',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'暂存区忽略字符',exact:true})).toHaveValue('');await expect(page.getByRole('dialog').getByRole('switch',{name:'词',exact:true})).not.toBeChecked();
 await page.keyboard.press('Escape');await page.goto('/projects');await page.locator('[data-settings-button]').click();await page.getByRole('dialog').getByRole('button',{name:'时间轴',exact:true}).click();await expect(page.getByRole('dialog').getByRole('switch',{name:'词',exact:true})).not.toBeChecked();
});
test('ignored ancestors are selectable context and preferences cancel a pending assignment',async({page})=>{
 await load(page);await expect(stage(page,'ignored')).toHaveAttribute('data-staging-assignable','false');await expect(stage(page,'child')).toHaveAttribute('data-staging-assignable','true');
 const source=stage(page,'plain'),lane=page.locator('[data-assignment-kind="word"]').first();
 for(const [key,value]of [['studio:staging-ignored-characters','无注音'],['studio:timeline-layers',JSON.stringify({staging:false})]]){
  await preference(page,'studio:staging-ignored-characters',' ');
  const from=(await source.boundingBox())!,to=(await lane.boundingBox())!;
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(to.x+to.width*.4,to.y+to.height/2,{steps:4});
  await expect(page.locator('[class*="assignmentPreview"]')).toBeVisible();await preference(page,key,value);await page.mouse.up();await expect(page.locator('[class*="assignmentPreview"]')).toHaveCount(0);
 }
 await preference(page,'studio:timeline-layers',JSON.stringify({staging:true}));await expect(source).toBeVisible();
 const ignored=stage(page,'ignored'),from=(await ignored.boundingBox())!,to=(await lane.boundingBox())!;
 await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(to.x+to.width*.2,to.y+to.height/2,{steps:4});await page.mouse.up();
 await expect(ignored).toHaveAttribute('data-staging-assignable','false');await expect(stage(page,'child')).toBeVisible();
});
test('ancestor allocation previews the complete gap and commits it with one undo',async({page})=>{
 await load(page);const source=stage(page,'r1'),lane=page.locator('[data-assignment-kind="ruby"]').first();const from=(await source.boundingBox())!,to=(await lane.boundingBox())!;
 // The default visible range is 15 seconds; drop inside the parent [3,5] seconds.
 await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(to.x+to.width*(4/15),to.y+to.height/2,{steps:5});
 await expect(page.locator('[class*="assignmentPreview"]')).toHaveText('3000–5000 ms');await page.mouse.up();await expect(source).toHaveCount(0);
 await expect(stage(page,'r2')).toBeVisible();await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(source).toBeVisible();
});
test('Escape discards an ignore-character draft locally, then closes the unchanged settings window',async({page})=>{
 await page.goto('/projects/sample-project/edit?scenario=no-music');const dialog=await settings(page),input=dialog.getByRole('textbox',{name:'暂存区忽略字符',exact:true});
 await input.fill('x');await input.press('Escape');await expect(input).toHaveValue(' ');await expect(dialog).toBeVisible();await input.press('Escape');await expect(dialog).toHaveCount(0);
});
