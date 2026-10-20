import type { components } from './generated';
import type { DictionaryRange } from '../../domain/dictionary-ruby';
import { requestHeaders } from './client';

export type DictionaryInfo = components['schemas']['DictionaryInfo'];
export type DictionaryList = components['schemas']['DictionaryList'];
export type DictionaryInstall = components['schemas']['DictionaryInstall'];
type Analysis = components['schemas']['DictionaryAnalysis'];
const root='/api/v1/reading/dictionaries';

async function call<T>(path:string,init?:RequestInit):Promise<T> {
  const response=await fetch(root+path,{credentials:'include',...init,headers:requestHeaders(init?.headers)});
  if(!response.ok){
    let message=`词典请求失败（${response.status}）`;
    try { const body=await response.json() as {message?:string};message=body.message??message; } catch { /* retain HTTP status */ }
    throw new Error(message);
  }
  return response.status===204?undefined as T:await response.json() as T;
}
export const listDictionaries=(signal?:AbortSignal)=>call<DictionaryList>('',{signal});
export const removeDictionary=(id:string)=>call<void>(`/${encodeURIComponent(id)}`,{method:'DELETE'});
export const importDictionary=(file:File,inspect:boolean,replace=false)=>{
  const body=new FormData();body.set('file',file);
  return call<DictionaryInstall>(`/import?inspect=${inspect}&replace=${replace}`,{method:'POST',body});
};
export async function analyzeDictionary(id:string,instance:string,lines:Array<{id:string;text:string}>,signal:AbortSignal) {
  const result=await call<Analysis>(`/${encodeURIComponent(id)}/analyze`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({instance,lines}),signal});
  if(result.instance!==instance)throw new Error('词典实例与请求不一致，请重新生成');
  // Wire positions are Unicode code points; the editor uses UTF-16 offsets.
  const offsets=new Map(lines.map(line=>{
    let at=0;const values=[0];for(const c of line.text){at+=c.length;values.push(at);}return [line.id,values] as const;
  }));
  const ranges:DictionaryRange[]=result.ranges.map(r=>{
    const map=offsets.get(r.line_id);
    if(!map||!Number.isInteger(r.base_start)||!Number.isInteger(r.base_end)||map[r.base_start]===undefined||map[r.base_end]===undefined)throw new Error('词典正文范围无效');
    return {lineId:r.line_id,start:map[r.base_start],end:map[r.base_end],base:r.base,status:r.status,units:r.units};
  });
  return {...result,ranges};
}
