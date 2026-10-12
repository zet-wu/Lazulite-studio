import { expect, it } from 'vitest';
import { createLine, createWord, createLyricDocument } from '../src/domain/lyric-document';
import { createProjectDocument, createProjectEditorState, executeProjectCommand, undoProjectCommand, redoProjectCommand } from '../src/domain/project-document';
import { planSelectionAction, type ObjectSelection } from '../src/domain/selection-editing';
import { parseProject, serializeProject } from '../src/adapters/project-codec';
import { parseLyricTtml, serializeLyricTtml } from '../src/adapters/ttml/lyric-codec';
import { copySelection, deleteSelection, pasteRich } from '../src/features/editor/editing-actions';
import { documentTargets, targetInterval } from '../src/features/editor/selection-targets';
import { moveTimeline } from '../src/domain/timeline-editing';
function fixture() {
  const lyrics=createLyricDocument();
  lyrics.lines=['a','b','c','d'].map((id,i)=>({...createLine('',id),beginMs:1000+i*1000,endMs:2000+i*1000,words:[{...createWord(id,id+'w'),beginMs:1000+i*1000,endMs:2000+i*1000}]}));
  lyrics.agents=[{id:'v1',name:null,type:'person'},{id:'v2',name:null,type:'person'}];
  lyrics.lines[1].agentRefs=['v2','v1'];lyrics.lines[2].agentRefs=['v1'];lyrics.lines[2].songPart='Custom';
  lyrics.translationTracks=[{id:'t',language:'en',purpose:'subtitle',contents:[{id:'tc',kind:'plain',lineId:'c',text:' C '},{id:'ta',kind:'timed',lineId:'a',units:[{id:'tu',text:'A',beginMs:1000,endMs:1500}]},{id:'tb',kind:'plain',lineId:'b',text:'B'}]}];
  lyrics.romanizationTracks=[{id:'r',language:'ja-Latn',contents:[{id:'ra',kind:'plain',lineId:'a',text:'A'},{id:'rc',kind:'plain',lineId:'c',text:' C'}]}];
  const project=createProjectDocument(lyrics);
  project.karaoke.groups=[{id:'g',name:'G'}];project.karaoke.lineGroups={a:'',b:'',c:'g',d:'g'};
  return project;
}
it('merges the entire main selection with separately inherited attributes, attached contents, backgrounds and atomic roundtrip',()=>{
  const project=fixture();
  const bg={...createLine('背景','bg'),backgroundOf:'b',agentRefs:['v1']};project.lyrics.lines.splice(2,0,bg);project.lineOrder=['a','bg','b','c','d'];project.karaoke.lineGroups.bg='g';
  project.editing.skippedAlignmentLineIds=['a','b','c'];project.editing.ignoredSyncLineIds=['a'];
  project.karaoke.cues=[{id:'before-a1',text:'x',beginMs:0,endMs:100,anchor:{kind:'before',lineId:'a'}},{id:'before-a2',text:'x',beginMs:200,endMs:300,anchor:{kind:'before',lineId:'a'}},{id:'before-b',text:'x',beginMs:100,endMs:200,anchor:{kind:'before',lineId:'b'}},{id:'before-bg',text:'x',beginMs:100,endMs:200,anchor:{kind:'before',lineId:'bg'}}];
  const state=createProjectEditorState(project),next=executeProjectCommand(state,{type:'lyrics',command:{type:'merge-lines',lineIds:['c','a','b']}});
  const merged=next.present.lyrics.lines[0];
  expect(merged).toMatchObject({id:'a',agentRefs:['v2','v1'],songPart:'Custom',beginMs:1000,endMs:4000});
  expect(merged.words.map(word=>word.id)).toEqual(['aw','bw','cw']);
  expect(next.present.lyrics.translationTracks[0].contents.map(content=>[content.id,content.lineId])).toEqual([['ta','a'],['tb','a'],['tc','a']]);
  expect(next.present.lyrics.lines[1]).toEqual({...bg,backgroundOf:'a'});
  expect(next.present.lineOrder).toEqual(['bg','a','d']);
  expect(next.present.karaoke.lineGroups).toEqual({a:'g',bg:'g',d:'g'});
  expect(next.present.karaoke.cues.map(cue=>cue.id)).toEqual(['before-a1','before-a2','before-bg']);
  expect(next.present.editing.skippedAlignmentLineIds).toEqual(['a']);
  expect(next.present.editing.ignoredSyncLineIds).toEqual(['a']);
  expect(parseProject(serializeProject(next.present))).toEqual(next.present);
  expect(undoProjectCommand(next).present).toBe(project);expect(redoProjectCommand(undoProjectCommand(next)).present).toBe(next.present);
});
it('keeps outer boundaries only, freezes external source ends, and follows retained outgoing links',()=>{
  const project=fixture();
  for(const [id,target] of [['x','a'],['y','b'],['z','c'],['unrelated','d']] as const) {
    const end=project.lyrics.lines.find(line=>line.id===target)!.beginMs!;
    project.lyrics.lines.push({...createLine('',id),beginMs:0,endMs:end,words:[]});project.editing.endLinks[id]=target;
  }
  project.lyrics.lines.find(line=>line.id==='d')!.words=[];
  project.editing.endLinks.a='b';project.editing.endLinks.b='c';project.editing.endLinks.c='d';
  const next=executeProjectCommand(createProjectEditorState(project),{type:'lyrics',command:{type:'merge-lines',lineIds:['a','b','c']}});
  expect(next.present.editing.endLinks).toEqual({x:'a',a:'d',unrelated:'d'});
  expect(next.present.lyrics.lines.find(line=>line.id==='y')!.endMs).toBe(2000);
  const changed=executeProjectCommand(next,{type:'lyrics',command:{type:'set-line-time',lineId:'d',beginMs:4500,endMs:5000}});
  expect(changed.present.lyrics.lines[0].endMs).toBe(4500);
  expect(changed.present.lyrics.lines.find(line=>line.id==='y')!.endMs).toBe(2000);
});
it('drops earlier outgoing external boundary and never fills missing first pre-cue or unassigned groups',()=>{
  const project=fixture(); project.lyrics.lines[3].beginMs=2000;project.lyrics.lines[3].words=[];project.editing.endLinks.a='d';
  project.karaoke.lineGroups={a:'',b:'',c:'',d:''};
  project.karaoke.cues=[{id:'later',text:'x',beginMs:0,endMs:50,anchor:{kind:'before',lineId:'b'}}];
  const next=executeProjectCommand(createProjectEditorState(project),{type:'lyrics',command:{type:'merge-lines',lineIds:['a','b','c']}}).present;
  expect(next.editing.endLinks).toEqual({});expect(next.karaoke.cues).toEqual([]);expect(next.karaoke.lineGroups.a).toBe('');
});
it('retains word and Ruby cue identities on later main lines and never modifies explicit word singers',()=>{
  const project=fixture(),word=project.lyrics.lines[1].words[0];project.amll.noWordAgents=false;word.agentRefs=['v1'];
  word.rubyUnits=[{id:'r1',reading:'きょ',beginMs:2000,endMs:2200},{id:'r2',reading:'う',beginMs:2300,endMs:2500}];
  project.lyrics.lines[1].words.push({...createWord('tail','tail'),beginMs:2800,endMs:3000});
  project.karaoke.cues=[{id:'ruby',text:'x',beginMs:2200,endMs:2300,anchor:{kind:'ruby',lineId:'b',wordId:word.id,leftId:'r1',rightId:'r2'}},{id:'word',text:'x',beginMs:2600,endMs:2700,anchor:{kind:'word',lineId:'b',leftId:word.id,rightId:'tail'}}];
  const next=executeProjectCommand(createProjectEditorState(project),{type:'lyrics',command:{type:'merge-lines',lineIds:['a','b']}}).present;
  expect(next.lyrics.lines[0].words[1]).toBe(word);
  expect(next.karaoke.cues).toEqual(project.karaoke.cues.map(cue=>({...cue,anchor:{...cue.anchor,lineId:'a'}})));
});
it('rejects non-contiguous and mixed main/background selections and enforces the multiple-background setting',()=>{
  const project=fixture();project.lyrics.lines.push({...createLine('','bg1'),backgroundOf:'a'},{...createLine('','bg2'),backgroundOf:'b'});project.amll.noMultipleBackgrounds=true;
  const state=createProjectEditorState(project);
  for(const ids of [['a','c'],['a','bg1'],['a','b']])expect(()=>executeProjectCommand(state,{type:'lyrics',command:{type:'merge-lines',lineIds:ids}})).toThrow();
  expect(state.past).toEqual([]);
  project.amll.noMultipleBackgrounds=false;
  expect(executeProjectCommand(state,{type:'lyrics',command:{type:'merge-lines',lineIds:['a','b']}}).present.lyrics.lines.filter(line=>line.backgroundOf==='a')).toHaveLength(2);
});
function attached(kind:'plain'|'timed'='timed') {
  const project=fixture();project.lyrics.translationTracks[0].contents=['x','y','z'].map((id,i)=>kind==='plain'?{id,lineId:'a',kind,text:i===1?' ':id}:{id,lineId:'a',kind,units:[{id:id+'1',text:id+' ',beginMs:i===0?1000:null,endMs:i===2?3000:null},{id:id+'2',text:' ',beginMs:null,endMs:null}]});
  const selection:ObjectSelection={kind:'romanization-content',attachment:'translation',lineId:'a',trackId:'t',contentId:'x',ids:['z','x','y'],anchorId:'z',activeId:'x'};
  return {project,selection};
}
it.each(['plain','timed'] as const)('merges %s attached contents in original order, preserving unit identities',kind=>{
  const {project,selection}=attached(kind), before=project.lyrics.translationTracks[0].contents;
  const next=executeProjectCommand(createProjectEditorState(project),{type:'lyrics',command:planSelectionAction(project.lyrics,selection,'merge')}).present;
  const result=next.lyrics.translationTracks[0].contents[0];
  if(result.kind==='plain')expect(result.text).toBe('x z');
  else expect(result.units).toEqual(before.flatMap(content=>content.kind==='timed'?content.units:[]));
  expect(next.lyrics.romanizationTracks).toBe(project.lyrics.romanizationTracks);
});
it('merges timed translation units using known endpoints and rejects gaps or mixed content types',()=>{
  const {project,selection}=attached();const content=project.lyrics.translationTracks[0].contents[0];if(content.kind!=='timed')throw Error();content.units[1].endMs=2000;
  const units:ObjectSelection={...selection,kind:'romanization-unit',ids:['x2','x1']};
  const next=executeProjectCommand(createProjectEditorState(project),{type:'lyrics',command:planSelectionAction(project.lyrics,units,'merge')}).present;
  expect(next.lyrics.translationTracks[0].contents[0]).toMatchObject({units:[{id:'x1',text:'x  ',beginMs:1000,endMs:2000}]});
  expect(()=>planSelectionAction(project.lyrics,{...selection,ids:['x','z']},'merge')).toThrow(/连续/);
  project.lyrics.translationTracks[0].contents[1]={id:'y',kind:'plain',lineId:'a',text:'Y'};
  expect(()=>planSelectionAction(project.lyrics,selection,'merge')).toThrow(/混选/);
});
it('translation selection supports deletion, clipboard and timeline movement independently from body/romanization',()=>{
  const {project,selection}=attached();
  const clip=copySelection(project.lyrics,selection);expect(clip.attachment).toBe('translation');
  const pasted=pasteRich(project.lyrics,clip,{kind:'lines',ids:['b'],anchorId:'b',activeId:'b'});
  const next=executeProjectCommand(createProjectEditorState(project),{type:'lyrics',command:pasted.command}).present;
  expect(next.lyrics.translationTracks[0].contents.filter(content=>content.lineId==='b')).toHaveLength(3);
  expect(next.lyrics.romanizationTracks).toBe(project.lyrics.romanizationTracks);
  const removed=executeProjectCommand(createProjectEditorState(project),{type:'lyrics',command:deleteSelection(project.lyrics,selection)}).present;
  expect(removed.lyrics.translationTracks[0].contents).toEqual([]);
  const target=documentTargets(project.lyrics).find(target=>target.kind==='romanization'&&target.attachment==='translation')!;
  const interval=targetInterval(project.lyrics,target)!;interval.beginMs=1000;interval.endMs=2000;
  expect(targetInterval(moveTimeline(project.lyrics,[target],100),target)).toMatchObject({beginMs:1100,endMs:2100});
});
it('moves contiguous groups once, rejects cross-parent/gapped moves, batches beats and deduplicates Ruby parents',()=>{
  const project=fixture(),line=project.lyrics.lines[0];line.words=['one','two','three','four'].map(id=>createWord(id,id));
  const selection:ObjectSelection={kind:'words',lineId:'a',ids:['three','two'],anchorId:'three',activeId:'two'};
  const next=executeProjectCommand(createProjectEditorState(project),{type:'lyrics',command:planSelectionAction(project.lyrics,selection,'previous')});
  expect(next.present.lyrics.lines[0].words.map(word=>word.id)).toEqual(['two','three','one','four']);expect(next.past).toHaveLength(1);
  for(const ids of [['one','three'],['one','bw']])expect(()=>planSelectionAction(project.lyrics,{...selection,ids},'next')).toThrow();
  const beat=executeProjectCommand(next,{type:'lyrics',command:planSelectionAction(next.present.lyrics,selection,'beat',next.present.editing)});
  expect(Object.keys(beat.present.editing.emptyBeats)).toEqual(['two','three']);
  line.words[0].rubyUnits=[{id:'r1',reading:'あい',beginMs:null,endMs:null},{id:'r2',reading:'うえ',beginMs:null,endMs:null}];
  const ruby:ObjectSelection={kind:'ruby',lineId:'a',wordId:'one',ids:['r2','r1'],activeId:'r1',anchorId:'r2'};
  const command=planSelectionAction(project.lyrics,ruby,'redistribute');expect(command.type==='batch'&&command.commands).toHaveLength(1);
  const split=executeProjectCommand(createProjectEditorState(project),{type:'lyrics',command:planSelectionAction(project.lyrics,ruby,'mora')});expect(split.present.lyrics.lines[0].words[0].rubyUnits.map(unit=>unit.reading)).toEqual(['あ','い','う','え']);
});
it('sets arbitrary song parts atomically, no-op adds no history, and preserves actual TTML songPart spelling',()=>{
  const project=fixture(),state=createProjectEditorState(project);
  const next=executeProjectCommand(state,{type:'lyrics',command:{type:'set-song-part',lineIds:['a','b'],value:'My Verse'}});
  expect(next.past).toHaveLength(1);
  expect(executeProjectCommand(next,{type:'lyrics',command:{type:'set-song-part',lineIds:['a','b'],value:'My Verse'}})).toBe(next);
  const xml=serializeLyricTtml(next.present.lyrics,{draft:true});expect(xml).toContain('itunes:songPart="My Verse"');expect(xml).not.toContain('song-part');
  expect(parseLyricTtml(xml,{draft:true}).lines.slice(0,2).map(line=>line.songPart)).toEqual(['My Verse','My Verse']);
  const cleared=executeProjectCommand(next,{type:'lyrics',command:{type:'set-song-part',lineIds:['a','b'],value:' \t　'}});
  expect(cleared.present.lyrics.lines[0].songPart).toBeNull();expect(serializeLyricTtml(cleared.present.lyrics,{draft:true})).not.toContain('songPart=\"\"');expect(undoProjectCommand(cleared).present).toBe(next.present);
});
