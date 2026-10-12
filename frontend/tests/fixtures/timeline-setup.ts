import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { importLyrics } from './import-lyrics';
const xml=readFileSync(new URL('./timeline-rich.ttml',import.meta.url));
export async function loadTimeline(page:Page, audio=false, segments = [{id:'s1',beginMs:1000,endMs:3000}]) {
  await page.addInitScript(segments => {
    const original=window.fetch;
    window.fetch=async(input,init)=>{
      const url=String(input);
      if(url.includes('/energy?')) return Response.json({start_ms:0,step_ms:100,values:Array.from({length:1200},(_,i)=>.2+Math.sin(i)*.1)});
      const response=await original(input,init);
      if(url.endsWith('/sample-project/document')&&(!init?.method||init.method==='GET')) {
        const data=await response.json();data.document.acoustics={analysisId:'synthetic',segments};
        return Response.json(data,{headers:response.headers});
      }
      return response;
    };
  }, segments);
  await page.goto('/projects/sample-project/edit');
  await importLyrics(page,{name:'overlap.ttml',mimeType:'application/xml',buffer:xml});
  await page.locator('[data-outline-drag]').first().click();
  await page.locator('audio').evaluate(async (audio:HTMLAudioElement) => {
    const rate=8000,count=rate*120,buffer=new ArrayBuffer(44+count*2),v=new DataView(buffer);
    const str=(i:number,s:string)=>[...s].forEach((c,j)=>v.setUint8(i+j,c.charCodeAt(0)));
    str(0,'RIFF');v.setUint32(4,36+count*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,count*2,true);
    audio.src=URL.createObjectURL(new Blob([buffer],{type:'audio/wav'}));
    await new Promise<void>(resolve=>audio.addEventListener('loadedmetadata',()=>resolve(),{once:true}));
  });
  if(audio) await page.getByRole('button',{name:'音频处理',exact:true}).click();
  await page.getByRole('button',{name:'声谱图',exact:true}).click();
  for(let i=0;i<3;i++) await page.getByRole('button',{name:'放大波形',exact:true}).click();
  await expect(page.locator('[data-spectrum-ready]')).toHaveAttribute('data-spectrum-ready',/[1-9]/);
}
