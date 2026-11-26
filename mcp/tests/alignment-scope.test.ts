import { expect, it } from 'vitest';
import { createProjectDocument } from '../../frontend/src/domain/project-document';
import { createLine, createWord } from '../../frontend/src/domain/lyric-document';
import { createToolRegistry } from '../src/mcp-server';
import { projectFixture } from './project-fixture';

function fixture(){
 const doc=createProjectDocument();
 doc.lyrics.lines=[{...createLine('','l'),beginMs:100,endMs:2000,words:[{...createWord('愛','w'),beginMs:200,endMs:1800,rubyUnits:[{id:'r1',reading:'あ',beginMs:300,endMs:330},{id:'r2',reading:'い',beginMs:330,endMs:1000}]}]}];
 return doc;
}
it('resolves line/word scopes into reading IDs and union envelope IDs for preview and launch',async()=>{
 const calls:{url:URL;init?:RequestInit}[]=[];
 const f=projectFixture(fixture(),(url,init)=>{calls.push({url,init});return Response.json(url.pathname.endsWith('/jobs')?{items:[]}:url.pathname.endsWith('/alignment-preview')?{model_preview:'token',emitting_count:2}:{id:'j',project_id:'p',kind:'alignment',status:'queued'});}),registry=createToolRegistry();
 for(const kind of ['line','word']){
  const scope=kind==='line'?{scope_line_ids:['l']}:{scope_word_ids:['w']};
  expect(await registry.call('preview_alignment',{project_id:'p',model_id:'m',...scope},f)).toMatchObject({scope_ids:['r1','r2'],scope_envelope_ids:[kind==='line'?'l':'w'],envelope_ms:kind==='line'?[100,2000]:[200,1800]});
  expect(calls.at(-1)!.url.searchParams.getAll('scope_envelope_ids')).toEqual([kind==='line'?'l':'w']);
  await registry.call('start_alignment',{project_id:'p',model_id:'m',...scope},f);
  expect(JSON.parse(String(calls.at(-1)!.init!.body)).params).toMatchObject({scope_ids:['r1','r2'],scope_envelope_ids:[kind==='line'?'l':'w']});
 }
 for(const tool of ['preview_alignment','start_alignment']){
  await expect(registry.call(tool,{project_id:'p',model_id:'m',scope_ids:['r1','r2'],scope_line_ids:['l']},f)).rejects.toMatchObject({status:422});
  await expect(registry.call(tool,{project_id:'p',model_id:'m',scope_word_ids:['missing']},f)).rejects.toMatchObject({status:422});
  await expect(registry.call(tool,{project_id:'p',revision:'old',model_id:'m',scope_line_ids:['l']},f)).rejects.toMatchObject({status:412});
 }
});
it('diagnoses short units, exact boundary vowels and missing timing in both M8 modes',async()=>{
 const doc=fixture();doc.lyrics.lines.push({...createLine('','same'),words:[{...createWord('か','a'),beginMs:100,endMs:160},{...createWord('あ','b'),beginMs:160,endMs:500}]});
 doc.lyrics.lines.push({...createLine('え','missing')});doc.lyrics.lines.push(createLine('う','skip'));doc.editing.skippedAlignmentLineIds=['skip'];doc.lineOrder=['same','l','missing','skip'];
 const f=projectFixture(doc),registry=createToolRegistry();
 const args={project_id:'p'};
 const balanced=await registry.call('inspect_alignment_anomalies',args,f) as {anomalies:{line_id:string;line_number:number;reasons:string[]}[]};
 expect(balanced).toMatchObject({scanned_lines:3,anomaly_count:3});
 expect(balanced.anomalies.find(a=>a.line_id==='l')).toMatchObject({line_number:2});
 expect(balanced.anomalies.find(a=>a.line_id==='l')?.reasons).toContain('short_unit');
 expect(balanced.anomalies.find(a=>a.line_id==='same')?.reasons).toContain('same_vowel_imbalance');
 const conservative=await registry.call('inspect_alignment_anomalies',{...args,mode:'conservative'},f) as typeof balanced;
 expect(conservative.anomalies.map(a=>a.line_id)).toEqual(['same','missing']);
 expect(await registry.call('inspect_alignment_anomalies',{...args,line_ids:['l'],short_threshold_ms:30},f)).toMatchObject({anomaly_count:0});
 expect(f.writes()).toBe(0);
});
it('splits non-ruby body words while preserving existing ruby words in the same row',async()=>{
 const doc=fixture();doc.lyrics.lines[0].words.push(createWord('べる','ok'));
 const f=projectFixture(doc),registry=createToolRegistry();
 const result=await registry.call('segment_lyrics',{project_id:'p',target:'words',scope:{all:true},dry_run:false,options:{japanese_mora:true}},f);
 expect(result).toMatchObject({changed_count:1,skipped_existing_ruby_count:1,blocked_count:0});
 expect(f.doc().lyrics.lines[0].words.map(w=>w.text)).toEqual(['愛','べ','る']);
 expect(f.doc().lyrics.lines[0].words[0]).toEqual(doc.lyrics.lines[0].words[0]);expect(f.writes()).toBe(1);
});

it('reports discontiguous pronounceable targets without rejecting and keeps metadata off HTTP options', async()=>{
 const doc=fixture();
 const row=(id:string,text:string,beginMs:number)=>({...createLine('',id),beginMs,endMs:beginMs+500,words:[{...createWord(text,`${id}-w`),beginMs,endMs:beginMs+500}]});
 doc.lyrics.lines.push(row('middle','声',2500),row('last','あ',3500));
 doc.lineOrder=['l','middle','last'];
 const calls:{url:URL;init?:RequestInit}[]=[];
 const f=projectFixture(doc,(url,init)=>{calls.push({url,init});return Response.json(url.pathname.endsWith('/jobs')?{items:[]}:url.pathname.endsWith('/alignment-preview')?{model_preview:'token',emitting_count:3}:{id:'j',project_id:'p',kind:'alignment',status:'queued'});});
 const registry=createToolRegistry(),base={project_id:'p',model_id:'m'};
 for(const scope of [{scope_line_ids:['l','last']},{scope_word_ids:['w','last-w']}]){
  expect(await registry.call('preview_alignment',{...base,...scope},f)).toMatchObject({envelope_ms:[scope.scope_line_ids?100:200,4000],warnings:[expect.stringMatching(/1 unselected pronounceable.*lines 2–2/)]});
  await registry.call('start_alignment',{...base,...scope},f);
  const params=JSON.parse(String(calls.at(-1)!.init!.body)).params;
  expect(params).not.toHaveProperty('warnings');expect(params).not.toHaveProperty('envelope_ms');
 }
 expect(await registry.call('preview_alignment',{...base,scope_ids:['r1','r2']},f)).toMatchObject({envelope_ms:[300,1000]});
 for(const text of ['','   ','、!?']){
  doc.lyrics.lines[1].words[0].text=text;
  const blank=projectFixture(doc,()=>Response.json({model_preview:'token',emitting_count:3}));
  expect(await registry.call('preview_alignment',{...base,scope_line_ids:['l','last']},blank)).not.toHaveProperty('warnings');
 }
 expect(await registry.call('preview_alignment',{...base,scope_line_ids:['l','middle']},f)).not.toHaveProperty('warnings');
 expect(await registry.call('preview_alignment',base,f)).not.toHaveProperty('envelope_ms');
});
