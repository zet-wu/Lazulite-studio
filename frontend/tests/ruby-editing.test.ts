import { describe, expect, it } from 'vitest';
import { parseLyricTtml, serializeLyricTtml } from '../src/adapters/ttml/lyric-codec';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand } from '../src/domain/lyric-commands';
import { createLyricDocument, createWord } from '../src/domain/lyric-document';
import { distributeRubyTime, makeRubyUnits, readingFromRomanization, splitReadingMora } from '../src/domain/ruby-editing';

describe('E4 注音 editing', () => {
  it('converts romaji and separates mora without breaking yoon, sokuon, long vowels or emoji graphemes', () => {
    expect(readingFromRomanization('kyou')).toBe('きょう');
    expect(splitReadingMora('きょう')).toEqual(['きょ', 'う']);
    expect(splitReadingMora('がっこう')).toEqual(['が', 'っ', 'こ', 'う']);
    expect(splitReadingMora('スーパー')).toEqual(['ス', 'ー', 'パ', 'ー']);
    expect(splitReadingMora('きょ😊')).toEqual(['きょ', '😊']);
    expect(() => readingFromRomanization('hello 😊')).toThrow(/假名/);
  });

  it('inserts, splits, merges and redistributes independently timed 注音 units with one-step undo', () => {
    const document = createLyricDocument('今日');
    const line = document.lines[0], word = line.words[0];
    line.beginMs = 1000; line.endMs = 2000;
    word.beginMs = 1000; word.endMs = 2000;
    let state = createLyricEditorState(document);
    state = executeLyricCommand(state, { type: 'add-ruby', lineId: line.id, wordId: word.id, reading: 'きょう', rubyId: 'r1' });
    state = executeLyricCommand(state, { type: 'split-ruby', lineId: line.id, wordId: word.id, rubyId: 'r1', at: 2, newRubyId: 'r2' });
    state = executeLyricCommand(state, { type: 'redistribute-ruby-time', lineId: line.id, wordId: word.id });
    expect(state.present.lines[0].words[0].rubyUnits.map((unit) => [unit.reading, unit.beginMs, unit.endMs])).toEqual([
      ['きょ', 1000, 1500], ['う', 1500, 2000],
    ]);
    const beforeMerge = state.present;
    state = executeLyricCommand(state, { type: 'merge-ruby', lineId: line.id, wordId: word.id, firstRubyId: 'r1', secondRubyId: 'r2' });
    expect(state.present.lines[0].words[0].rubyUnits).toEqual([{ id: 'r1', reading: 'きょう', beginMs: 1000, endMs: 2000 }]);
    expect(undoLyricCommand(state).present).toBe(beforeMerge);
    const inserted = executeLyricCommand(state, { type: 'insert-ruby', lineId: line.id, wordId: word.id, afterRubyId: null, reading: '新', rubyId: 'head' });
    expect(inserted.present.lines[0].words[0].rubyUnits[0].id).toBe('head');
  });

  it('merges contiguous words into a single 注音 base and keeps the rest of the line shared', () => {
    const document = createLyricDocument('今');
    const line = document.lines[0];
    line.words.push(createWord('日', 'day'), createWord('も', 'also'));
    const state = executeLyricCommand(createLyricEditorState(document), { type: 'batch', commands: [
      { type: 'merge-words', lineId: line.id, firstWordId: line.words[0].id, secondWordId: 'day' },
      { type: 'add-ruby', lineId: line.id, wordId: line.words[0].id, reading: 'きょう', rubyId: 'reading' },
    ] });
    expect(state.present.lines[0].words.map((word) => word.text)).toEqual(['今日', 'も']);
    expect(state.present.lines[0].words[0].rubyUnits[0].reading).toBe('きょう');
    expect(state.present.lines[0].words[1]).toBe(line.words[2]);
    expect(undoLyricCommand(state).present).toBe(document);
  });

  it('generates 注音 without overwriting manual units and survives TTML draft/final round trips', () => {
    const document = createLyricDocument('宇宙');
    const line = document.lines[0], word = line.words[0];
    line.beginMs = 3000; line.endMs = 4000;
    word.beginMs = 3000; word.endMs = 4000;
    const units = makeRubyUnits(word, splitReadingMora(readingFromRomanization('sora')));
    const state = executeLyricCommand(createLyricEditorState(document), { type: 'set-ruby-units', lineId: line.id, wordId: word.id, units });
    expect(state.present.lines[0].words[0].rubyUnits.map((unit) => unit.reading)).toEqual(['そ', 'ら']);
    expect(() => executeLyricCommand(state, { type: 'set-ruby-units', lineId: line.id, wordId: word.id, units: makeRubyUnits(word, ['う']) })).toThrow(/手动 注音/);
    for (const draft of [true, false]) {
      const reopened = parseLyricTtml(serializeLyricTtml(state.present, { draft }));
      expect(reopened.lines[0].words[0].rubyUnits.map((unit) => [unit.reading, unit.beginMs, unit.endMs])).toEqual([
        ['そ', 3000, 3500], ['ら', 3500, 4000],
      ]);
    }
    expect(distributeRubyTime({ ...word, endMs: null }, units).map((unit) => [unit.beginMs, unit.endMs])).toEqual([
      [3000, null], [null, null],
    ]);
  });
});
