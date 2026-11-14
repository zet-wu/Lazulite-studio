import {expect,test} from '@playwright/test';
import {importLyrics} from '../fixtures/import-lyrics';
test('word batch flags and explicit singers retain other references, undo once and survive reload',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await page.goto('/projects/sample-project/edit?scenario=no-music');
 await page.locator('[data-settings-button]').click();await page.getByRole('button',{name:'AMLL 兼容设置',exact:true}).click();await page.getByRole('switch',{name:'禁用词级歌手',exact:true}).uncheck();await page.keyboard.press('Escape');
 const xml=await page.evaluate(async()=>{
  const dp='/src/domain/lyric-document.ts',cp='/src/adapters/ttml/lyric-codec.ts';const d=await import(dp),c=await import(cp);const doc=d.createLyricDocument('');
  doc.agents=['v1','v2','v3'].map(id=>({id,name:id,type:'person'}));doc.lines[0].agentRefs=['v1'];doc.lines[0].words=[{...d.createWord('one'),id:'one',agentRefs:['v2'],obscene:true},{...d.createWord('two'),id:'two',agentRefs:['v3']}];
  return c.serializeLyricTtml(doc,{draft:true});
 });await importLyrics(page,{name:'words.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
 const word=(id:string)=>page.locator(`main [data-word-id="${id}"]`),singer=(id:string)=>page.getByLabel(`词级歌手 ${id}`,{exact:true});
 await word('one').click({position:{x:2,y:2}});await word('two').click({position:{x:2,y:2},modifiers:['Control']});
 await expect(singer('v1')).not.toBeChecked();await expect(singer('v2')).toHaveAttribute('aria-checked','mixed');await expect(singer('v3')).toHaveAttribute('aria-checked','mixed');
 if(process.env.STUDIO_EVIDENCE_DIR)for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:`${process.env.STUDIO_EVIDENCE_DIR}/word-batch-${theme}.png`});}
 await singer('v2').focus();await page.keyboard.press('Space');await expect(singer('v2')).toBeChecked();await expect(singer('v3')).toHaveAttribute('aria-checked','mixed');
 const obscene=page.getByLabel('不雅用语',{exact:true});await expect(obscene).toHaveAttribute('aria-checked','mixed');await obscene.focus();await page.keyboard.press('Space');await expect(obscene).toBeChecked();
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(obscene).toHaveAttribute('aria-checked','mixed');await page.getByRole('button',{name:'重做',exact:true}).click();await expect(obscene).toBeChecked();
 await page.waitForTimeout(700);await page.reload();await word('one').click({position:{x:2,y:2}});await word('two').click({position:{x:2,y:2},modifiers:['Control']});await expect(obscene).toBeChecked();await expect(singer('v2')).toBeChecked();await expect(singer('v3')).toHaveAttribute('aria-checked','mixed');
});
