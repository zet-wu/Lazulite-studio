import { createKaraoke } from '../src/domain/karaoke';
import { it, expect } from 'vitest';
import { createLine, createLyricDocument } from '../src/domain/lyric-document';
import { createProjectDocument, createProjectEditorState, executeProjectCommand, undoProjectCommand, redoProjectCommand } from '../src/domain/project-document';
import { mergeAlignment, type AlignmentResult } from '../src/domain/alignment';
import { parseProject, serializeProject } from '../src/adapters/project-codec';
function fixture(){const p=createProjectDocument(createLyricDocument());p.lyrics.lines=[createLine('あ','a'),createLine('い','b')];p.karaoke=createKaraoke(p.lyrics);return p;}
function result(p:ReturnType<typeof fixture>, times:([number|null,number|null])[]):AlignmentResult{
  const words=p.lyrics.lines.flatMap(l=>l.words.map(w=>({line:l,word:w})));
  const value:AlignmentResult = {scope:[],kind:'alignment',binding:{project_id:'p',revision:'r',asset_id:'a'},acoustics:null,
    mapping:times.map((_,i)=>({unit_id:`u${i}`,object_id:words[i].word.id,word_id:words[i].word.id,line_id:words[i].line.id,kind:'word'})),
    alignment:{schema:'lazulite-japanese-result-v1',units:times.map(([a,b],i)=>({unit_id:`u${i}`,line_id:words[i].line.id,proposed_timing:{start:a===null?null:{time:a,source:'acoustic_path'},end:b===null?null:{time:b,source:'acoustic_path'}}}))}};
  value.scope=scopeFor(p,value); return value;
}
function scopeFor(p:ReturnType<typeof fixture>, r:AlignmentResult):AlignmentResult['scope'] {
 return p.lyrics.lines.filter(l=>!p.editing.skippedAlignmentLineIds.includes(l.id)).flatMap(l=>l.words.flatMap(w=>(w.rubyUnits.length?w.rubyUnits:[w]).map(o=>({object_id:o.id,word_id:w.id,line_id:l.id,kind:w.rubyUnits.length?'ruby' as const:'word' as const,target_ids:r.mapping.filter(m=>m.object_id===o.id).map(m=>m.unit_id)}))));
}
it('applies draft times and acoustics once, with undo/redo and save fidelity',()=>{
 const p=fixture(),r=result(p,[[1,2],[3,4]]);r.acoustics={analysisId:'stem',segments:[{id:'s',beginMs:0,endMs:5000}]};
 const adopted=mergeAlignment(p,r,5000).project,state=executeProjectCommand(createProjectEditorState(p),{type:'alignment',source:p,project:adopted});
 expect(state.past).toHaveLength(1);expect(state.present.lyrics.lines.map(l=>l.beginMs)).toEqual([1000,3000]);
 expect(undoProjectCommand(state).present).toBe(p);expect(redoProjectCommand(undoProjectCommand(state)).present).toEqual(adopted);
 expect(parseProject(serializeProject(adopted))).toEqual(adopted);
 expect(()=>executeProjectCommand(state,{type:'alignment',source:p,project:adopted})).toThrow(/改变/);
});
it('preserves absent, inverted, out-of-range and quantized-zero suggestions locally',()=>{
 const p=fixture();p.lyrics.lines[0].words[0].beginMs=100;p.lyrics.lines[0].words[0].endMs=500;
 for(const pair of [[null,null],[1,null],[-1,2],[1,9],[.1001,.1002]] as [number|null,number|null][]){
  const next=mergeAlignment(p,result(p,[pair,[2,3]]),5000);
  expect(next.project.lyrics.lines[0].words[0]).toEqual(p.lyrics.lines[0].words[0]);expect(next.project.lyrics.lines[1].beginMs).toBe(2000);
 }
 const one=mergeAlignment(p,result(p,[[.2,null],[2,null]]),5000).project;
 expect(one.lyrics.lines[0].words[0]).toMatchObject({beginMs:200,endMs:500});expect(one.lyrics.lines[1]).toMatchObject({beginMs:2000,endMs:null});
});
it('keeps a missing leading boundary and avoids history when all proposals are absent',()=>{
 const p=fixture(),r=result(p,[[null,null]]);r.mapping.push({...r.mapping[0],unit_id:'middle'});r.alignment.units.push({unit_id:'middle',line_id:'a',proposed_timing:{start:{time:2,source:'x'},end:{time:3,source:'x'}}});
 r.scope=scopeFor(p,r);
 expect(mergeAlignment(p,r,5000).project.lyrics.lines[0].words[0]).toMatchObject({beginMs:null,endMs:3000});
 expect(mergeAlignment(p,result(p,[[null,null],[null,null]]),5000).project).toBe(p);
});
it('freezes skipped rows and restores cross-boundary links on undo',()=>{
 const p=fixture();p.lyrics.lines[0].beginMs=0;p.lyrics.lines[0].endMs=1000;p.lyrics.lines[1].beginMs=1000;p.editing.skippedAlignmentLineIds=['a'];p.editing.endLinks={a:'b'};
 const r=result(p,[[2,3]]);r.mapping[0]={...r.mapping[0],line_id:'b',word_id:p.lyrics.lines[1].words[0].id,object_id:p.lyrics.lines[1].words[0].id};r.alignment.units[0].line_id='b';
 r.scope=scopeFor(p,r);
 const next=mergeAlignment(p,r,5000).project;
 expect(next.lyrics.lines[0]).toEqual(p.lyrics.lines[0]);expect(next.editing.endLinks).toEqual({});
 expect(undoProjectCommand(executeProjectCommand(createProjectEditorState(p),{type:'alignment',source:p,project:next})).present.editing.endLinks).toEqual({a:'b'});
});

