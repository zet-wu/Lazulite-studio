import {expect,it} from 'vitest';
import {createLine,createLyricDocument} from '../src/domain/lyric-document';
import {clearTimelineTimes,assignTimeline,type TimelineTarget} from '../src/domain/timeline-editing';
import {createProjectDocument,createProjectEditorState,executeProjectCommand,undoProjectCommand,redoProjectCommand} from '../src/domain/project-document';
import {serializeLyricTtml,parseLyricTtml} from '../src/adapters/ttml/lyric-codec';
function sample(){
 const doc=createLyricDocument('愛');const line=doc.lines[0],word=line.words[0];
 line.beginMs=1000;line.endMs=4000;word.beginMs=1200;word.endMs=3500;
 word.rubyUnits=[{id:'ruby',reading:'あい',beginMs:1300,endMs:3200}];
 doc.lines.push({...createLine('影','bg'),backgroundOf:line.id,beginMs:0,endMs:5000});
 for(const key of ['romanizationTracks','translationTracks'] as const)doc[key]=[{id:key,language:'ja',purpose:'subtitle',contents:[{id:`${key}-content`,kind:'timed',lineId:line.id,units:[{id:`${key}-unit`,text:'ai',beginMs:1400,endMs:3600}]}]}];
 const targets:TimelineTarget[]=[{kind:'line',lineId:line.id},{kind:'word',lineId:line.id,wordId:word.id},{kind:'ruby',lineId:line.id,wordId:word.id,rubyId:'ruby'},...(['romanizationTracks','translationTracks'] as const).map(key=>({kind:'romanization' as const,...(key==='translationTracks'?{attachment:'translation' as const}:{}),lineId:line.id,trackId:key,contentId:`${key}-content`,unitId:`${key}-unit`}))];
 return {doc,line,word,targets};
}
it('clears only a line itself and retains children, background, text and configuration across one history step',()=>{
 const {doc,line,targets}=sample(),project=createProjectDocument(doc);project.editing.emptyBeats[doc.lines[0].words[0].id]={kind:'word',count:2};
 const cleared=clearTimelineTimes(doc,[targets[0]],project.editing);
 expect(cleared.lines[0]).toEqual({...line,beginMs:null,endMs:null});expect(cleared.lines[0].words).toBe(line.words);expect(cleared.lines[1]).toBe(doc.lines[1]);expect(cleared.romanizationTracks).toBe(doc.romanizationTracks);expect(cleared.translationTracks).toBe(doc.translationTracks);
 const state=executeProjectCommand(createProjectEditorState(project),{type:'lyrics',command:{type:'replace-document',document:cleared}});
 expect(state.past).toHaveLength(1);expect(state.present.editing).toBe(project.editing);
 expect(undoProjectCommand(state).present).toBe(project);expect(redoProjectCommand(undoProjectCommand(state)).present).toBe(state.present);
 const reopened=parseLyricTtml(serializeLyricTtml(cleared,{draft:true}),{draft:true});expect(reopened.lines[0].beginMs).toBeNull();expect(reopened.lines[0].words[0].beginMs).toBe(1200);
 const reassigned=assignTimeline(cleared,targets[0],6000,10000);expect(reassigned.lines[0].beginMs).toBeLessThanOrEqual(1200);expect(reassigned.lines[0].endMs).toBeGreaterThanOrEqual(3600);
});
it('clears each child kind without changing ancestors or siblings',()=>{
 for(let i=1;i<5;i++){
  const {doc,line,word,targets}=sample(),next=clearTimelineTimes(doc,[targets[i]]);
  expect(next.lines[0]).toMatchObject({beginMs:1000,endMs:4000});expect(next.lines[1]).toBe(doc.lines[1]);
  const reopened=parseLyricTtml(serializeLyricTtml(next,{draft:true}),{draft:true});expect(reopened.lines[0].words[0].beginMs).toBe(next.lines[0].words[0].beginMs);
  if(i===1){expect(next.lines[0].words[0]).toEqual({...word,beginMs:null,endMs:null});expect(next.lines[0].words[0].rubyUnits).toBe(word.rubyUnits);}
  if(i===2){expect(next.lines[0].words[0]).toMatchObject({beginMs:1200,endMs:3500});expect(next.lines[0].words[0].rubyUnits[0]).toMatchObject({beginMs:null,endMs:null});}
  if(i>=3){expect(next.lines[0]).toBe(line);const key=i===3?'romanizationTracks':'translationTracks';expect(next[key][0].contents[0]).toMatchObject({units:[{beginMs:null,endMs:null,text:'ai'}]});}
 }
});
it('clears a multi-selection atomically and rejects links at either end without altering source',()=>{
 const {doc,line,targets}=sample(),project=createProjectDocument(doc);
 const second={...createLine('次','next'),beginMs:4000,endMs:6000};doc.lines.push(second);project.editing.endLinks[line.id]=second.id;
 const original=structuredClone(doc);
 for(const lineId of [line.id,second.id])expect(()=>clearTimelineTimes(doc,[targets[1],{kind:'line',lineId}],project.editing)).toThrow(/timeline.clearLinked/);
 expect(doc).toEqual(original);
 const next=clearTimelineTimes(doc,[targets[1],targets[2]]);expect(next.lines[0].words[0]).toMatchObject({beginMs:null,endMs:null,rubyUnits:[{beginMs:null,endMs:null}]});
});

it('preserves explicit missing background endpoints through a draft roundtrip',()=>{
 const {doc}=sample();Object.assign(doc.lines[1].words[0],{beginMs:100,endMs:4500});
 const next=clearTimelineTimes(doc,[{kind:'line',lineId:'bg'}]);
 const reopened=parseLyricTtml(serializeLyricTtml(next,{draft:true}),{draft:true});
 expect(reopened.lines[1]).toMatchObject({id:'bg',beginMs:null,endMs:null,words:[{beginMs:100,endMs:4500}]});
});
