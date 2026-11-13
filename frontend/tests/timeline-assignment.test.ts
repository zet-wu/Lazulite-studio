import {expect,it} from 'vitest';
import {createLyricDocument,createWord} from '../src/domain/lyric-document';
import {assignTimeline} from '../src/domain/timeline-editing';
import {createProjectDocument,createProjectEditorState,executeProjectCommand,undoProjectCommand,redoProjectCommand} from '../src/domain/project-document';
import {parseProject,serializeProject} from '../src/adapters/project-codec';
import {locateViewport} from '../src/domain/timeline-viewport';

it('fills a bounded gap and restores the entire parent expansion through undo, redo and persistence',()=>{
 const doc=createLyricDocument('a'),line=doc.lines[0];
 line.words=[{...createWord('a'),beginMs:100,endMs:300},createWord('b'),{...createWord('c'),beginMs:800,endMs:1000}];
 const target={kind:'word' as const,lineId:line.id,wordId:line.words[1].id};
 const next=assignTimeline(doc,target,500,5000);
 expect(next.lines[0].words[1]).toMatchObject({beginMs:300,endMs:800});
 expect(next.lines[0]).toMatchObject({beginMs:100,endMs:1000});
 const project=createProjectDocument(doc),state=executeProjectCommand(createProjectEditorState(project),{type:'lyrics',command:{type:'replace-document',document:next}});
 expect(state.past).toHaveLength(1);expect(undoProjectCommand(state).present).toBe(project);
 expect(redoProjectCommand(undoProjectCommand(state)).present.lyrics).toEqual(next);
 expect(parseProject(serializeProject(state.present)).lyrics).toEqual(next);
});
it('uses local average outside gaps and contains timed children without dividing unknown children',()=>{
 const doc=createLyricDocument('a'),line=doc.lines[0],word=line.words[0];
 word.rubyUnits=[{id:'r',reading:'a',beginMs:100,endMs:700},{id:'u',reading:'b',beginMs:null,endMs:null}];
 const target={kind:'word' as const,lineId:line.id,wordId:word.id};
 const next=assignTimeline(doc,target,500,2000);
 expect(next.lines[0].words[0]).toMatchObject({beginMs:100,endMs:800,rubyUnits:word.rubyUnits});
 expect(doc.lines[0].words[0].beginMs).toBeNull();
 const ruby=assignTimeline(next,{kind:'ruby',lineId:line.id,wordId:word.id,rubyId:'u'},1500,2000);
 expect(ruby.lines[0].words[0]).toMatchObject({beginMs:100,endMs:2000});
 expect(ruby.lines[0].words[0].rubyUnits[1]).toMatchObject({beginMs:1500,endMs:2000});
});
it('uses document samples, rejects out-of-media assignment and preserves linked-end constraints',()=>{
 const doc=createLyricDocument('a'),line=doc.lines[0];
 line.words[0].beginMs=0;line.words[0].endMs=200;
 line.words.push(createWord('b'));
 expect(assignTimeline(doc,{kind:'word',lineId:line.id,wordId:line.words[1].id},1000,2000).lines[0].words[1]).toMatchObject({beginMs:1000,endMs:1200});
 expect(()=>assignTimeline(doc,{kind:'line',lineId:line.id},2000,2000)).not.toThrow(); // Timed children extend the final interval left.
 expect(()=>assignTimeline(createLyricDocument('x'),{kind:'line',lineId:'missing'},0,2000)).toThrow();
});
it('locates envelopes with bounded zoom and preserves zoom for one point',()=>{
 expect(locateViewport({startMs:0,spanMs:1000},10000,3000,4000)).toEqual({startMs:2500,spanMs:2000});
 expect(locateViewport({startMs:0,spanMs:1000},10000,3000,3000)).toEqual({startMs:2500,spanMs:1000});
 expect(locateViewport({startMs:0,spanMs:1000},10000,0,1000)).toEqual({startMs:0,spanMs:2000});
});

it('expands only outward, respects end links and keeps attachment children inside assigned rows',()=>{
 const doc=createLyricDocument('a'),line=doc.lines[0],word=line.words[0];
 line.beginMs=100;line.endMs=500;word.beginMs=100;word.endMs=200;
 word.rubyUnits=[{id:'r',reading:'a',beginMs:null,endMs:null}];
 const editing={emptyBeats:{},ignoredSyncLineIds:[],skippedAlignmentLineIds:[],endLinks:{[line.id]:'next'}};
 expect(()=>assignTimeline(doc,{kind:'ruby',lineId:line.id,wordId:word.id,rubyId:'r'},1000,3000,editing)).toThrow('timeline.linkConflict');
 doc.romanizationTracks=[{id:'t',language:null,contents:[{id:'c',lineId:line.id,kind:'timed',units:[{id:'u',text:'a',beginMs:100,endMs:2500}]}]}];
 expect(assignTimeline(doc,{kind:'line',lineId:line.id},1000,3000).lines[0]).toMatchObject({beginMs:100,endMs:2500});
 const next=assignTimeline(doc,{kind:'ruby',lineId:line.id,wordId:word.id,rubyId:'r'},150,3000);
 expect(next.lines[0].words[0]).toMatchObject({beginMs:100,endMs:450});
 expect(next.lines[0]).toMatchObject({beginMs:100,endMs:2500});
});
