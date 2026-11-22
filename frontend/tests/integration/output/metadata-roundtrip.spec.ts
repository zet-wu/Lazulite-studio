import { test, expect } from '@playwright/test';
import { importLyrics } from '../../fixtures/import-lyrics';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
test('actor references, declaration order and metadata survive actual revision reopen and STPP',async({page})=>{
 await page.goto('/projects/music-packaging/edit');
 const source='<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><head><metadata><ttm:agent xml:id="role" type="character"><ttm:name>角色</ttm:name><ttm:actor agent="actor"/></ttm:agent><ttm:agent xml:id="actor" type="person"/><ttm:title>标题</ttm:title><ttm:artist>甲</ttm:artist><ttm:artist>乙</ttm:artist></metadata></head><body><p begin="1" end="3" ttm:agent="role"><span begin="1" end="3">歌</span></p></body></tt>';
 await importLyrics(page,{name:'actors.ttml',mimeType:'application/xml',buffer:Buffer.from(source)});
 await page.locator('[data-top-menu="lyrics-settings"] summary').click();await page.getByRole('button',{name:'歌手管理',exact:true}).click();
 await page.getByLabel('歌手 ID actor',{exact:true}).fill('performer');await page.getByLabel('歌手 ID actor',{exact:true}).press('Enter');await page.getByRole('button',{name:'上移歌手 performer'}).click();await page.getByRole('button',{name:'关闭歌手管理'}).click();
 await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.locator('header').getByText('已保存',{exact:true})).toBeVisible();await page.reload();
 await page.getByRole('button',{name:'文件打包',exact:true}).click();const lyrics=page.waitForEvent('download');await page.locator('#output-panel-lyrics').getByRole('button',{name:'导出 TTML'}).click();const xml=await readFile((await (await lyrics).path())!,'utf8');
 await page.getByRole('tab',{name:'音乐文件嵌入',exact:true}).click();
 await page.getByRole('combobox',{name:'LRC → 元数据标签',exact:true}).selectOption('elrc');await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByRole('button',{name:'文件打包',exact:true}).click();await page.getByRole('tab',{name:'音乐文件嵌入',exact:true}).click();await expect(page.getByRole('combobox',{name:'LRC → 元数据标签',exact:true})).toHaveValue('elrc');
 const music=page.waitForEvent('download');await page.getByRole('button',{name:'下载嵌入音频',exact:true}).click();const path=(await (await music).path())!;
 const python = process.env.STUDIO_TEST_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
 const embedded=execFileSync(python,['-c','from server.publishing import extract_stpp; from pathlib import Path; import sys; sys.stdout.buffer.write(extract_stpp(Path(sys.argv[1])))',path],{cwd:'..',encoding:'utf8'});
 const saved=(await (await page.request.get('/api/v1/projects/music-packaging/document')).json()).document.lyrics.draftTtml;
 for(const text of [saved,xml,embedded]) {
  const data=await page.evaluate(text=>{const xml=new DOMParser().parseFromString(text,'application/xml'),ns='http://www.w3.org/ns/ttml#metadata';return {ids:Array.from(xml.getElementsByTagNameNS(ns,'agent')).map(a=>a.getAttribute('xml:id')),actor:xml.getElementsByTagNameNS(ns,'actor')[0]?.getAttribute('agent')};},text);
  expect(data).toEqual({ids:['performer','role'],actor:'performer'});expect(text).toContain('甲');expect(text).toContain('乙');
 }
});