it('clears missing endpoints but preserves illegal proposals and first/last target boundaries',()=>{
 const p=fixture();Object.assign(p.lyrics.lines[0].words[0],{beginMs:1000,endMs:2000});
 let r=result(p,[[3,null],[null,null]]);
 const next=mergeAlignment(p,r,5000,true);
 expect(next.project.lyrics.lines[0].words[0]).toMatchObject({beginMs:3000,endMs:null});expect(next.cleared).toHaveLength(1);
 expect(next.retained).toHaveLength(0);expect(next.project.lyrics.lines[0]).toMatchObject({beginMs:3000,endMs:null});
 for(const pair of [[4,3],[-1,null],[1,9],[1.0001,1.0002]] as [number|null,number|null][]){
  r=result(p,[pair,[2,3]]);const merged=mergeAlignment(p,r,5000,true);
  expect(merged.project.lyrics.lines[0].words[0]).toEqual(p.lyrics.lines[0].words[0]);expect(merged.retained).toHaveLength(1);expect(merged.cleared).toHaveLength(0);
 }
 r=result(p,[[null,null],[null,null]]);r.mapping.push({...r.mapping[0],unit_id:'middle'});r.alignment.units.push({unit_id:'middle',line_id:'a',proposed_timing:{start:{time:2,source:'interpolated'},end:{time:3,source:'interpolated'}}});r.scope=scopeFor(p,r);
 expect(mergeAlignment(p,r,5000,true).project.lyrics.lines[0].words[0]).toMatchObject({beginMs:null,endMs:3000});
});

it('clears omitted punctuation/empty leaves and stale parents without losing a voiced envelope',()=>{
 const p=fixture();p.lyrics.lines=[createLine('♪あ！','a'),createLine('','b')];
 // Explicit separate words: scope, not frontend character guessing, owns omission.
 const voice=createLine('あ','temp').words[0],left=createLine('♪','temp2').words[0],right=createLine('！','temp3').words[0];
 p.lyrics.lines[0].words=[left,voice,right];
 for(const w of p.lyrics.lines[0].words) Object.assign(w,{beginMs:100,endMs:4000});
 Object.assign(p.lyrics.lines[1],{beginMs:100,endMs:4000});
 const r=result(p,[[1,2]]);r.mapping[0]={...r.mapping[0],object_id:voice.id,word_id:voice.id};r.scope=scopeFor(p,r);
 const merged=mergeAlignment(p,r,5000,true);
 expect(merged.project.lyrics.lines[0]).toMatchObject({beginMs:1000,endMs:2000});
 expect(merged.project.lyrics.lines[0].words[0]).toMatchObject({text:'♪',beginMs:null,endMs:null});
 expect(merged.project.lyrics.lines[0].words[2]).toMatchObject({text:'！',beginMs:null,endMs:null});
 expect(merged.project.lyrics.lines[1]).toMatchObject({beginMs:null,endMs:null});expect(merged.cleared).toHaveLength(2);
 const state=executeProjectCommand(createProjectEditorState(p),{type:'alignment',source:p,project:merged.project});
 expect(state.past).toHaveLength(1);expect(undoProjectCommand(state).present).toBe(p);
 expect(parseProject(serializeProject(redoProjectCommand(undoProjectCommand(state)).present))).toEqual(merged.project);
 const again=mergeAlignment(merged.project,r,5000,true);expect(again.project).toBe(merged.project);expect(again.cleared).toHaveLength(0);
});

