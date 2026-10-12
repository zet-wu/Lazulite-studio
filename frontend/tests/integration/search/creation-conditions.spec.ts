import { expect, test } from '@playwright/test';
import { importLyrics } from '../../fixtures/import-lyrics';

test('real creation tags, cleared conditions and cross-window deletion cannot resurrect recovery',async({page,context})=>{
 await page.goto('/projects');
 await page.getByRole('button',{name:'新建项目'}).click();
 const dialog=page.getByRole('dialog');
 // A valid WAV fixture with no tags: title must use upload filename, not custom name.
 const bytes=Buffer.alloc(44+16000);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(8000,24);bytes.writeUInt32LE(16000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(16000,40);
 await dialog.getByLabel('音频文件').setInputFiles({name:'actual.song.wav',mimeType:'audio/wav',buffer:bytes});await dialog.getByLabel('项目名称').fill('跨窗口删除测试项目');
 await dialog.getByRole('button',{name:'上传并创建',exact:true}).click();
 await expect(page.getByRole('button',{name:'歌词获取',exact:true})).toBeVisible();
 const projectId=page.url().match(/projects\/([^/]+)/)![1];
 // Prevent actual provider access in this deterministic integration test.
 await context.route('**/api/v1/lyric-sources/**',route=>route.fulfill({json:{items:[]}}));
 await page.getByRole('button',{name:'歌词获取',exact:true}).click();await page.getByRole('tab',{name:'网易云音乐'}).click();
 await expect(page.getByRole('textbox',{name:'搜索标题'})).toHaveValue('actual.song');await expect(page.getByRole('textbox',{name:'搜索艺术家'})).toHaveValue('');
 await page.getByRole('textbox',{name:'搜索标题'}).fill('');await page.getByRole('textbox',{name:'搜索艺术家'}).fill('Final artist');
 await expect.poll(async()=>page.evaluate(async id=>(await(await fetch(`/api/v1/projects/${id}/search-conditions`)).json()).artist,projectId)).toBe('Final artist');
 await page.reload();await page.getByRole('button',{name:'歌词获取',exact:true}).click();await page.getByRole('tab',{name:'QQ 音乐'}).click();
 await expect(page.getByRole('textbox',{name:'搜索标题'})).toHaveValue('');await expect(page.getByRole('textbox',{name:'搜索艺术家'})).toHaveValue('Final artist');
 await importLyrics(page,{name:'recovery.txt',mimeType:'text/plain',buffer:Buffer.from('recoverable')});
 const list=await context.newPage();await list.goto('/projects');
 const row=list.getByRole('link',{name:/跨窗口删除测试项目/}).locator('..');
 let dismiss=true;list.on('dialog',dialog=>dismiss ? dialog.dismiss() : dialog.accept());
 await row.getByRole('button',{name:'删除项目 跨窗口删除测试项目'}).click();await expect(list.getByRole('link',{name:/跨窗口删除测试项目/})).toBeVisible();
 dismiss=false;await row.getByRole('button',{name:'删除项目 跨窗口删除测试项目'}).click();await expect(list.getByRole('link',{name:/跨窗口删除测试项目/})).toHaveCount(0);
 await expect(page.getByRole('alert').filter({hasText:'项目已删除'})).toBeVisible();await expect(page.getByRole('button',{name:'保存',exact:true})).toHaveCount(0);
 const status=await page.evaluate(async id=>(await fetch(`/api/v1/projects/${id}/document`)).status,projectId);expect(status).toBe(404);
 await expect.poll(()=>page.evaluate(async id=>{const modulePath='/src/adapters/recovery/index.ts'; const {createRecoveryAdapter}=await import(modulePath) as typeof import('../../../src/adapters/recovery');return createRecoveryAdapter().readCheckpoint(id);},projectId)).toBeNull();
 await list.close();
});
