import {expect,test} from '@playwright/test';
function wav() {
 const data=Buffer.alloc(44+16000);data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(8000,24);data.writeUInt32LE(16000,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(16000,40);return data;
}
test('settings imports and reimports the same audio while preserving lyrics and advancing the binding',async({page})=>{
 const headers={origin:'http://127.0.0.1:5175'};
 const created=await page.request.post('/api/v1/projects',{headers,data:{name:'source replacement'}});const pid=(await created.json()).id;
 const path=`/api/v1/projects/${pid}`;
 await page.goto(`/projects/${pid}/edit`);
 await expect(page.getByRole('button',{name:'导入音频',exact:true})).toBeVisible();
 const before=await(await page.request.get(path+'/document')).json();
 await page.getByLabel('导入音频文件').setInputFiles({name:'source.wav',mimeType:'audio/wav',buffer:wav()});
 await expect.poll(async()=>((await(await page.request.get(path)).json()).asset?.id)).toBeTruthy();
 const first=await(await page.request.get(path)).json();
 await page.locator('[data-top-menu="settings"] summary').click();
 const chooser=page.waitForEvent('filechooser');
 await page.getByRole('button',{name:'导入音频',exact:true}).click();
 await(await chooser).setFiles({name:'source.wav',mimeType:'audio/wav',buffer:wav()});
 await expect.poll(async()=>((await(await page.request.get(path)).json()).asset.id)).not.toBe(first.asset.id);
 const after=await(await page.request.get(path+'/document')).json();
 expect(after.document.lyrics).toEqual(before.document.lyrics);
 expect(after.document.acoustics).toEqual({analysisId:null,segments:[]});
 expect(after.revision).not.toBe(before.revision);
 await page.reload();await expect(page.getByText('已保存',{exact:true})).toBeVisible();
});
