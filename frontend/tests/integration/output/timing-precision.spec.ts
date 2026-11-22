import {expect,test} from '@playwright/test';
import {importLyrics} from '../../fixtures/import-lyrics';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';

test('quantized save, download and actual STPP extraction agree with external parser',async({page})=>{
 await page.goto('/projects/music-packaging/edit');
 await importLyrics(page,{name:'milliseconds.ttml',mimeType:'application/xml',buffer:Buffer.from('<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="0.184500" end="3.000499"><span begin="0.184500" end="3.000499">歌</span></p></body></tt>')});
 await expect(page.getByLabel('词 歌开始秒数')).toHaveValue('0.185');
 await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.locator('header').getByText('已保存',{exact:true})).toBeVisible();
 await page.reload();await expect(page.getByLabel('词 歌开始秒数')).toHaveValue('0.185');
 await page.getByRole('button',{name:'文件打包',exact:true}).click();
 const lyrics=page.waitForEvent('download');await page.locator('#output-panel-lyrics').getByRole('button',{name:'导出 TTML'}).click();
 const xml=await readFile((await (await lyrics).path())!,'utf8');
 await page.getByRole('tab',{name:'音乐文件嵌入',exact:true}).click();
 const music=page.waitForEvent('download');await page.getByRole('button',{name:'下载嵌入音频',exact:true}).click();
 const path=(await (await music).path())!;
 const embedded=execFileSync('server/.venv/bin/python',['-c','from server.publishing import extract_stpp; from pathlib import Path; import sys; sys.stdout.buffer.write(extract_stpp(Path(sys.argv[1])))',path],{cwd:'..',encoding:'utf8'});
 for(const text of [xml,embedded]){
  expect(text).toContain('00:00.185');expect(text).toContain('00:03.000');
  const times=await page.evaluate(async text=>{
   const url='/node_modules/.vite/deps/@applemusic-like-lyrics_lyric.js';
   const {parseTTML}=await import(url);const result=parseTTML(text);
   return [result.lines[0].words[0].startTime,result.lines[0].words[0].endTime];
  },text);
  expect(times).toEqual([185,3000]);
 }
});
