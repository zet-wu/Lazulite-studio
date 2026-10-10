import { describe, expect, it } from 'vitest';
import { createLyricDocument, createLine, createWord } from '../src/domain/lyric-document';
import { applyLyricCommand } from '../src/domain/lyric-commands';
import { deleteSelection, type EditorSelection } from '../src/features/editor/editing-actions';
import { recoverSelection, survivingSelection } from '../src/features/editor/selection-recovery';
function fixture() {
  const doc = createLyricDocument('');
  doc.lines = ['a','b','c','d'].map(id => ({ ...createLine('',id), words: ['1','2','3'].map(n => ({...createWord(n,id+n),rubyUnits:[{id:id+n+'r1',reading:'a',beginMs:null,endMs:null},{id:id+n+'r2',reading:'b',beginMs:null,endMs:null}]})) }));
  doc.lines.push({...createLine('', 'bg1'),backgroundOf:'c'}, {...createLine('', 'bg2'),backgroundOf:'c'});
  doc.translationTracks=[{id:'t',language:'en',purpose:'subtitle',contents:[{id:'x',lineId:'c',kind:'plain',text:'x'},{id:'y',lineId:'c',kind:'timed',units:[{id:'u1',text:'one',beginMs:null,endMs:null},{id:'u2',text:'two',beginMs:null,endMs:null}]}]}];
  return doc;
}
const line = (ids:string[], activeId=ids.at(-1)!):EditorSelection=>({kind:'lines',ids,activeId,anchorId:ids[0]});
const word = (ids:string[],activeId=ids.at(-1)!):EditorSelection=>({kind:'words',lineId:activeId[0],ids,activeId,anchorId:ids[0]});
const ruby = (id:string):EditorSelection=>({kind:'ruby',lineId:'c',wordId:'c2',ids:[id],activeId:id,anchorId:id});
const content = (id:string,unit=false):EditorSelection=>({kind:unit?'romanization-unit':'romanization-content',attachment:'translation',lineId:'c',trackId:'t',contentId:unit?'y':id,ids:[id],activeId:id,anchorId:id});
function remove(selection:EditorSelection) {const before=fixture();return recoverSelection(before,applyLyricCommand(before,deleteSelection(before,selection)),selection);}
describe('nearby selection recovery',()=>{
 it('uses active position and skips the whole deleted batch',()=>{expect(remove(line(['b','d'],'d'))?.activeId).toBe('c');expect(remove(word(['b3','c2','c3'],'c3'))?.activeId).toBe('c1');});
 it('falls back within the same parent, including empty rows and first Ruby',()=>{expect(remove(word(['c1','c2','c3']))).toEqual(line(['c']));expect(remove(ruby('c2r1'))).toEqual(word(['c2']));expect(remove(ruby('c2r2'))?.activeId).toBe('c2r1');});
 it('uses preceding background or its parent, never unrelated backgrounds',()=>{expect(remove(line(['bg2']))?.activeId).toBe('bg1');expect(remove(line(['bg1']))?.activeId).toBe('c');});
 it('uses following main only when no predecessor, empty document yields null',()=>{expect(remove(line(['a']))?.activeId).toBe('b');expect(remove(line(['a','b','c','d']))).toBeNull();});
 it('recovers translation units to content and content to the same line',()=>{expect(remove(content('u2',true))?.activeId).toBe('u1');expect(remove(content('u1',true))).toEqual(content('y'));expect(remove(content('y'))).toEqual(content('x'));expect(remove(content('x'))).toEqual(line(['c']));});
 it('handles vanished ancestors and stale active IDs using original document order',()=>{const before=fixture();const after=applyLyricCommand(before,deleteSelection(before,line(['c'])));expect(recoverSelection(before,after,ruby('c2r2'))?.activeId).toBe('b');expect(remove({...word(['c2','b2']),activeId:'missing'})?.activeId).toBe('b1');});
 it('reconciles history while retaining surviving selections and current ownership',()=>{const before=fixture();const after=applyLyricCommand(before,deleteSelection(before,word(['c2'])));expect(survivingSelection(before,after,word(['c1','c2']))).toEqual(word(['c1']));expect(survivingSelection(before,after,word(['c2']))).toEqual(word(['c1']));});
});
