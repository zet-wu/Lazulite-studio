import {expect, it} from 'vitest';
import {createLine, createLyricDocument} from '../src/domain/lyric-document';
import {createProjectDocument, createProjectEditorState, executeProjectCommand, undoProjectCommand, redoProjectCommand} from '../src/domain/project-document';
import {syncUnits, stampSync} from '../src/domain/sync-editing';
it('applies independent defaults only on identity transitions and preserves undo snapshots',()=>{
 const lyrics=createLyricDocument('main'); lyrics.lines.push(createLine('other','other'));
 const initial=createProjectEditorState(createProjectDocument(lyrics));
 const change={type:'lyrics',command:{type:'set-background-of',lineId:'other',parentLineId:lyrics.lines[0].id}} as const;
 const state=executeProjectCommand(initial,change,{skipAlignment:true,skipSync:false});
 expect(state.present.editing.skippedAlignmentLineIds).toEqual(['other']);expect(state.present.editing.ignoredSyncLineIds).toEqual([]);
 const restored=redoProjectCommand(undoProjectCommand(state));expect(restored.present).toBe(state.present);
 const main=executeProjectCommand(state,{type:'lyrics',command:{type:'set-background-of',lineId:'other',parentLineId:null}},{skipAlignment:false,skipSync:true});
 expect(main.present.editing.skippedAlignmentLineIds).toEqual(['other']);
});
it('uses preceding background display order for candidates and actual stamps, while manual skipped rows stay local',()=>{
 const lyrics=createLyricDocument('main');const main=lyrics.lines[0];const bg=createLine('background','bg');bg.backgroundOf=main.id;lyrics.lines.push(bg);
 const project=createProjectDocument(lyrics);const order=['bg',main.id];
 const units=syncUnits(lyrics,project.editing,undefined,order);expect(units.map(u=>u.lineId)).toEqual(order);
 const started=stampSync(lyrics,units[0],'start',100,'continuous',project.editing,order);
 const next=stampSync(started,units[0],'next',200,'continuous',project.editing,order);expect(next.lines[0].words[0].beginMs).toBe(200);
 project.editing.ignoredSyncLineIds=['bg'];expect(syncUnits(lyrics,project.editing,undefined,order).map(u=>u.lineId)).toEqual([main.id]);
 const manual=stampSync(started,units[0],'next',300,'continuous',project.editing,order);expect(manual.lines[0].words[0].beginMs).toBeNull();expect(manual.lines[1].words[0].endMs).toBe(300);
});
it('preserves explicit copied editing state and does not reset values on reparenting',()=>{
 const lyrics=createLyricDocument('main');const second=createLine('second','second'),bg=createLine('background','bg');bg.backgroundOf=lyrics.lines[0].id;lyrics.lines.push(bg,second);
 const state=createProjectEditorState(createProjectDocument(lyrics));state.present.amll.noMultipleBackgrounds=false;
 const moved=executeProjectCommand(state,{type:'lyrics',command:{type:'set-background-of',lineId:'bg',parentLineId:'second'}});
 expect(moved.present.editing.ignoredSyncLineIds).toEqual([]);expect(moved.present.editing.skippedAlignmentLineIds).toEqual([]);
 const copy=createLine('copied','copy');copy.backgroundOf='second';
 const pasted=executeProjectCommand(moved,{type:'lyrics',command:{type:'batch',commands:[{type:'replace-document',document:{...moved.present.lyrics,lines:[...moved.present.lyrics.lines,copy]}},{type:'restore-editing',editing:{emptyBeats:{},ignoredSyncLineIds:[],skippedAlignmentLineIds:[]}}]}});
 expect(pasted.present.editing.ignoredSyncLineIds).toEqual([]);expect(pasted.present.editing.skippedAlignmentLineIds).toEqual([]);
});
