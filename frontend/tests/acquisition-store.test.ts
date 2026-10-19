import { expect, test } from 'vitest';
import { AcquisitionStore, PREVIEW_CAPACITY, SOURCES } from '../src/acquisition-store';
import type { Candidate, Source } from '../src/adapters/http/lyric-sources';
const row = (source: Source,id: string,title='Song'): Candidate=>({source,id,title,artists:[],album:'',duration_ms:null});
const query = {title:'Song (Live)!',artist:'',album:''};
const tick = async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function deferred() { let resolve!: (value: unknown)=>void, reject!: (reason:unknown)=>void; const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject}; }
test('shows each union immediately; rounds and cancellation cannot mix late results',async()=>{
 const requests: {action:string,body:any,signal?:AbortSignal,gate:ReturnType<typeof deferred>}[]=[];
 const store=new AcquisitionStore((async(action: string,body: any,signal?: AbortSignal)=>{const gate=deferred();requests.push({action,body,signal,gate});return gate.promise;}) as any);
 store.search(query);
 expect(requests.filter(r=>r.action==='search')).toHaveLength(12); // Four sources, shared limit 3.
 requests[0].gate.resolve({items:[row('netease','a')]});await tick();
 expect(store.getSnapshot().sources.netease.rows).toEqual(['a']);
 store.cancelSearch(); expect(store.getSnapshot().sources.netease.rows).toEqual(['a']);
 requests[1].gate.resolve({items:[row('netease','late')]});await tick();
 expect(store.getSnapshot().sources.netease.rows).toEqual(['a']);
 store.search({...query,title:'New'});
 for(const request of requests.filter(r=>r.signal?.aborted))request.gate.resolve({items:[row(request.body.source ?? 'netease','stale')]});
 await tick();expect(store.getSnapshot().sources.netease.rows).toEqual([]);
 store.dispose();
});
test('deduplicates checks; tab selections and bounded preview cache are independent',async()=>{
 let checks=0; const inSource:Record<string,number>={},maxSource:Record<string,number>={};let inChecks=0,maxChecks=0;
 const store=new AcquisitionStore((async(action: string,body:any)=>{
   const source=body.source;inSource[source]=(inSource[source]??0)+1;maxSource[source]=Math.max(maxSource[source]??0,inSource[source]);
   if(action==='fetch'){checks++;inChecks++;maxChecks=Math.max(maxChecks,inChecks);}
   await tick();
   inSource[source]--;if(action==='fetch')inChecks--;
   return action==='search' ? {items:Array.from({length:8},(_,i)=>row(source,String(7-i)))} : {empty:false,format:'lrc',content:'[00:01]word',metadata:{}};
 }) as any);
 store.search(query);
 for(let i=0;i<100;i++)await tick();
 expect(store.getSnapshot().sources.netease.rows).toEqual(['0','1','2','3','4','5','6','7']);expect(checks).toBe(32);expect(maxChecks).toBeLessThanOrEqual(2);expect(Object.values(maxSource).every(n=>n<=3)).toBe(true);
 expect(store.cacheSize).toBeLessThanOrEqual(PREVIEW_CAPACITY);
 store.setTab('netease');store.select('netease','0');store.select('netease','0');await tick();
 store.setTab('qqmusic');store.select('qqmusic','1');for(let i=0;i<5;i++)await tick();
 expect(store.getSnapshot().sources.netease.selected).toBe('0');expect(store.preview('netease')).not.toBeNull();
 expect(store.preview('qqmusic')).not.toBeNull();expect(store.cacheSize).toBeLessThanOrEqual(PREVIEW_CAPACITY);
 const previous=checks;store.setTab('netease');store.ensureSearch(query);store.select('netease','0');await tick();expect(checks).toBe(previous);
 store.dispose();
});
test('interaction holds row order and active selection while incremental candidates arrive',async()=>{
 const gates: ReturnType<typeof deferred>[]=[];
 const store=new AcquisitionStore((async(action: string)=>{if(action==='fetch')return{empty:true};const gate=deferred();gates.push(gate);return gate.promise;}) as any);
 store.search(query);gates[0].resolve({items:[row('netease','z','other')]});await tick();
 store.setInteracting('netease',true);store.select('netease','z');gates[1].resolve({items:[row('netease','a','Song')]});await tick();
 expect(store.getSnapshot().sources.netease.rows).toEqual(['z','a']);
 store.setInteracting('netease',false);expect(store.getSnapshot().sources.netease.rows).toEqual(['a','z']);expect(store.getSnapshot().sources.netease.selected).toBe('z');store.dispose();
});

test('a selected queued candidate starts before background work and reuses its in-flight check',async()=>{
 const fetches:{source:Source,id:string,gate:ReturnType<typeof deferred>}[]=[];
 const store=new AcquisitionStore((async(action:string,body:any)=>{
  if(action==='search')return{items:Array.from({length:6},(_,i)=>row(body.source,String(i)))};
  const gate=deferred();fetches.push({source:body.source,id:body.id,gate});return gate.promise;
 }) as any);
 store.setTab('netease');store.search({title:'Song',artist:'',album:''});await tick();
 expect(fetches).toHaveLength(2);
 store.select('netease','5');store.select('netease','5');
 fetches[0].gate.resolve({empty:false,format:'lrc',content:'[00:01]word',metadata:{}});await tick();
 expect(fetches[2].source+fetches[2].id).toBe('netease5');
 store.select('netease','5');await tick();expect(fetches.filter(f=>f.id==='5'&&f.source==='netease')).toHaveLength(1);
 store.dispose();for(const f of fetches)f.gate.resolve({empty:true});await tick();
});
