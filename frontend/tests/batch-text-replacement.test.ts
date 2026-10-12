import { expect, it } from 'vitest';
import { clearRuby, replaceText } from '../src/domain/batch-editing';
import { createLine, createLyricDocument } from '../src/domain/lyric-document';
import { createProjectDocument, createProjectEditorState, executeProjectCommand, undoProjectCommand, redoProjectCommand } from '../src/domain/project-document';
import { setEmptyBeat } from '../src/domain/project-editing';
function fixture() {
  const lyrics = createLyricDocument('A.A');
  const line = lyrics.lines[0], word = line.words[0];
  word.obscene = true;
  word.rubyUnits = [{ id:'r1', reading:'きょ', beginMs:100, endMs:200 }, { id:'r2', reading:'う', beginMs:300, endMs:400 }];
  const bg = { ...createLine('背景'), backgroundOf:line.id }; lyrics.lines.push(bg);
  const project = createProjectDocument(lyrics);
  setEmptyBeat(project.editing,'r1','ruby',2);
  setEmptyBeat(project.editing,'r2','ruby',3);
  project.karaoke.cues = [
    {id:'before',text:'x',beginMs:0,endMs:50,anchor:{kind:'before',lineId:line.id}},
    {id:'ruby',text:'x',beginMs:200,endMs:300,anchor:{kind:'ruby',lineId:line.id,wordId:word.id,leftId:'r1',rightId:'r2'}},
    {id:'bg',text:'x',beginMs:0,endMs:50,anchor:{kind:'before',lineId:bg.id}},
  ];
  return { project, line, word, bg, state:createProjectEditorState(project) };
}
it('replaces literals, preserves Ruby/flags/beats, counts unchanged matches without history',()=>{
  const {project,word,state}=fixture();
  const result=replaceText(project.lyrics,[word.id],'words','.',' ');
  expect(result).toMatchObject({count:1,changed:1,deletedRuby:0});
  const next=executeProjectCommand(state,{type:'lyrics',command:result.command});
  expect(next.present.lyrics.lines[0].words[0]).toEqual({...word,text:'A A'});
  expect(next.present.editing).toEqual(project.editing);
  const same=replaceText(project.lyrics,[word.id],'words','a','A',true);
  expect(same).toMatchObject({count:2,changed:0});
  expect(executeProjectCommand(state,{type:'lyrics',command:same.command})).toBe(state);
});
it('replaces within one Ruby only, does not trim whitespace or retime changed readings',()=>{
  const {project,state}=fixture();
  expect(replaceText(project.lyrics,['r1','r2'],'ruby','きょう','x').count).toBe(0);
  const result=replaceText(project.lyrics,['r1'],'ruby','きょ',' ');
  const next=executeProjectCommand(state,{type:'lyrics',command:result.command});
  expect(next.present.lyrics.lines[0].words[0].rubyUnits[0]).toEqual({id:'r1',reading:' ',beginMs:100,endMs:200});
  expect(next.present.karaoke.cues).toEqual(project.karaoke.cues);
});
it('deletes empty replacements and related beats/cues in one reversible transaction',()=>{
  const {project,word,state}=fixture();
  const result=replaceText(project.lyrics,[word.id],'words','A.A','',false,project.editing);
  expect(result).toMatchObject({deletedWords:1,deletedRuby:2,deletedBeats:5});
  const next=executeProjectCommand(state,{type:'lyrics',command:result.command});
  expect(next.present.lyrics.lines[0].words).toEqual([]);
  expect(next.present.editing.emptyBeats).toEqual({});
  expect(next.present.karaoke.cues.map(c=>c.id)).toEqual(['before','bg']);
  expect(undoProjectCommand(next).present).toBe(project);
  expect(redoProjectCommand(undoProjectCommand(next)).present).toBe(next.present);
});
it('clears only requested words and retains body plus unrelated cues; empty clear has no history',()=>{
  const {project,word,state}=fixture();
  const result=clearRuby(project.lyrics,[word.id],project.editing);
  expect(result).toMatchObject({words:1,ruby:2,beats:5});
  const next=executeProjectCommand(state,{type:'lyrics',command:result.command});
  expect(next.present.lyrics.lines[0].words[0]).toEqual({...word,rubyUnits:[]});
  expect(next.present.karaoke.cues.map(c=>c.id)).toEqual(['before','bg']);
  expect(next.present.editing.emptyBeats).toEqual({});
  expect(executeProjectCommand(next,{type:'lyrics',command:clearRuby(next.present.lyrics,[word.id]).command})).toBe(next);
});
it('clears all three cue kinds by explicit line identity without expanding backgrounds',()=>{
  const {project,line,state}=fixture();
  const next=executeProjectCommand(state,{type:'karaoke',command:{kind:'remove-lines',lineIds:[line.id]}});
  expect(next.present.karaoke.cues.map(c=>c.id)).toEqual(['bg']);
  expect(next.present.lyrics).toBe(project.lyrics);
  expect(next.present.editing).toBe(project.editing);
  expect(next.past).toHaveLength(1);
  expect(undoProjectCommand(next).present).toBe(project);
  expect(executeProjectCommand(next,{type:'karaoke',command:{kind:'remove-lines',lineIds:[line.id]}})).toBe(next);
});
