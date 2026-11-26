import {expect,test} from '@playwright/test';
import {importLyrics} from '../fixtures/import-lyrics';
import path from 'node:path';

test('external overflow previews 62 lines and confirms import',async({page})=>{
 await page.goto('/projects/sample-project/edit?scenario=no-music');
 await page.getByRole('button',{name:'歌词获取',exact:true}).click();
 await page.getByRole('tab',{name:'文件',exact:true}).click();
 await page.locator('input[type=file][accept^=".ttml"]').setInputFiles(path.resolve('tests/fixtures/external-overflow.ttml'));
 await expect(page.getByText('1 处子单元时间超出父单元（已保留原时间）')).toBeVisible();
 await expect(page.locator('[class*="preview"] > p')).toHaveCount(62);
 await page.getByRole('button',{name:'确认导入并替换歌词',exact:true}).click();
 await expect(page.getByRole('button',{name:'保存',exact:true})).toBeEnabled();
});

test('quick split and merge undo atomically; rate keys ignore text inputs',async({page})=>{
 await page.goto('/projects/sample-project/edit');
 await importLyrics(page,{name:'split.txt',mimeType:'text/plain',buffer:Buffer.from('你好')});
 const words=page.locator('main [data-word-id]');
 await words.first().click({position:{x:2,y:2}});await page.keyboard.press('k');
 await expect(words).toHaveCount(2);
 await page.keyboard.press('Control+z');await expect(words).toHaveCount(1);
 await page.keyboard.press('Control+Shift+z');await expect(words).toHaveCount(2);
 await words.first().click({position:{x:2,y:2}});await words.last().click({position:{x:2,y:2},modifiers:['Control']});
 await page.keyboard.press('m');await expect(words).toHaveCount(1);
 const audio=page.locator('audio');const rate=await audio.evaluate((a:HTMLAudioElement)=>a.playbackRate);
 await words.first().click({position:{x:2,y:2}});await page.keyboard.press('e');
 await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>a.playbackRate)).toBeCloseTo(rate+0.1);
 await page.keyboard.press('q');await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>a.playbackRate)).toBeCloseTo(rate);
 await page.getByRole('textbox',{name:'词 你好',exact:true}).focus();await page.keyboard.press('e');
 expect(await audio.evaluate((a:HTMLAudioElement)=>a.playbackRate)).toBeCloseTo(rate);
});

test('settings separate timing and persist quick split options and custom save binding',async({page})=>{
 await page.goto('/projects/sample-project/edit?scenario=no-music');
 await page.locator('[data-settings-button]').click();const dialog=page.getByRole('dialog',{name:'设置',exact:true});
 await dialog.getByRole('button',{name:'打轴',exact:true}).click();await expect(dialog.getByRole('switch',{name:'背景行默认跳过连续打轴',exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'编辑',exact:true}).click();await expect(dialog.getByRole('heading',{name:'快捷拆分默认参数'})).toBeVisible();
 await dialog.getByRole('switch',{name:'CJK 按字符切分',exact:true}).uncheck();
 await dialog.getByRole('button',{name:'快捷键设置',exact:true}).click();
 const save=dialog.getByRole('textbox',{name:'保存快捷键',exact:true});await save.press('Control+Shift+s');await expect(save).toHaveValue('Ctrl + Shift + S');
 await page.keyboard.press('Escape');await page.reload();await page.locator('[data-settings-button]').click();await dialog.getByRole('button',{name:'快捷键设置',exact:true}).click();await expect(save).toHaveValue('Ctrl + Shift + S');
});

test('gap removal previews exactly the boundary it changes and undoes once',async({page})=>{
 await page.goto('/projects/sample-project/edit?scenario=no-music');
 const xml=await page.evaluate(async()=>{
  const dp='/src/domain/lyric-document.ts',cp='/src/adapters/ttml/lyric-codec.ts';const d=await import(dp),c=await import(cp),doc=d.createLyricDocument('');
  doc.lines[0].words=[{...d.createWord('你'),id:'left',beginMs:0,endMs:1000},{...d.createWord('好'),id:'right',beginMs:1020,endMs:2000}];doc.lines[0].beginMs=0;doc.lines[0].endMs=2000;
  return c.serializeLyricTtml(doc,{draft:true});
 });
 await importLyrics(page,{name:'gap.ttml',mimeType:'application/xml',buffer:Buffer.from(xml)});
 await page.locator('main [data-word-id="left"]').click({position:{x:2,y:2}});
 await page.locator('[data-top-menu="tools"] summary').click();await page.getByRole('button',{name:'批处理',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'批处理',exact:true});await dialog.getByRole('button',{name:'消除读音间空隙',exact:true}).click();
 await expect(dialog.getByRole('status')).toContainText('将调整 0 处读音边界');await expect(dialog.getByRole('button',{name:'应用',exact:true})).toBeDisabled();
 await dialog.getByLabel('相邻读音间隙或重叠阈值（毫秒）',{exact:true}).fill('25');await expect(dialog.getByRole('status')).toContainText('将调整 1 处读音边界');
 await dialog.getByRole('button',{name:'应用',exact:true}).click();
 await expect(page.getByLabel('词 你结束秒数',{exact:true})).toHaveValue('1.01');await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.getByLabel('词 你结束秒数',{exact:true})).toHaveValue('1');
});

for(const theme of ['light','dark'])test(`candidate popup supports keyboard and mouse in ${theme}`,async({page})=>{
 await page.goto('/projects/sample-project/edit?scenario=dictionary-candidates');
 await importLyrics(page,{name:'reading.txt',mimeType:'text/plain',buffer:Buffer.from('说')});
 await page.locator('main section[data-line-id]').first().click({button:'right',position:{x:2,y:2}});await page.getByRole('menuitem',{name:'词典注音',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'词典注音',exact:true});await dialog.getByLabel('词典',{exact:true}).selectOption('test');
 const input=dialog.getByLabel('说读音 1',{exact:true});await expect(input).toHaveValue('syut3');await expect(page.getByRole('listbox')).toHaveCount(0);
 await input.focus();await expect(page.getByRole('listbox')).toBeVisible();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await expect(input).toHaveValue('jyut6');await expect(page.getByRole('listbox')).toHaveCount(0);
 await input.blur();await input.focus();await page.getByRole('option',{name:'syut3',exact:true}).click();await expect(input).toHaveValue('syut3');
 await input.blur();await input.focus();await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 await expect(page.getByRole('listbox')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('listbox')).toHaveCount(0);await expect(dialog).toBeVisible();
});
