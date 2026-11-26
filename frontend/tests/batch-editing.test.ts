import { expect, it, describe } from 'vitest';
import { replaceText, shiftLineTimes, smoothWordTimes, syncLineTimes } from '../src/domain/batch-editing';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand, redoLyricCommand } from './helpers/project-history';
import { createLine, createLyricDocument, createWord } from '../src/domain/lyric-document';

describe('E3 batch editing', () => {
  it('shifts a selected line, 注音 and alignments without touching other lines or losing null time', () => {
    const document = createLyricDocument('今日');
    const line = document.lines[0], word = line.words[0];
    line.beginMs = 500; line.endMs = 1000;
    word.beginMs = 500; word.endMs = 1000;
    word.rubyUnits = [{ id: 'r', reading: 'きょう', beginMs: 600, endMs: 900 }];
    const untouched = createLine('明日', 'next'); document.lines.push(untouched);
    const state = executeLyricCommand(createLyricEditorState(document), shiftLineTimes(document, [line.id], 200));
    expect(state.present.lines[0].words[0].rubyUnits[0].beginMs).toBe(800);
    expect(state.present.lines[1]).toBe(untouched);
    expect(undoLyricCommand(state).present).toBe(document);
    expect(() => shiftLineTimes(document, [line.id], -600)).toThrow('batch.offsetOutOfRange');
  });

  it('smooths only nearby plain word boundaries and synchronizes line envelope', () => {
    const document = createLyricDocument('a');
    const line = document.lines[0];
    line.words = [{ ...createWord('中', 'a'), beginMs: 100, endMs: 400 }, { ...createWord('文', 'b'), beginMs: 420, endMs: 900 }];
    const smoothed = smoothWordTimes(document, [line.id], 30_000);
    expect(smoothed.count).toBe(1);
    const state = executeLyricCommand(createLyricEditorState(document), smoothed.command);
    expect(state.present.lines[0].words.map((word) => [word.beginMs, word.endMs])).toEqual([[100, 410], [410, 900]]);
    const synced = executeLyricCommand(state, syncLineTimes(state.present, [line.id]));
    expect(synced.present.lines[0]).toMatchObject({ beginMs: 100, endMs: 900 });
    expect(undoLyricCommand(synced).present).toBe(state.present);
  });

  it('replaces selected text in one undo and preserves Ruby on a base change', () => {
    const document = createLyricDocument('hello hello');
    const line = document.lines[0], word = line.words[0];
    const result = replaceText(document, [word.id], 'words', 'hello', 'hi');
    expect(result.count).toBe(2);
    const state = executeLyricCommand(createLyricEditorState(document), result.command);
    expect(state.present.lines[0].words[0].text).toBe('hi hi');
    expect(undoLyricCommand(state).present).toBe(document);
    word.rubyUnits.push({ id: 'r', reading: 'ヘロー', beginMs: null, endMs: null });
    expect(executeLyricCommand(createLyricEditorState(document), replaceText(document, [word.id], 'words', 'hello', 'hi').command).present.lines[0].words[0].rubyUnits).toEqual(word.rubyUnits);
  });
});

it.each([20,-20])('smooths ruby and mixed leaf boundaries with parent envelopes and undo/redo (gap %s)', gap => {
  const document=createLyricDocument(''),line=createLine('','l'); document.lines=[line];
  Object.assign(line,{beginMs:50,endMs:1000});
  line.words=[{...createWord('愛','a'),beginMs:50,endMs:450,rubyUnits:[{id:'a1',reading:'あ',beginMs:100,endMs:200},{id:'a2',reading:'い',beginMs:200+gap,endMs:400}]},
    {...createWord('詩','b'),beginMs:400,endMs:650,rubyUnits:[{id:'b1',reading:'し',beginMs:400+gap,endMs:600}]},
    {...createWord('を','c'),beginMs:600+gap,endMs:800}, {...createWord('歌','d'),beginMs:800+gap,endMs:1000}];
  const result=smoothWordTimes(document,['l'],20);
  expect(result.count).toBe(4);
  const state=executeLyricCommand(createLyricEditorState(document),result.command),words=state.present.lines[0].words;
  expect(words[0].rubyUnits.map(u=>[u.beginMs,u.endMs])).toEqual([[100,200+gap/2],[200+gap/2,400+gap/2]]);
  expect(words.map(w=>[w.beginMs,w.endMs])).toEqual([[100,400+gap/2],[400+gap/2,600+gap/2],[600+gap/2,800+gap/2],[800+gap/2,1000]]);
  expect(state.present.lines[0]).toMatchObject({beginMs:50,endMs:1000});
  const undone=undoLyricCommand(state);expect(undone.present).toBe(document);
  expect(redoLyricCommand(undone).present).toEqual(state.present);
});

it.each(['pin1','jyut6','romaji','hello',' ','、','!?','♪'])('filters both body and ruby leaves: %s', text => {
  for(const ruby of [false,true]){
    const document=createLyricDocument(''),line=createLine('','l');document.lines=[line];
    line.words=[{...createWord(ruby?'音':text,'a'),beginMs:100,endMs:200,rubyUnits:ruby?[{id:'r',reading:text,beginMs:100,endMs:200}]:[]}, {...createWord('あ','b'),beginMs:220,endMs:300}];
    expect(smoothWordTimes(document,['l'],30).count).toBe(0);
    expect(smoothWordTimes(document,['l'],30,true).count).toBe(/[\p{L}\p{N}]/u.test(text)?1:0);
  }
});

it('skips missing endpoints, large gaps and midpoints that reverse a leaf',()=>{
 const document=createLyricDocument(''),line=createLine('','l');document.lines=[line];
 line.words=[{...createWord('あ','a'),beginMs:100,endMs:300},{...createWord('い','b'),beginMs:50,endMs:120}];
 expect(smoothWordTimes(document,['l'],300).count).toBe(0);
 line.words[1].beginMs=400;expect(smoothWordTimes(document,['l'],30).count).toBe(0);
 line.words[1].beginMs=null;expect(smoothWordTimes(document,['l'],300).count).toBe(0);
});
