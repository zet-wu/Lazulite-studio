import { expect, it } from 'vitest';
import { createLyricDocument, createWord } from '../src/domain/lyric-document';
import { createProjectDocument, createProjectEditorState, executeProjectCommand, undoProjectCommand, redoProjectCommand } from '../src/domain/project-document';
import { createProjectEditing, remapEditing, validateProjectEditing } from '../src/domain/project-editing';
import { hasSyncStop, sugSyncStep, syncUnits, stampSync, type SugProgress } from '../src/domain/sync-editing';
import { parseProject, serializeProject } from '../src/adapters/project-codec';
it.each([0,1,3])('consumes %i inner checkpoints on presses and closes only a terminal release', count => {
 let doc=createLyricDocument('AB');doc.lines[0].words=['A','B'].map(text=>createWord(text,text));
 const editing=createProjectEditing();if(count)editing.emptyBeats.A={kind:'word',count};editing.syncStops.A={kind:'word',stop:true};
 const cursor=syncUnits(doc)[0];let progress:SugProgress={consumed:0,completed:false};
 const event=(type:'pressed'|'released',time:number)=>{const next=sugSyncStep(doc,editing,cursor,progress,type,time);if(next.action)doc=stampSync(doc,cursor,next.action,time,'continuous',editing);progress=next.progress;return next;};
 event('pressed',1000);
 if(count)expect(event('released',1100).action).toBeUndefined();
 for(let i=0;i<count;i++){event('pressed',1200+i*100);if(i<count-1)expect(event('released',1250+i*100).action).toBeUndefined();}
 expect(event('released',2000)).toMatchObject({action:'end',advance:true});
 expect(doc.lines[0].words[0]).toMatchObject({beginMs:1000,endMs:2000});
});
it('shares a non-stop boundary with the next start, defaults the final leaf to a stop and rejects backwards input',()=>{
 let doc=createLyricDocument('AB');doc.lines[0].words=['A','B'].map(text=>createWord(text,text));
 const editing=createProjectEditing(),[a,b]=syncUnits(doc);let p:SugProgress={consumed:0,completed:false};
 expect(hasSyncStop(doc,editing,a)).toBe(false);expect(hasSyncStop(doc,editing,b)).toBe(true);
 let step=sugSyncStep(doc,editing,a,p,'pressed',1000);doc=stampSync(doc,a,step.action!,1000);p=step.progress;
 expect(sugSyncStep(doc,editing,a,p,'released',1200).action).toBeUndefined();
 expect(()=>sugSyncStep(doc,editing,a,p,'pressed',900)).toThrow('sync.endBeforeStart');
 step=sugSyncStep(doc,editing,a,p,'pressed',2000);doc=stampSync(doc,a,step.action!,2000);
 expect(doc.lines[0].words.map(w=>[w.beginMs,w.endMs])).toEqual([[1000,2000],[2000,null]]);
 expect(sugSyncStep(doc,editing,b,step.progress,'released',2500).action).toBe('end');
});
it('keeps explicit stop overrides through history, save, remapping and ruby conversion',()=>{
 const doc=createLyricDocument('A'),word=doc.lines[0].words[0];const initial=createProjectEditorState(createProjectDocument(doc));
 const state=executeProjectCommand(initial,{type:'lyrics',command:{type:'set-sync-stop',id:word.id,kind:'word',stop:false}});
 expect(parseProject(serializeProject(state.present))).toEqual(state.present);
 expect(undoProjectCommand(state).present).toBe(initial.present);expect(redoProjectCommand(undoProjectCommand(state)).present).toBe(state.present);
 const ruby=executeProjectCommand(state,{type:'lyrics',command:{type:'add-ruby',lineId:doc.lines[0].id,wordId:word.id,reading:'えー',rubyId:'r'}});
 expect(ruby.present.editing.syncStops).toEqual({r:{kind:'ruby',stop:false}});
 expect(remapEditing(ruby.present.editing,new Map([['r','copy']])).syncStops).toEqual({copy:{kind:'ruby',stop:false}});
 const removed=executeProjectCommand(ruby,{type:'lyrics',command:{type:'delete-word',lineId:doc.lines[0].id,wordId:word.id}});
 expect(removed.present.editing.syncStops).toEqual({});validateProjectEditing(removed.present.lyrics,removed.present.editing);
});
it('keeps a manual stop on the final part when splitting a word',()=>{
 const doc=createLyricDocument('AB'),word=doc.lines[0].words[0];let state=createProjectEditorState(createProjectDocument(doc));
 state=executeProjectCommand(state,{type:'lyrics',command:{type:'set-sync-stop',id:word.id,kind:'word',stop:true}});
 state=executeProjectCommand(state,{type:'lyrics',command:{type:'split-word',lineId:doc.lines[0].id,wordId:word.id,at:1,newWordId:'tail'}});
 expect(state.present.editing.syncStops).toEqual({tail:{kind:'word',stop:true}});
});
