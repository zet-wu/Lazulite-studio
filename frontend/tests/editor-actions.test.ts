import { describe, expect, it } from 'vitest';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand } from '../src/domain/lyric-commands';
import { createLine, createLyricDocument, lineText } from '../src/domain/lyric-document';
import { copySelection, cutSelection, deleteSelection, moveWordsAcrossLine, pastePlain, pasteRich, selectIds } from '../src/features/editor/editing-actions';

describe('editor selection and clipboard', () => {
  it('selects ordered ranges and toggles without disturbing document order', () => {
    const order = ['a', 'b', 'c', 'd'];
    expect(selectIds(order, ['b'], 'b', 'd', true, false)).toEqual(['b', 'c', 'd']);
    expect(selectIds(order, ['b', 'd'], 'b', 'c', false, true)).toEqual(['b', 'c', 'd']);
    expect(selectIds(order, ['b', 'c'], 'b', 'b', false, true)).toEqual(['c']);
  });

  it('copies a 注音 word with timing and alignment while assigning fresh linked IDs', () => {
    const document = createLyricDocument('今日');
    const line = document.lines[0];
    line.beginMs = 0; line.endMs = 2000;
    const word = line.words[0];
    word.beginMs = 0; word.endMs = 1000;
    word.rubyUnits = [{ id: 'ruby', reading: 'きょう', beginMs: 0, endMs: 1000 }];
    word.alignmentUnits = [{ id: 'mora', kind: 'mora', text: 'きょ', beginMs: 0, endMs: 500, readingStart: 0, readingEnd: 2, rubyUnitId: 'ruby' }];
    const selection = { kind: 'words' as const, lineId: line.id, ids: [word.id], anchorId: word.id, activeId: word.id };
    const clipboard = copySelection(document, selection);
    const pasted = pasteRich(document, clipboard, selection);
    const state = executeLyricCommand(createLyricEditorState(document), pasted.command);
    const clone = state.present.lines[0].words[1];
    expect(clone.id).not.toBe(word.id);
    expect(clone).toMatchObject({ text: '今日', beginMs: 0, endMs: 1000 });
    expect(clone.rubyUnits[0]).toMatchObject({ reading: 'きょう', beginMs: 0, endMs: 1000 });
    expect(clone.rubyUnits[0].id).not.toBe('ruby');
    expect(clone.alignmentUnits[0].rubyUnitId).toBe(clone.rubyUnits[0].id);
    expect(undoLyricCommand(state).present).toBe(document);
  });

  it('copies a selected 注音 unit without clearing existing alignment references', () => {
    const document = createLyricDocument('歌');
    const line = document.lines[0], word = line.words[0];
    line.beginMs = 0; line.endMs = 1000;
    word.beginMs = 0; word.endMs = 1000;
    word.rubyUnits = [{ id: 'ruby', reading: 'うた', beginMs: 0, endMs: 1000 }];
    word.alignmentUnits = [{ id: 'aligned', kind: 'mora', text: 'う', beginMs: 0, endMs: 500, readingStart: 0, readingEnd: 1, rubyUnitId: 'ruby' }];
    const selection = { kind: 'ruby' as const, lineId: line.id, wordId: word.id, ids: ['ruby'], anchorId: 'ruby', activeId: 'ruby' };
    const clipboard = copySelection(document, selection);
    const pasted = pasteRich(document, clipboard, selection);
    const state = executeLyricCommand(createLyricEditorState(document), pasted.command);
    const result = state.present.lines[0].words[0];
    expect(result.alignmentUnits).toEqual(word.alignmentUnits);
    expect(result.rubyUnits.map((unit) => [unit.reading, unit.beginMs, unit.endMs])).toEqual([['うた', 0, 1000], ['うた', 0, 1000]]);
    expect(result.rubyUnits[1].id).not.toBe('ruby');
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
    const cut = executeLyricCommand(duplicated, cutSelection(duplicated.present, selection));
    expect(cut.present.lines.map(lineText)).toEqual(['主唱', '和声', '下一行']);
    expect(undoLyricCommand(cut).present).toBe(duplicated.present);
  });

  it('copies attached track contents with fresh IDs and one undo', () => {
    const document = createLyricDocument('二人');
    const line = document.lines[0];
    document.romanizationTracks.push({ id: 'track', language: 'ja-Latn', contents: [{ id: 'content', lineId: line.id, kind: 'timed', units: [
      { id: 'fu', text: 'fu ', beginMs: 999, endMs: 1500 },
      { id: 'tari', text: 'tari', beginMs: 1500, endMs: 3001 },
    ] }] });
    const selection = { kind: 'lines' as const, ids: [line.id], anchorId: line.id, activeId: line.id };
    const copied = copySelection(document, selection);
    const pasted = pasteRich(document, copied, selection);
    const state = executeLyricCommand(createLyricEditorState(document), pasted.command);
    const contents = state.present.romanizationTracks[0].contents;
    expect(contents).toHaveLength(2);
    expect(contents[1]).toMatchObject({ lineId: pasted.selection.ids[0], kind: 'timed', units: [{ text: 'fu ', beginMs: 999 }, { text: 'tari', endMs: 3001 }] });
    expect(contents[1].id).not.toBe(contents[0].id);
    if (contents[0].kind === 'timed' && contents[1].kind === 'timed') expect(contents[1].units[0].id).not.toBe(contents[0].units[0].id);
    expect(undoLyricCommand(state).present).toBe(document);
  });

  it('pastes plain text as untimed words or lines according to selection', () => {
    const document = createLyricDocument('前');
    const word = document.lines[0].words[0];
    const wordSelection = { kind: 'words' as const, lineId: document.lines[0].id, ids: [word.id], anchorId: word.id, activeId: word.id };
    const one = pastePlain(document, ' 後', wordSelection);
    const withWord = executeLyricCommand(createLyricEditorState(document), one.command).present;
    expect(withWord.lines[0].words.map((item) => [item.text, item.beginMs])).toEqual([['前', null], [' 後', null]]);
    const many = pastePlain(document, '第一\r\n第二\n', wordSelection);
    const withLines = executeLyricCommand(createLyricEditorState(document), many.command).present;
    expect(withLines.lines.map(lineText)).toEqual(['前', '第一', '第二']);
  });

  it('moves timed 注音 words into a neighboring line without losing their timing', () => {
    const document = createLyricDocument('今日');
    document.lines[0].beginMs = 0; document.lines[0].endMs = 1000;
    const word = document.lines[0].words[0];
    word.beginMs = 0; word.endMs = 1000;
    word.rubyUnits = [{ id: 'reading', reading: 'きょう', beginMs: 0, endMs: 1000 }];
    const target = createLine('明日', 'next');
    target.beginMs = 1000; target.endMs = 2000;
    target.words[0].beginMs = 1000; target.words[0].endMs = 2000;
    document.lines.push(target);
    const selection = { kind: 'words' as const, lineId: document.lines[0].id, ids: [word.id], anchorId: word.id, activeId: word.id };
    const state = executeLyricCommand(createLyricEditorState(document), moveWordsAcrossLine(document, selection, target.id, null));
    expect(state.present.lines[1].beginMs).toBe(0);
    expect(state.present.lines[1].words[0]).toBe(word);
    expect(state.present.lines[1].words[0].rubyUnits[0].reading).toBe('きょう');
    expect(undoLyricCommand(state).present).toBe(document);

    const clipboard = copySelection(document, selection);
    const targetSelection = { kind: 'lines' as const, ids: [target.id], anchorId: target.id, activeId: target.id };
    const pasted = executeLyricCommand(createLyricEditorState(document), pasteRich(document, clipboard, targetSelection).command);
    expect(pasted.present.lines[1].beginMs).toBe(0);
    expect(pasted.present.lines[1].words[1].rubyUnits[0].reading).toBe('きょう');
    expect(undoLyricCommand(pasted).present).toBe(document);
  });
});

it('batch deletion rejects a linked target atomically after an earlier deletion', () => {
  const doc = createLyricDocument('前');
  const linked = doc.lines[0]; linked.beginMs = 0; linked.endMs = 3000;
  linked.words[0].beginMs = 0; linked.words[0].endMs = 2000;
  linked.endLink = { targetLineId: 'target', originalEndMs: 1000 };
  doc.lines.push(createLine('先删', 'first'), createLine('目标', 'target'));
  const state = createLyricEditorState(doc), before = structuredClone(doc);
  expect(() => executeLyricCommand(state, deleteSelection(doc, { kind: 'lines', ids: ['first', 'target'], anchorId: 'first', activeId: 'target' }))).toThrow('original line end excludes a word');
  expect(state.present).toEqual(before); expect(state.past).toHaveLength(0);
});
