import { expect, it } from 'vitest';
import { createLyricDocument, createWord } from '../src/domain/lyric-document';
import { dictionaryRubyCommand, proposeDictionaryRuby, type DictionaryRange } from '../src/domain/dictionary-ruby';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand, redoLyricCommand } from './helpers/project-history';
import { parseLyricTtml, serializeLyricTtml } from '../src/adapters/ttml/lyric-codec';
import { distributeRubyTime } from '../src/domain/ruby-editing';
import { createProjectEditing } from '../src/domain/project-editing';
import { planSelectionAction } from '../src/domain/selection-editing';

const range=(lineId:string,base:string,units:string[],start=0,status:DictionaryRange['status']='known'):DictionaryRange=>({lineId,base,units,start,end:start+base.length,status});
it('preserves word boundaries, syllable units and envelope through undo, redo and TTML export',()=>{
  const d=createLyricDocument('重庆');const l=d.lines[0],w=l.words[0];l.beginMs=w.beginMs=0;l.endMs=w.endMs=1000;
  const rows=proposeDictionaryRuby(d,[l.id],[range(l.id,'重',['chóng']),range(l.id,'庆',['qìng'],1)]);
  rows[0].blocks[0].units[0]='a multi syllable edit';
  const state=executeLyricCommand(createLyricEditorState(d),dictionaryRubyCommand(d,d,rows,false));
  const next=state.present.lines[0].words;
  expect(next).toHaveLength(1);expect(next[0].id).toBe(w.id);
  expect(next[0].rubyUnits.map(u=>[u.reading,u.beginMs,u.endMs])).toEqual([['a multi syllable edit',0,500],['qìng',500,1000]]);
  expect(undoLyricCommand(state).present).toBe(d);expect(redoLyricCommand(undoLyricCommand(state)).present).toEqual(state.present);
  for(const draft of [false,true])expect(parseLyricTtml(serializeLyricTtml(state.present,{draft})).lines[0].words[0].rubyUnits.map(u=>u.reading)).toEqual(['a multi syllable edit','qìng']);
});
it('requires explicit minimum merge and filters empty units without shrinking the merged segment',()=>{
  const d=createLyricDocument();const l=d.lines[0];l.words=['重','庆','人'].map(t=>createWord(t));
  const rows=proposeDictionaryRuby(d,[l.id],[range(l.id,'重庆',['chóng','qìng']),range(l.id,'人',['rén'],2)]);
  const unchanged=dictionaryRubyCommand(d,d,rows,false);
  if(unchanged.type!=='replace-document')throw Error();
  expect(unchanged.document.lines[0].words.map(w=>w.text)).toEqual(['重','庆','人']);
  const merged=dictionaryRubyCommand(d,d,rows,true);
  if(merged.type!=='replace-document')throw Error();
  expect(merged.document.lines[0].words.map(w=>w.text)).toEqual(['重庆','人']);
  rows[0].blocks[0].units[1]='';
  const cleared=dictionaryRubyCommand(d,d,rows,true);
  if(cleared.type!=='replace-document')throw Error();
  expect(cleared.document.lines[0].words.map(w=>w.text)).toEqual(['重庆','人']);
  expect(cleared.document.lines[0].words[0].rubyUnits.map(u=>u.reading)).toEqual(['chóng']);
  rows[0].blocks[0].units[0]='  ';
  const skipped=dictionaryRubyCommand(d,d,rows,true);
  if(skipped.type!=='replace-document')throw Error();
  expect(skipped.document.lines[0].words.slice(0,2)).toEqual(l.words.slice(0,2));
});
it('keeps existing IDs and manual timing; missing and ambiguous manual text stays one unit',()=>{
  const d=createLyricDocument();const l=d.lines[0];l.words=['重','庆','𠮷'].map(t=>createWord(t));
  l.words[0].rubyUnits=[{id:'saved',reading:'old',beginMs:10,endMs:20}];
  const rows=proposeDictionaryRuby(d,[l.id],[range(l.id,'重',['new']),range(l.id,'庆',[],1,'ambiguous'),range(l.id,'𠮷',[],2,'unknown')]);
  expect(rows[0].blocks[0].units).toEqual(['old']);
  rows[0].blocks[0].units[0]='edited';
  rows[0].blocks[1].units[0]='qing qing';
  const cmd=dictionaryRubyCommand(d,d,rows,false);
  if(cmd.type!=='replace-document')throw Error();
  expect(cmd.document.lines[0].words[0].rubyUnits).toEqual([{id:'saved',reading:'edited',beginMs:10,endMs:20}]);
  expect(cmd.document.lines[0].words[1].rubyUnits.map(u=>u.reading)).toEqual(['qing qing']);
  expect(cmd.document.lines[0].words[2]).toBe(l.words[2]);
  expect(()=>dictionaryRubyCommand({...d},d,rows,false)).toThrow('源文档');
});
it('retimes non-kana equally, splits manually at graphemes, refuses mora and preserves merged units',()=>{
  const d=createLyricDocument('重庆');const l=d.lines[0],w=l.words[0];w.beginMs=0;w.endMs=1000;
  w.rubyUnits=[{id:'r1',reading:'chóng',beginMs:0,endMs:500},{id:'r2',reading:'qìng',beginMs:500,endMs:1000}];
  expect(distributeRubyTime(w,[{...w.rubyUnits[0],reading:'long long spelling'},w.rubyUnits[1]]).map(u=>u.endMs)).toEqual([500,1000]);
  const state=createLyricEditorState(d);
  const split=executeLyricCommand(state,{type:'split-ruby',lineId:l.id,wordId:w.id,rubyId:'r1',at:1});
  expect(split.present.lines[0].words[0].rubyUnits.slice(0,2).map(u=>[u.reading,u.beginMs,u.endMs])).toEqual([['c',0,250],['hóng',250,500]]);
  expect(()=>planSelectionAction(d,{kind:'ruby',lineId:l.id,wordId:w.id,ids:['r1','r2'],anchorId:'r1',activeId:'r2'},'mora')).toThrow('纯假名');
  const merged=executeLyricCommand(state,planSelectionAction(d,{kind:'ruby',lineId:l.id,wordId:w.id,ids:['r1','r2'],anchorId:'r1',activeId:'r2'},'merge'));
  expect(merged.present.lines[0].words[0].rubyUnits).toHaveLength(1);
  expect(undoLyricCommand(merged).present).toEqual(d);
});

