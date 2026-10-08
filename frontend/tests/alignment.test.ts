import { it, expect } from 'vitest';
import { createLine, createLyricDocument } from '../src/domain/lyric-document';
import { createProjectDocument, createProjectEditorState, executeProjectCommand, undoProjectCommand, redoProjectCommand } from '../src/domain/project-document';
import { mergeAlignment, type AlignmentResult } from '../src/domain/alignment';
import { parseProject, serializeProject } from '../src/adapters/project-codec';
function fixture(){const p=createProjectDocument(createLyricDocument());p.lyrics.lines=[createLine('あ','a'),createLine('い','b')];return p;}
function result(p:ReturnType<typeof fixture>, times:([number|null,number|null])[]):AlignmentResult{
  const words=p.lyrics.lines.flatMap(l=>l.words.map(w=>({line:l,word:w})));
  return {kind:'alignment',binding:{project_id:'p',revision:'r',asset_id:'a'},acoustics:null,
    mapping:times.map((_,i)=>({unit_id:`u${i}`,object_id:words[i].word.id,word_id:words[i].word.id,line_id:words[i].line.id,kind:'word'})),
    alignment:{schema:'lazulite-japanese-result-v1',units:times.map(([a,b],i)=>({unit_id:`u${i}`,line_id:words[i].line.id,proposed_timing:{start:a===null?null:{time:a,source:'acoustic_path'},end:b===null?null:{time:b,source:'acoustic_path'}}}))}};
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
 expect(mergeAlignment(p,r,5000).project.lyrics.lines[0].words[0]).toMatchObject({beginMs:null,endMs:3000});
 expect(mergeAlignment(p,result(p,[[null,null],[null,null]]),5000).project).toBe(p);
});
it('freezes skipped rows and restores cross-boundary links on undo',()=>{
 const p=fixture();p.lyrics.lines[0].beginMs=0;p.lyrics.lines[0].endMs=1000;p.lyrics.lines[1].beginMs=1000;p.editing.skippedAlignmentLineIds=['a'];p.editing.endLinks={a:'b'};
 const r=result(p,[[2,3]]);r.mapping[0]={...r.mapping[0],line_id:'b',word_id:p.lyrics.lines[1].words[0].id,object_id:p.lyrics.lines[1].words[0].id};r.alignment.units[0].line_id='b';
 const next=mergeAlignment(p,r,5000).project;
 expect(next.lyrics.lines[0]).toEqual(p.lyrics.lines[0]);expect(next.editing.endLinks).toEqual({});
 expect(undoProjectCommand(executeProjectCommand(createProjectEditorState(p),{type:'alignment',source:p,project:next})).present.editing.endLinks).toEqual({a:'b'});
});
