import { expect, it } from 'vitest';
import { createLine, createLyricDocument } from '../src/domain/lyric-document';
import { createProjectDocument, createProjectEditorState, executeProjectCommand, undoProjectCommand, redoProjectCommand } from '../src/domain/project-document';
import { mergeAlignment, type AlignmentResult } from '../src/domain/alignment';
import { parseProject, serializeProject } from '../src/adapters/project-codec';
function fixture() {
 const p=createProjectDocument(createLyricDocument());
 p.lyrics.lines=[createLine('あ','a')];p.lyrics.lines[0].words=['あ','い','う'].map((text,i)=>createLine(text,`temp${i}`).words[0]);
 p.acoustics={analysisId:'stem',segments:[{id:'s',beginMs:0,endMs:10000}]};return p;
}
function result(p:ReturnType<typeof fixture>, times:([number|null,number|null]|null)[]):AlignmentResult {
 const r:AlignmentResult={kind:'alignment',binding:{project_id:'p',revision:'r',asset_id:'a'},scope:[],mapping:[],alignment:{schema:'lazulite-japanese-result-v1',units:[]},acoustics:null};let i=0;
 for(const l of p.lyrics.lines.filter(l=>!p.editing.skippedAlignmentLineIds.includes(l.id)))for(const w of l.words)for(const leaf of w.rubyUnits.length?w.rubyUnits:[w]) {
  const pair=times[i++],uid=`u${i}`,kind=w.rubyUnits.length?'ruby':'word';
  r.scope.push({object_id:leaf.id,word_id:w.id,line_id:l.id,kind,target_ids:pair?[uid]:[]});
  if(!pair)continue;
  r.mapping.push({object_id:leaf.id,word_id:w.id,line_id:l.id,kind,unit_id:uid});
  r.alignment.units.push({unit_id:uid,line_id:l.id,proposed_timing:{start:pair[0]===null?null:{time:pair[0],source:'interpolated'},end:pair[1]===null?null:{time:pair[1],source:'profile_hold'}}});
 }return r;
}
it.each([499,500,501,0,-1])('compares quantized original milliseconds strictly: gap %i',gap=>{
 const p=fixture(),r=result(p,[[1,2],[2+gap/1000,3],[3.2,4]]),raw=structuredClone(r);
 const m=mergeAlignment(p,r,10000,false,500);
 expect(m.project.lyrics.lines[0].words.map(w=>[w.beginMs,w.endMs])).toEqual([[1000,gap>0&&gap<500?2000+gap:2000],[2000+gap,3200],[3200,4000]]);
 expect(m.mergedGaps).toBe(gap>0&&gap<500?2:1);expect(r).toEqual(raw);
 expect(mergeAlignment(p,r,10000).project.lyrics.lines[0].words[0].endMs).toBe(2000);
});
it('quantizes before comparison and never extends a last leaf',()=>{
 const p=fixture(),r=result(p,[[1,2.0004],[2.4995,3],[3.4994,4]]);
 const m=mergeAlignment(p,r,10000,false,500);expect(m.mergedGaps).toBe(1);
 expect(m.project.lyrics.lines[0].words.map(w=>w.endMs)).toEqual([2000,3499,4000]);
});
it.each([false,true])('does not borrow old endpoints or jump unmatched/illegal singing leaves, clearing=%s',clear=>{
 for(const pair of [[null,null],[2.2,null],[null,2.4],[2.4,2.2],[-1,2.4],[2.2,20],[2.2001,2.2002]] as [number|null,number|null][]) {
  const p=fixture();Object.assign(p.lyrics.lines[0].words[1],{beginMs:2200,endMs:2400});
  const m=mergeAlignment(p,result(p,[[1,2],pair,[2.5,3]]),10000,clear,500);
  expect(m.mergedGaps).toBe(0);expect(m.project.lyrics.lines[0].words[0].endMs).toBe(2000);
 }
});
it.each([false,true])('only finally untimed omitted separators are transparent, clearing=%s',clear=>{
 for(const old of [[null,null],[2100,null],[null,2200],[2100,2200]] as [number|null,number|null][]) {
  const p=fixture();Object.assign(p.lyrics.lines[0].words[1],{text:' ',beginMs:old[0],endMs:old[1]});
  const m=mergeAlignment(p,result(p,[[1,2],null,[2.3,3]]),10000,clear,500);
  expect(m.mergedGaps).toBe(clear||old.every(t=>t===null)?1:0);
  expect(m.project.lyrics.lines[0].words[1]).toMatchObject({text:' ',beginMs:clear?null:old[0],endMs:clear?null:old[1]});
 }
});
it('extends within/across Ruby words and mixed leaves then rebuilds parents in one saved undo step',()=>{
 const p=fixture();
 p.lyrics.lines[0].words[0].rubyUnits=[{id:'r1',reading:'あ',beginMs:null,endMs:null},{id:'r2',reading:'い',beginMs:null,endMs:null}];
 p.lyrics.lines[0].words[1].rubyUnits=[{id:'r3',reading:'う',beginMs:null,endMs:null}];
 const r=result(p,[[1,2],[2.1,3],[3.2,4],[4.3,5]]);r.acoustics={analysisId:'new',segments:[{id:'new-s',beginMs:0,endMs:6000}]};
 const m=mergeAlignment(p,r,10000,true,500),words=m.project.lyrics.lines[0].words;
 expect(m.mergedGaps).toBe(3);expect(words[0].rubyUnits.map(x=>x.endMs)).toEqual([2100,3200]);expect(words[1].rubyUnits[0].endMs).toBe(4300);
 expect(words.map(w=>[w.beginMs,w.endMs])).toEqual([[1000,3200],[3200,4300],[4300,5000]]);
 const state=executeProjectCommand(createProjectEditorState(p),{type:'alignment',source:p,project:m.project});expect(state.past).toHaveLength(1);
 expect(undoProjectCommand(state).present).toBe(p);expect(redoProjectCommand(undoProjectCommand(state)).present).toEqual(m.project);
 expect(parseProject(serializeProject(m.project))).toEqual(m.project);
 const again=mergeAlignment(state.present,r,10000,true,500);expect(again.project).toBe(state.present);
 expect(executeProjectCommand(state,{type:'alignment',source:state.present,project:again.project})).toBe(state);
});
it.each([false,true])('uses continuous coverage of the adopted acoustic snapshot, new=%s',fresh=>{
 for(const [ranges,count] of [ [[[0,2100],[2200,10000]],0], [[[2100,10000],[0,2100]],1], [[[0,2150],[2100,10000]],1], [[],0] ] as [number[][],number][]) {
  const p=fixture(),r=result(p,[[1,2],[2.3,3],[4,5]]);
  const segments=ranges.map(([beginMs,endMs],i)=>({id:`s${i}`,beginMs,endMs}));
  if(fresh)r.acoustics={analysisId:'new',segments};else p.acoustics.segments=segments;
  expect(mergeAlignment(p,r,10000,false,500).mergedGaps).toBe(count);
 }
});
it('keeps rows separate and skipped rows and independent tracks protected',()=>{
 const p=fixture();p.lyrics.lines.push(createLine('え','b'),createLine('お','skip'));
 p.lyrics.lines[1].words.push(createLine('か','temp').words[0]);
 p.editing.skippedAlignmentLineIds=['skip'];Object.assign(p.lyrics.lines[2],{beginMs:1000,endMs:2000});p.editing.endLinks={skip:'a'};
 p.lyrics.translationTracks=[{id:'t',language:'en',purpose:'subtitle',contents:[{id:'tc',lineId:'a',kind:'timed',units:[{id:'tu',text:'hi',beginMs:100,endMs:900}]}]}];
 const r=result(p,[[1,2],[2.2,3],[3.2,4],[4.1,5],[5.2,6]]),m=mergeAlignment(p,r,10000,true,500);
 expect(m.mergedGaps).toBe(3);expect(m.project.lyrics.lines[0].endMs).toBe(4000);expect(m.project.lyrics.lines[1].words[0].endMs).toBe(5200);
 expect(m.project.lyrics.lines[2]).toEqual(p.lyrics.lines[2]);expect(m.project.lyrics.translationTracks).toEqual(p.lyrics.translationTracks);expect(m.project.editing.endLinks).toEqual({});
});
it('does not treat a broken mapping as a transparent separator',()=>{
 const p=fixture(),r=result(p,[[1,2],[2.1,2.2],[2.3,3]]);r.mapping.splice(1,1);r.alignment.units.splice(1,1);
 expect(()=>mergeAlignment(p,r,10000,true,500)).toThrow(/范围|映射/);
});
