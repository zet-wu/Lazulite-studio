import { describe, expect, it } from 'vitest';
import { createLyricDocument, lineText } from '../src/domain/lyric-document';
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
});
