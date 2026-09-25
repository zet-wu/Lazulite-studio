import { describe, expect, it } from 'vitest';
import { createLine, createLyricDocument, createWord, lineText } from '../src/domain/lyric-document';
import { createLyricEditorState, executeLyricCommand, redoLyricCommand, undoLyricCommand } from '../src/domain/lyric-commands';
import { codePointToUtf16, splitAtGrapheme, utf16ToCodePoint } from '../src/domain/text-boundaries';

describe('semantic lyric commands', () => {
  it('splits untimed text without losing spaces and keeps unrelated lines shared', () => {
    const document = createLyricDocument('今日 も歌う');
    const [line] = document.lines;
    const wordId = line.words[0].id;
    let state = createLyricEditorState(document);
    state = executeLyricCommand(state, { type: 'split-word', lineId: line.id, wordId, at: 2, newWordId: 'after-today' });
    expect(state.present.lines[0].words.map((word) => [word.id, word.text, word.beginUs])).toEqual([
      [wordId, '今日', null], ['after-today', ' も歌う', null],
    ]);
    expect(lineText(state.present.lines[0])).toBe('今日 も歌う');
    expect(undoLyricCommand(state).present).toBe(document);
    expect(redoLyricCommand(undoLyricCommand(state)).present).toBe(state.present);
  });

  it('keeps word timing when editing neighboring text and splits Ruby reading once', () => {
    const document = createLyricDocument('今日も歌う');
    const lineId = document.lines[0].id;
    const firstId = document.lines[0].words[0].id;
    let state = createLyricEditorState(document);
    state = executeLyricCommand(state, { type: 'split-word', lineId, wordId: firstId, at: 2, newWordId: 'rest' });
    state = executeLyricCommand(state, { type: 'add-ruby', lineId, wordId: firstId, reading: 'きょう', rubyId: 'reading' });
    state = executeLyricCommand(state, { type: 'split-ruby', lineId, wordId: firstId, rubyId: 'reading', at: 2, newRubyId: 'reading-tail' });
    state = executeLyricCommand(state, { type: 'set-word-time', lineId, wordId: 'rest', beginUs: 1_000_000, endUs: 2_000_000 });
    state = executeLyricCommand(state, { type: 'edit-word', lineId, wordId: 'rest', text: 'も唄う' });
    expect(state.present.lines[0].words[0].rubyUnits.map((unit) => unit.reading)).toEqual(['きょ', 'う']);
    expect(state.present.lines[0].words[1]).toMatchObject({ text: 'も唄う', beginUs: 1_000_000, endUs: 2_000_000 });
    expect(undoLyricCommand(state).present.lines[0].words[1]).toMatchObject({ text: 'も歌う', beginUs: 1_000_000 });
    expect(() => executeLyricCommand(state, { type: 'split-word', lineId, wordId: firstId, at: 1 })).toThrow(/Ruby base/);
  });

  it('uses grapheme boundaries across UTF-16 and code points', () => {
    const text = '𝄞e\u0301きょ';
    expect(codePointToUtf16(text, 1)).toBe(2);
    expect(utf16ToCodePoint(text, 2)).toBe(1);
    expect(() => utf16ToCodePoint(text, 1)).toThrow(/surrogate/);
    expect(() => splitAtGrapheme(text, 2)).toThrow(/grapheme/);
    expect(splitAtGrapheme(text, 3)).toEqual(['𝄞e\u0301', 'きょ']);
  });

  it('keeps background vocals with their parent through line edits and undo', () => {
    const document = createLyricDocument('主唱');
    const parent = document.lines[0];
    const background = { ...createLine('和声', 'bg'), backgroundOf: parent.id };
    const second = createLine('第二行', 'second');
    document.lines.push(background, second);
    let state = createLyricEditorState(document);
    state = executeLyricCommand(state, { type: 'move-line', lineId: parent.id, afterLineId: second.id });
    expect(state.present.lines.map((line) => line.id)).toEqual(['second', parent.id, 'bg']);
    expect(undoLyricCommand(state).present.lines.map((line) => line.id)).toEqual([parent.id, 'bg', 'second']);
    state = executeLyricCommand(state, { type: 'delete-line', lineId: parent.id });
    expect(state.present.lines.map((line) => line.id)).toEqual(['second']);
    expect(undoLyricCommand(state).present.lines.map((line) => line.id)).toEqual(['second', parent.id, 'bg']);
  });

  it('inserts and moves lines after the full background group', () => {
    const document = createLyricDocument('主唱');
    const parent = document.lines[0];
    const background = { ...createLine('和声', 'bg'), backgroundOf: parent.id };
    const second = createLine('第二行', 'second');
    document.lines.push(background, second);
    const inserted = executeLyricCommand(createLyricEditorState(document), { type: 'insert-line', afterLineId: parent.id, line: createLine('插入', 'new') });
    expect(inserted.present.lines.map((line) => line.id)).toEqual([parent.id, 'bg', 'new', 'second']);
    const moved = executeLyricCommand(inserted, { type: 'move-line', lineId: 'new', afterLineId: parent.id });
    expect(moved).toBe(inserted);
    const movedParent = executeLyricCommand(inserted, { type: 'move-line', lineId: parent.id, afterLineId: second.id });
    expect(movedParent.present.lines.map((line) => line.id)).toEqual(['new', 'second', parent.id, 'bg']);
    expect(undoLyricCommand(movedParent).present).toBe(inserted.present);
  });

  it('inserts words and sublyrics as single undoable operations', () => {
    const document = createLyricDocument('今日');
    const lineId = document.lines[0].id;
    const first = document.lines[0].words[0];
    let state = createLyricEditorState(document);
    state = executeLyricCommand(state, { type: 'insert-word', lineId, afterWordId: first.id, word: createWord(' も', 'next') });
    state = executeLyricCommand(state, { type: 'set-sublyrics', lineId, kind: 'translations', items: [{ language: 'zh', text: '今天也' }] });
    expect(lineText(state.present.lines[0])).toBe('今日 も');
    expect(state.present.lines[0].translations[0].text).toBe('今天也');
    expect(undoLyricCommand(state).present.lines[0].translations).toEqual([]);
    expect(undoLyricCommand(undoLyricCommand(state)).present).toBe(document);
    expect(() => executeLyricCommand(state, { type: 'insert-word', lineId, afterWordId: null, word: createWord('重', first.id) })).toThrow(/already exists/);
  });

  it('moves a timed Ruby word across lines without changing its identity or timing', () => {
    const document = createLyricDocument('今日');
    const first = document.lines[0];
    const second = createLine('明日', 'second');
    document.lines.push(second);
    let state = createLyricEditorState(document);
    state = executeLyricCommand(state, { type: 'add-ruby', lineId: first.id, wordId: first.words[0].id, reading: 'きょう', rubyId: 'ruby' });
    state = executeLyricCommand(state, { type: 'set-ruby-time', lineId: first.id, wordId: first.words[0].id, rubyId: 'ruby', beginUs: 100_000, endUs: 800_000 });
    expect(state.present.lines[0].words[0]).toMatchObject({ beginUs: 100_000, endUs: 800_000 });
    const beforeMove = state.present;
    state = executeLyricCommand(state, { type: 'move-word', lineId: first.id, wordId: first.words[0].id, toLineId: second.id, afterWordId: null });
    expect(state.present.lines[1].words[0]).toBe(beforeMove.lines[0].words[0]);
    expect(undoLyricCommand(state).present).toBe(beforeMove);
    expect(() => executeLyricCommand(state, { type: 'set-ruby-time', lineId: second.id, wordId: first.words[0].id, rubyId: 'ruby', beginUs: 0, endUs: 800_000 })).toThrow(/exceeds word/);
  });

  it('applies several edits as one undo step and rejects a failed batch atomically', () => {
    const document = createLyricDocument('今日 も');
    const lineId = document.lines[0].id;
    const wordId = document.lines[0].words[0].id;
    const state = createLyricEditorState(document);
    const edited = executeLyricCommand(state, { type: 'batch', commands: [
      { type: 'split-word', lineId, wordId, at: 2, newWordId: 'rest' },
      { type: 'edit-word', lineId, wordId: 'rest', text: ' も歌う' },
      { type: 'set-sublyrics', lineId, kind: 'translations', items: [{ language: 'zh', text: '今天也唱歌' }] },
    ] });
    expect(lineText(edited.present.lines[0])).toBe('今日 も歌う');
    expect(edited.past).toEqual([document]);
    expect(undoLyricCommand(edited).present).toBe(document);
    expect(() => executeLyricCommand(state, { type: 'batch', commands: [
      { type: 'split-word', lineId, wordId, at: 2, newWordId: 'rest' },
      { type: 'edit-word', lineId, wordId: 'missing', text: '失敗' },
    ] })).toThrow(/Word not found/);
    expect(state.present).toBe(document);
  });
});
