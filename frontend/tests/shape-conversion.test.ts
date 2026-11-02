import { expect, it } from 'vitest';
import { shapeRows, shapeCommand, validShapeValue } from '../src/domain/shape-conversion';
import { createLine, createLyricDocument } from '../src/domain/lyric-document';
import { createProjectDocument, createProjectEditorState, executeProjectCommand, undoProjectCommand, redoProjectCommand } from '../src/domain/project-document';

it('maps a whole-line phrase back to original words and keeps the entire project in one undo',()=>{
  const lyrics=createLyricDocument('头发'),line=lyrics.lines[0],original=line.words[0];
  line.words=[{...original,text:'头',rubyUnits:[{id:'r',reading:'とう',beginMs:100,endMs:200}],obscene:true},{...original,id:'w2',text:'发'}];
  lyrics.lines.push({...createLine('背景'),backgroundOf:line.id});
  const project=createProjectDocument(lyrics);project.editing.emptyBeats.r={kind:'ruby',count:2};
  const state=createProjectEditorState(project);
  const rows=shapeRows(lyrics,[line.id],{rows:[{id:line.id,cells:[{start:0,end:1,original:'头',value:'頭',status:'known'},{start:1,end:2,original:'发',value:'髮',status:'ambiguous'}]}]});
  const next=executeProjectCommand(state,{type:'lyrics',command:shapeCommand(lyrics,lyrics,rows)});
  expect(next.present.lyrics.lines[0].words).toEqual(line.words.map((word,i)=>({...word,text:i?'髮':'頭'})));
  expect(next.present.lyrics.lines[1]).toEqual(lyrics.lines[1]);expect(next.present.editing).toEqual(project.editing);expect(next.present.karaoke).toEqual(project.karaoke);
  expect(next.past).toHaveLength(1);expect(undoProjectCommand(next).present).toBe(project);expect(redoProjectCommand(undoProjectCommand(next)).present).toBe(next.present);
  rows[0].cells.forEach(cell=>cell.value='');
  expect(executeProjectCommand(state,{type:'lyrics',command:shapeCommand(lyrics,lyrics,rows)})).toBe(state);
  rows[0].cells[0].value='頭';
  expect(shapeCommand(lyrics,lyrics,rows)).toMatchObject({commands:[{text:'頭'}]});
  rows[0].cells[0].value='多字';expect(()=>shapeCommand(lyrics,lyrics,rows)).toThrow('shape.invalidCell');
  expect(()=>shapeCommand({...lyrics},lyrics,rows)).toThrow('shape.stale');
});

it('keeps UTF-16 grapheme positions, rejects malformed results, and cannot split a cross-word grapheme',()=>{
  for(const value of ['','𠀀','葛\u{E0100}','e\u0301'])expect(validShapeValue(value)).toBe(true);
  for(const value of ['ab','\ud800','\n'])expect(validShapeValue(value)).toBe(false);
  const source=createLyricDocument('葛\u{E0100}'),line=source.lines[0],word=line.words[0];
  line.words=[{...word,text:'葛'},{...word,id:'ivs',text:'\u{E0100}'}];
  const data={rows:[{id:line.id,cells:[{start:0,end:3,original:'葛\u{E0100}',value:'葛\u{E0100}',status:'known'}]}]};
  const rows=shapeRows(source,[line.id],data);
  expect(rows[0].cells[0]).toMatchObject({editable:false,status:'failed',value:''});
  data.rows[0].cells[0].end=2;expect(()=>shapeRows(source,[line.id],data)).toThrow('shape.characterMismatch');
});
