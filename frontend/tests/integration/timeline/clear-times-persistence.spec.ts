import {expect,test} from '@playwright/test';
import {importLyrics} from '../../fixtures/import-lyrics';
test('self-only clear, undo redo and new timeline preferences persist through real service and reopen',async({page})=>{
 const pid='music-packaging';await page.goto(`/projects/${pid}/edit`);
 const xml=await page.evaluate(async()=>{
  const dp='/src/domain/lyric-document.ts',cp='/src/adapters/ttml/lyric-codec.ts';const d=await import(dp),c=await import(cp),doc=d.createLyricDocument('歌');
  const line=doc.lines[0];line.id='clear-line';line.beginMs=1000;line.endMs=4000;line.words[0].id='clear-word';line.words[0].beginMs=1200;line.words[0].endMs=3500;line.words[0].rubyUnits=[{id:'clear-ruby',reading:'うた',beginMs:1300,endMs:3000}];
  return c.serializeLyricTtml(doc,{draft:true});
 });
 await importLyrics(page,{name:'clear-times.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
 await page.locator('[data-outline-drag]').first().click();await page.getByRole('button',{name:'编辑',exact:true}).click();
 const word=page.locator('[data-timeline-key="clear-word"]');await word.focus();await word.press('Shift+F10');await page.getByRole('menuitem',{name:'清空时间',exact:true}).click();await expect(word).toHaveCount(0);await expect(page.locator('[data-staging-key="clear-word"]')).toBeFocused();await expect(page.locator('[data-timeline-key="clear-ruby"]')).toBeVisible();
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(word).toBeVisible();await page.getByRole('button',{name:'重做',exact:true}).click();await expect(word).toHaveCount(0);
 await page.locator('[data-settings-button]').click();const dialog=page.getByRole('dialog',{name:'设置',exact:true});await dialog.getByRole('button',{name:'时间轴',exact:true}).click();
 await dialog.getByRole('combobox',{name:'活动行自动展开显示'}).selectOption('always');const height=dialog.getByRole('spinbutton',{name:'声谱图高度'});await height.fill('216');await height.press('Enter');await dialog.getByRole('switch',{name:'交换滚轮操作'}).check();await page.keyboard.press('Escape');
 const savedResponse=page.waitForResponse(response=>response.url().endsWith(`/api/v1/projects/${pid}/document`)&&response.request().method()==='PUT');await page.getByRole('button',{name:'保存',exact:true}).click();expect((await savedResponse).status()).toBe(200);await expect(page.getByText('已保存',{exact:true})).toBeVisible();
 await expect.poll(async()=>{const settings=await(await page.request.get('/api/v1/settings')).json();return settings.values['studio:spectrum-height'];}).toBe('216');
 await page.reload();await page.getByRole('button',{name:'编辑',exact:true}).click();await page.locator('[data-outline-drag]').first().click();
 const persisted=await page.evaluate(async pid=>{const hp='/src/adapters/http/client.ts',cp='/src/adapters/project-codec.ts';const h=await import(hp),c=await import(cp);return c.parseProject((await h.studioApi.getDocumentEnvelope(pid)).document).lyrics;},pid);
 expect(persisted.lines[0]).toMatchObject({id:'clear-line',beginMs:1000,endMs:4000,words:[{id:'clear-word',beginMs:null,endMs:null,rubyUnits:[{id:'clear-ruby',beginMs:1300,endMs:3000}]}]});
 await page.locator('[data-settings-button]').click();await dialog.getByRole('button',{name:'时间轴',exact:true}).click();await expect(height).toHaveValue('216');await expect(dialog.getByRole('combobox',{name:'活动行自动展开显示'})).toHaveValue('always');await expect(dialog.getByRole('switch',{name:'交换滚轮操作'})).toBeChecked();
});
