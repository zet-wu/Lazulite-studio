import {expect,it} from 'vitest';
import {createLyricDocument,createLine,createWord} from '../src/domain/lyric-document';
import {parseLyricTtml,serializeLyricTtml} from '../src/adapters/ttml/lyric-codec';
import {createProjectDocument,createProjectEditorState,executeProjectCommand,undoProjectCommand} from '../src/domain/project-document';
import {parseProject,serializeProject} from '../src/adapters/project-codec';
import {applyLyricCommand} from '../src/domain/lyric-commands';
function rich() {
 const doc=createLyricDocument('main');doc.agents=[{id:'a',name:'A',type:'person'},{id:'b',name:null,type:'group'}];
 const main=doc.lines[0];main.agentRefs=['a'];
 for(const id of ['bg1','bg2']) {const bg=createLine(id,id);bg.backgroundOf=main.id;bg.agentRefs=id==='bg2'?['b']:[];doc.lines.push(bg);}
 doc.lines.forEach((line,i)=>{line.beginMs=i*1000;line.endMs=i*1000+500;line.words[0].beginMs=line.beginMs;line.words[0].endMs=line.endMs;});
 doc.lines[1].words[0].agentRefs=['b'];
 doc.translationTracks=[{id:'t',language:'en',purpose:'subtitle',contents:doc.lines.map(line=>({id:`t-${line.id}`,lineId:line.id,kind:'plain',text:`translation ${line.id}`}))}];
 doc.romanizationTracks=[{id:'r',language:'ja-Latn',contents:doc.lines.map(line=>({id:`r-${line.id}`,lineId:line.id,kind:'timed',units:[{id:`u-${line.id}`,text:`roman ${line.id}`,beginMs:line.beginMs,endMs:line.endMs}]}))}];return doc;
}
it('separately exchanges backgrounds, attachments and word singers',()=>{
 const doc=rich();expect(parseLyricTtml(serializeLyricTtml(doc,{draft:true}))).toEqual(doc);
 const formal=parseLyricTtml(serializeLyricTtml(doc,{draft:false}));
 expect(formal.lines.map(l=>[l.id,l.backgroundOf,l.agentRefs,l.words[0].agentRefs])).toEqual(doc.lines.map(l=>[l.id,l.backgroundOf,l.agentRefs,l.words[0].agentRefs]));
 expect(formal.translationTracks[0].contents.map(c=>[c.lineId,c.kind==='plain'?c.text:''])).toEqual(doc.translationTracks[0].contents.map(c=>[c.lineId,c.kind==='plain'?c.text:'']));
 expect(formal.romanizationTracks[0].contents.map(c=>[c.lineId,c.kind==='timed'?c.units[0].text:''])).toEqual(doc.romanizationTracks[0].contents.map(c=>[c.lineId,c.kind==='timed'?c.units[0].text:'']));
});
it('gates import, saves position and converts extra backgrounds in one undo',()=>{
 let state=createProjectEditorState(createProjectDocument());
 expect(()=>executeProjectCommand(state,{type:'lyrics',command:{type:'replace-document',document:rich()}})).toThrow();
 for(const rule of ['noWordAgents','noMultipleBackgrounds'] as const)state=executeProjectCommand(state,{type:'amll-setting',rule,enabled:false});
 state=executeProjectCommand(state,{type:'lyrics',command:{type:'replace-document',document:rich()}});
 state=executeProjectCommand(state,{type:'background-position',lineId:'bg2',before:true});expect(parseProject(serializeProject(state.present))).toEqual(state.present);
 const before=state;state=executeProjectCommand(state,{type:'amll-batch',rule:'noMultipleBackgrounds'});
 expect(state.present.lyrics.lines[0].id).toBe('bg2');expect(state.present.lyrics.lines[0].backgroundOf).toBeNull();expect(undoProjectCommand(state).present).toBe(before.present);
});
it('merges explicit and inherited same singers explicitly, then preserves split and rename',()=>{
 let doc=createLyricDocument('');doc.agents=[{id:'a',name:null,type:'person'}];const line=doc.lines[0];line.agentRefs=['a'];line.words=[createWord('one','w1'),{...createWord('two','w2'),agentRefs:['a']}];
 doc=applyLyricCommand(doc,{type:'merge-words',wordIds:['w1','w2']});expect(doc.lines[0].words[0].agentRefs).toEqual(['a']);
 doc=applyLyricCommand(doc,{type:'split-word',lineId:line.id,wordId:'w1',at:3,newWordId:'w3'});expect(doc.lines[0].words.map(w=>w.agentRefs)).toEqual([['a'],['a']]);
 doc=applyLyricCommand(doc,{type:'rename-agent',id:'a',nextId:'new'});expect(doc.lines[0].words[1].agentRefs).toEqual(['new']);
 doc=applyLyricCommand(doc,{type:'delete-agent',id:'new'});expect(doc.lines[0].words[1]).not.toHaveProperty('agentRefs');
});
it('keeps all preposed relative positions through conversion and save reopening',()=>{
 let state=createProjectEditorState({...createProjectDocument(rich()),amll:{simplified:false,noMultipleBackgrounds:false,noChorus:false,noWordAgents:false,noIndependentBackground:false}});
 for(const lineId of ['bg1','bg2'])state=executeProjectCommand(state,{type:'background-position',lineId,before:true});
 const order=state.present.lineOrder;
 state=executeProjectCommand(state,{type:'amll-batch',rule:'noMultipleBackgrounds'});
 expect(state.present.lineOrder).toEqual(order);
 expect(parseProject(serializeProject(state.present)).lineOrder).toEqual(order);
});
it('maps singers by reference order, preserves stable sides and locks dependencies',()=>{
 const doc=rich();doc.lines[0].agentRefs=['b','a'];
 let state=createProjectEditorState({...createProjectDocument(doc),amll:{simplified:false,noMultipleBackgrounds:false,noChorus:false,noWordAgents:false,noIndependentBackground:false}});
 state=executeProjectCommand(state,{type:'amll-batch',rule:'simplified',duetAgents:['b']});
 expect(state.present.lyrics.lines[0].agentRefs).toEqual(['v2']);
 expect(state.present.lyrics.lines.slice(1).every(l=>!l.agentRefs.length&&l.words.every(w=>!w.agentRefs))).toBe(true);
 const before=state;state=executeProjectCommand(state,{type:'amll-setting',rule:'simplified',enabled:true});
 expect(state.present.amll).toMatchObject({simplified:true,noChorus:true,noWordAgents:true,noIndependentBackground:true,noMultipleBackgrounds:false});
 expect(()=>executeProjectCommand(state,{type:'amll-setting',rule:'noWordAgents',enabled:false})).toThrow(/锁定/);
 expect(undoProjectCommand(state).present).toBe(before.present);
 state=executeProjectCommand(state,{type:'amll-setting',rule:'simplified',enabled:false});expect(state.present.amll.noWordAgents).toBe(true);
});
it('scope and no-op batches are atomic, singers are inherited on detached backgrounds',()=>{
 const doc=rich();doc.lines[1].agentRefs=['a','b'];doc.lines[2].agentRefs=['b','a'];
 let state=createProjectEditorState({...createProjectDocument(doc),amll:{simplified:false,noMultipleBackgrounds:false,noChorus:false,noWordAgents:false,noIndependentBackground:false}});
 state=executeProjectCommand(state,{type:'amll-batch',rule:'noChorus',ids:['bg1']});expect(state.present.lyrics.lines[1].agentRefs).toEqual(['a']);expect(state.present.lyrics.lines[2].agentRefs).toEqual(['b','a']);
 state=executeProjectCommand(state,{type:'amll-batch',rule:'noIndependentBackground',ids:['bg1']});expect(state.present.lyrics.lines[1].words[0]).not.toHaveProperty('agentRefs');
 expect(executeProjectCommand(state,{type:'amll-batch',rule:'noWordAgents'})).toBe(state);
 const detached=executeProjectCommand(state,{type:'lyrics',command:{type:'set-background-of',lineId:'bg1',parentLineId:null}});expect(detached.present.lyrics.lines.find(l=>l.id==='bg1')!.agentRefs).toEqual(['a']);
});
it('rejects cross-line inheritance loss and unequal merge, preserves effective singer on movement',()=>{
 let doc=createLyricDocument('');doc.agents=[{id:'a',name:null,type:'person'},{id:'b',name:null,type:'person'}];const from=doc.lines[0],to=createLine('');from.agentRefs=['a'];to.agentRefs=['b'];from.words=[createWord('one','w')];doc.lines.push(to);
 doc=applyLyricCommand(doc,{type:'move-word',lineId:from.id,wordId:'w',toLineId:to.id,afterWordId:null});expect(doc.lines[1].words[0].agentRefs).toEqual(['a']);
 doc.lines[1].words.push(createWord('two','w2'));expect(()=>applyLyricCommand(doc,{type:'merge-words',wordIds:['w','w2']})).toThrow(/统一/);
});