it('retains surviving existing identities and manual gaps, skips all empty and restores atomically',()=>{
  const d=createLyricDocument('二人'),l=d.lines[0],w=l.words[0];
  w.rubyUnits=['fu','ta','ri'].map((reading,i)=>({id:'r'+i,reading,beginMs:i*100,endMs:i*100+60}));
  const rows=proposeDictionaryRuby(d,[l.id],[range(l.id,'二人',['ignored'])]);
  rows[0].blocks[0].units=['fu',' ','ri'];
  const editing=createProjectEditing();editing.emptyBeats.r1={kind:'ruby',count:2};
  const state=executeLyricCommand(createLyricEditorState(d,editing),dictionaryRubyCommand(d,d,rows,false));
  expect(state.present.lines[0].words[0].rubyUnits).toEqual([w.rubyUnits[0],w.rubyUnits[2]]);
  expect(state.editing.emptyBeats).toEqual({});
  expect(undoLyricCommand(state).editing).toEqual(editing);
  expect(undoLyricCommand(state).present).toBe(d);
  expect(redoLyricCommand(undoLyricCommand(state)).present).toEqual(state.present);
  rows[0].blocks[0].units=['','',' '];
  expect(()=>dictionaryRubyCommand(d,d,rows,false)).toThrow('没有可应用');
  rows[0].blocks[0].units=['fu','ta','ri'];
  expect(()=>dictionaryRubyCommand(d,d,rows,false)).toThrow('没有可应用');
});

it('allocates remaining units within each independent text range',()=>{
  const d=createLyricDocument('二人来'),l=d.lines[0],w=l.words[0];w.beginMs=0;w.endMs=900;
  const rows=proposeDictionaryRuby(d,[l.id],[range(l.id,'二人',['fu','ta','ri']),range(l.id,'来',['lai'],2)]);
  rows[0].blocks[0].units[1]='';
  const result=dictionaryRubyCommand(d,d,rows,false);
  if(result.type!=='replace-document')throw Error();
  expect(result.document.lines[0].words).toHaveLength(1);
  expect(result.document.lines[0].words[0].rubyUnits.map(u=>[u.reading,u.beginMs,u.endMs])).toEqual([['fu',0,300],['ri',300,600],['lai',600,900]]);
});
