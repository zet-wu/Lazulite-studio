import { describe, expect, it } from 'vitest';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand } from '../src/domain/lyric-commands';
import { createLine, createLyricDocument, lineText } from '../src/domain/lyric-document';
import { copySelection, cutSelection, moveWordsAcrossLine, pastePlain, pasteRich, selectIds } from '../src/features/editor/editing-actions';

describe('editor selection and clipboard', () => {
  it('selects ordered ranges and toggles without disturbing document order', () => {
    const order = ['a', 'b', 'c', 'd'];
    expect(selectIds(order, ['b'], 'b', 'd', true, false)).toEqual(['b', 'c', 'd']);
    expect(selectIds(order, ['b', 'd'], 'b', 'c', false, true)).toEqual(['b', 'c', 'd']);
    expect(selectIds(order, ['b', 'c'], 'b', 'b', false, true)).toEqual(['c']);
  });

  it('copies a Ruby word with timing and alignment while assigning fresh linked IDs', () => {
    const document = createLyricDocument('今日');
    const line = document.lines[0];
    line.beginUs = 0; line.endUs = 2_000_000;
    const word = line.words[0];
    word.beginUs = 0; word.endUs = 1_000_000;
    word.rubyUnits = [{ id: 'ruby', reading: 'きょう', beginUs: 0, endUs: 1_000_000 }];
    word.alignmentUnits = [{ id: 'mora', kind: 'mora', text: 'きょ', beginUs: 0, endUs: 500_000, readingStart: 0, readingEnd: 2, rubyUnitId: 'ruby' }];
    const selection = { kind: 'words' as const, lineId: line.id, ids: [word.id], anchorId: word.id, activeId: word.id, rubyId: null };
    const clipboard = copySelection(document, selection);
    const pasted = pasteRich(document, clipboard, selection);
    const state = executeLyricCommand(createLyricEditorState(document), pasted.command);
    const clone = state.present.lines[0].words[1];
    expect(clone.id).not.toBe(word.id);
    expect(clone).toMatchObject({ text: '今日', beginUs: 0, endUs: 1_000_000 });
    expect(clone.rubyUnits[0]).toMatchObject({ reading: 'きょう', beginUs: 0, endUs: 1_000_000 });
    expect(clone.rubyUnits[0].id).not.toBe('ruby');
    expect(clone.alignmentUnits[0].rubyUnitId).toBe(clone.rubyUnits[0].id);
    expect(undoLyricCommand(state).present).toBe(document);
  });

  it('copies and cuts a parent with its background as one undoable operation', () => {
    const document = createLyricDocument('主唱');
    const parent = document.lines[0];
    parent.translations = [{ language: 'zh', text: '翻译' }];
    const background = { ...createLine('和声', 'bg'), backgroundOf: parent.id };
    document.lines.push(background, createLine('下一行', 'next'));
    const selection = { kind: 'lines' as const, ids: [parent.id], anchorId: parent.id, activeId: parent.id };
    const clipboard = copySelection(document, selection);
    const pasted = pasteRich(document, clipboard, selection);
    const duplicated = executeLyricCommand(createLyricEditorState(document), pasted.command);
    expect(duplicated.present.lines.map((line) => line.id)).toEqual([parent.id, 'bg', pasted.selection.ids[0], `${pasted.selection.ids[0]}:bg`, 'next']);
    expect(duplicated.present.lines[2].translations).toEqual(parent.translations);
    expect(duplicated.present.lines[3].backgroundOf).toBe(duplicated.present.lines[2].id);
    const cut = executeLyricCommand(duplicated, cutSelection(selection));
    expect(cut.present.lines.map(lineText)).toEqual(['主唱', '和声', '下一行']);
    expect(undoLyricCommand(cut).present).toBe(duplicated.present);
  });

  it('pastes plain text as untimed words or lines according to selection', () => {
    const document = createLyricDocument('前');
    const word = document.lines[0].words[0];
    const wordSelection = { kind: 'words' as const, lineId: document.lines[0].id, ids: [word.id], anchorId: word.id, activeId: word.id, rubyId: null };
    const one = pastePlain(document, ' 後', wordSelection);
    const withWord = executeLyricCommand(createLyricEditorState(document), one.command).present;
    expect(withWord.lines[0].words.map((item) => [item.text, item.beginUs])).toEqual([['前', null], [' 後', null]]);
    const many = pastePlain(document, '第一\r\n第二\n', wordSelection);
    const withLines = executeLyricCommand(createLyricEditorState(document), many.command).present;
    expect(withLines.lines.map(lineText)).toEqual(['前', '第一', '第二']);
  });

  it('moves timed Ruby words into a neighboring line without losing their timing', () => {
    const document = createLyricDocument('今日');
    document.lines[0].beginUs = 0; document.lines[0].endUs = 1_000_000;
    const word = document.lines[0].words[0];
    word.beginUs = 0; word.endUs = 1_000_000;
    word.rubyUnits = [{ id: 'reading', reading: 'きょう', beginUs: 0, endUs: 1_000_000 }];
    const target = createLine('明日', 'next');
    target.beginUs = 1_000_000; target.endUs = 2_000_000;
    target.words[0].beginUs = 1_000_000; target.words[0].endUs = 2_000_000;
    document.lines.push(target);
    const selection = { kind: 'words' as const, lineId: document.lines[0].id, ids: [word.id], anchorId: word.id, activeId: word.id, rubyId: null };
    const state = executeLyricCommand(createLyricEditorState(document), moveWordsAcrossLine(document, selection, target.id, null));
    expect(state.present.lines[1].beginUs).toBe(0);
    expect(state.present.lines[1].words[0]).toBe(word);
    expect(state.present.lines[1].words[0].rubyUnits[0].reading).toBe('きょう');
    expect(undoLyricCommand(state).present).toBe(document);

    const clipboard = copySelection(document, selection);
    const targetSelection = { kind: 'lines' as const, ids: [target.id], anchorId: target.id, activeId: target.id };
    const pasted = executeLyricCommand(createLyricEditorState(document), pasteRich(document, clipboard, targetSelection).command);
    expect(pasted.present.lines[1].beginUs).toBe(0);
    expect(pasted.present.lines[1].words[1].rubyUnits[0].reading).toBe('きょう');
    expect(undoLyricCommand(pasted).present).toBe(document);
  });
});