it('copies every background and attachment and remaps editing references',()=>{
 const doc=rich(),main=doc.lines[0];
 const editing=createProjectEditing();editing.ignoredSyncLineIds=['bg2'];editing.emptyBeats[doc.lines[1].words[0].id]={kind:'word',count:2};
 const selection={kind:'lines' as const,ids:[main.id],anchorId:main.id,activeId:main.id};
 const pasted=pasteRich(doc,copySelection(doc,selection,editing),selection);
 const result=applyLyricTransaction(doc,pasted.command,editing);
 const copied=result.lyrics.lines.filter(l=>!doc.lines.some(old=>old.id===l.id));
 expect(copied).toHaveLength(3);expect(copied.slice(1).map(l=>l.backgroundOf)).toEqual([copied[0].id,copied[0].id]);
 expect(copied.map(l=>l.words[0].agentRefs)).toEqual(doc.lines.map(l=>l.words[0].agentRefs));
 for(const track of [result.lyrics.translationTracks[0],result.lyrics.romanizationTracks[0]])expect(track.contents.slice(3).map(c=>c.lineId)).toEqual(copied.map(l=>l.id));
 expect(result.editing.ignoredSyncLineIds).toContain(copied[2].id);expect(result.editing.emptyBeats[copied[1].words[0].id].count).toBe(2);
});
it('splits with each background assigned separately, preserving attachments and singers',()=>{
 const doc=rich(),main=doc.lines[0];main.words=[{...createWord('first','w1'),beginMs:0,endMs:500,agentRefs:['b']},{...createWord('second','w2'),beginMs:1000,endMs:1500}];main.endMs=1500;
 const split=applyLyricCommand(doc,{type:'split-line',lineId:main.id,beforeWordIds:['w2'],newLineIds:['second'],contentTargets:{[`r-${main.id}`]:0},translationTargets:{[`t-${main.id}`]:1},backgroundTargets:{bg1:0,bg2:1}});
 expect(split.lines.map(l=>[l.id,l.backgroundOf])).toEqual([[main.id,null],['bg1',main.id],['second',null],['bg2','second']]);
 expect(split.lines[0].words[0].agentRefs).toEqual(['b']);expect(split.lines[3]).toEqual({...doc.lines[2],backgroundOf:'second'});
 expect(split.translationTracks[0].contents.find(c=>c.lineId==='bg2')).toEqual(doc.translationTracks[0].contents[2]);
});
it('moves the explicit preposed line set without expanding to intervening backgrounds',()=>{
 const doc=rich(),main=doc.lines[0];const shown=displayLines(doc,['bg2',main.id,'bg1']);
 const moved=moveTimeline(doc,[{kind:'line',lineId:shown[0].id},{kind:'line',lineId:shown[1].id}],500);
 expect(moved.lines.map(l=>l.beginMs)).toEqual([500,1000,2500]);
 expect(moved.translationTracks[0].contents).toEqual(doc.translationTracks[0].contents);
 expect(moved.romanizationTracks[0].contents.map(c=>c.kind==='timed'?c.units[0].beginMs:null)).toEqual([500,1000,2500]);
});
import {copySelection,pasteRich} from '../src/features/editor/editing-actions';
import {createProjectEditing} from '../src/domain/project-editing';
import {applyLyricTransaction} from '../src/domain/lyric-commands';
import {displayLines} from '../src/domain/amll-compatibility';
import {moveTimeline} from '../src/domain/timeline-editing';
it('final constraints reject indirect word assignment and no-op background cleanup keeps history',()=>{
 const doc=createLyricDocument('first');const other=createLine('second','other');doc.agents=[{id:'a',name:null,type:'person'},{id:'b',name:null,type:'person'}];doc.lines[0].agentRefs=['a'];other.agentRefs=['b'];doc.lines.push(other);
 const state=createProjectEditorState(createProjectDocument(doc));
 expect(()=>executeProjectCommand(state,{type:'lyrics',command:{type:'move-word',lineId:doc.lines[0].id,wordId:doc.lines[0].words[0].id,toLineId:other.id,afterWordId:null}})).toThrow(/禁用词级歌手/);
 expect(state.present.lyrics).toBe(doc);expect(state.past).toHaveLength(0);
 const one=rich();one.lines.splice(2);one.translationTracks[0].contents.splice(2);one.romanizationTracks[0].contents.splice(2);
 let positioned=createProjectEditorState({...createProjectDocument(one),amll:{simplified:false,noMultipleBackgrounds:false,noChorus:false,noWordAgents:false,noIndependentBackground:false}});
 positioned=executeProjectCommand(positioned,{type:'background-position',lineId:'bg1',before:true});
 expect(executeProjectCommand(positioned,{type:'amll-batch',rule:'noMultipleBackgrounds'})).toBe(positioned);
});