it('rejects missing expected targets, duplicate scope and a missing leaf even when clearing',()=>{
 const p=fixture();
 for(const mutate of [
  (r:AlignmentResult)=>{r.mapping.pop();r.alignment.units.pop();},
  (r:AlignmentResult)=>{r.scope.pop();},
  (r:AlignmentResult)=>{r.scope.push(r.scope[0]);},
  (r:AlignmentResult)=>{r.alignment.units[0].unit_id='wrong';},
  (r:AlignmentResult)=>{r.mapping[0].kind='ruby';},
 ]){const r=result(p,[[1,2],[3,4]]);mutate(r);expect(()=>mergeAlignment(p,r,5000,true)).toThrow();}
});

it('rebuilds Ruby and row envelopes with partial singing boundaries and excludes omitted Ruby',()=>{
 const p=fixture(),w=p.lyrics.lines[0].words[0];
 w.rubyUnits=[{id:'r1',reading:'あ',beginMs:100,endMs:500},{id:'r2',reading:'い',beginMs:500,endMs:900},{id:'r3',reading:'！',beginMs:900,endMs:1000}];
 Object.assign(w,{beginMs:100,endMs:1000});
 const r=result(p,[[null,2],[3,4]]);r.mapping[0]={unit_id:'u0',object_id:'r1',word_id:w.id,line_id:'a',kind:'ruby'};
 r.mapping.push({unit_id:'last',object_id:'r2',word_id:w.id,line_id:'a',kind:'ruby'});r.alignment.units.push({unit_id:'last',line_id:'a',proposed_timing:{start:{time:2,source:'profile_hold'},end:{time:3,source:'profile_hold'}}});r.scope=scopeFor(p,r);
 const merged=mergeAlignment(p,r,5000,true);
 expect(merged.project.lyrics.lines[0]).toMatchObject({beginMs:null,endMs:3000});
 expect(merged.project.lyrics.lines[0].words[0]).toMatchObject({beginMs:null,endMs:3000});
 expect(merged.project.lyrics.lines[0].words[0].rubyUnits[2]).toMatchObject({reading:'！',beginMs:null,endMs:null});
 expect(parseProject(serializeProject(merged.project))).toEqual(merged.project);
 expect(merged.cleared).toHaveLength(2);
});

it('clearing freezes skipped rows and independent tracks, and clears stale Ruby parents',()=>{
 const p=fixture();p.editing.skippedAlignmentLineIds=['b'];Object.assign(p.lyrics.lines[1],{beginMs:1000,endMs:2000});Object.assign(p.lyrics.lines[1].words[0],{beginMs:1000,endMs:2000});
 p.lyrics.romanizationTracks=[{id:'rom',language:'ja-Latn',contents:[{id:'rom-content',lineId:'a',kind:'timed',units:[{id:'rom-u',text:'a',beginMs:100,endMs:900}]}]}];
 p.lyrics.translationTracks=[{id:'trans',language:'en',purpose:'subtitle',contents:[{id:'trans-content',lineId:'a',kind:'timed',units:[{id:'trans-u',text:'hi',beginMs:100,endMs:900}]}]}];
 const w=p.lyrics.lines[0].words[0];Object.assign(w,{beginMs:100,endMs:900});Object.assign(p.lyrics.lines[0],{beginMs:100,endMs:900});w.rubyUnits=[{id:'empty-ruby',reading:'',beginMs:null,endMs:null}];
 p.lyrics.lines.push(createLine('う','c'));
 const r=result(p,[[1,2]]),voice=p.lyrics.lines[2].words[0];r.mapping[0]={unit_id:'u0',object_id:voice.id,word_id:voice.id,line_id:'c',kind:'word'};r.alignment.units[0].line_id='c';r.scope=scopeFor(p,r);
 const merged=mergeAlignment(p,r,5000,true);
 expect(merged.project.lyrics.lines[0]).toMatchObject({beginMs:null,endMs:null});expect(merged.project.lyrics.lines[0].words[0]).toMatchObject({beginMs:null,endMs:null});
 expect(merged.project.lyrics.lines[1]).toEqual(p.lyrics.lines[1]);
 expect(merged.project.lyrics.romanizationTracks).toEqual(p.lyrics.romanizationTracks);expect(merged.project.lyrics.translationTracks).toEqual(p.lyrics.translationTracks);
 expect(merged.cleared).toEqual([]);expect(merged.retained).toEqual([]);
});

it('does not clear a multi-target object when only its middle suggestion is missing',()=>{
 const p=fixture(),r=result(p,[[1,null],[3,4]]);
 r.mapping.splice(1,0,{...r.mapping[0],unit_id:'middle'},{...r.mapping[0],unit_id:'last'});
 r.alignment.units.push({unit_id:'middle',line_id:'a',proposed_timing:{start:null,end:null}},{unit_id:'last',line_id:'a',proposed_timing:{start:null,end:{time:2,source:'interpolated'}}});r.scope=scopeFor(p,r);
 expect(mergeAlignment(p,r,5000,true).project.lyrics.lines[0].words[0]).toMatchObject({beginMs:1000,endMs:2000});
});
