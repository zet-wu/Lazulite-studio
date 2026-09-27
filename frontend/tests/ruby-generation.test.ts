import { describe, expect, it } from 'vitest';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand } from '../src/domain/lyric-commands';
import { createLyricDocument, createWord } from '../src/domain/lyric-document';
import { proposeRuby, rubyGenerationCommand, rubySourceRows } from '../src/domain/ruby-generation';

describe('explicit transliteration to Ruby', () => {
  it('copies ko/na and yu/ki with independent time and extends the parent envelope once', () => {
    const document = createLyricDocument('粉雪');
    const line = document.lines[0];
    line.beginUs = 1_000; line.endUs = 4_000;
    line.words = [createWord('粉', 'powder'), createWord('雪', 'snow')];
    line.words[0].beginUs = 1_000; line.words[0].endUs = 2_000;
    line.words[1].beginUs = 2_000; line.words[1].endUs = 4_000;
    document.romanizationTracks.push({ id: 'latin', language: 'ja-Latn', contents: [{ id: 'c', lineId: line.id, kind: 'timed', units: [
      { id: 'ko', text: 'ko', beginUs: 999, endUs: 1_400 },
      { id: 'na', text: 'na', beginUs: 1_400, endUs: 2_000 },
      { id: 'yu', text: 'yu', beginUs: 2_000, endUs: 2_700 },
      { id: 'ki', text: 'ki', beginUs: 2_700, endUs: 4_000 },
    ] }] });
    const source = document.romanizationTracks[0];
    const rows = proposeRuby(rubySourceRows(document, 'latin', ['c']), 'hiragana');
    expect(rows.map((row) => [row.wordId, row.reading])).toEqual([['powder', 'こ'], ['powder', 'な'], ['snow', 'ゆ'], ['snow', 'き']]);
    expect(() => rubyGenerationCommand(document, document, rows, {}, new Set(), new Set(), false)).toThrow(/包络扩展/);
    const preview = rubyGenerationCommand(document, document, rows, {}, new Set(), new Set(), true);
    expect(preview.extensions).toContainEqual({ kind: 'line', lineId: line.id, before: { beginUs: 1_000, endUs: 4_000 }, after: { beginUs: 999, endUs: 4_000 } });
    const state = executeLyricCommand(createLyricEditorState(document), preview.command);
    expect(state.past).toHaveLength(1);
    expect(state.present.lines[0].beginUs).toBe(999);
    expect(state.present.lines[0].words[0].rubyUnits.map((unit) => [unit.reading, unit.beginUs, unit.endUs])).toEqual([['こ', 999, 1_400], ['な', 1_400, 2_000]]);
    expect(state.present.romanizationTracks[0]).toBe(source);
    expect(undoLyricCommand(state).present).toBe(document);
    expect(() => rubyGenerationCommand(state.present, document, rows, {}, new Set(), new Set(), true)).toThrow(/文档已变化/);
  });

  it('requires manual assignment for cross-word, plain and untimed sources and explicit overwrite', () => {
    const document = createLyricDocument('二人');
    const line = document.lines[0];
    line.beginUs = 0; line.endUs = 3_000;
    line.words = [createWord('二', 'two'), createWord('人', 'people')];
    line.words[0].beginUs = 0; line.words[0].endUs = 1_500;
    line.words[1].beginUs = 1_500; line.words[1].endUs = 3_000;
    line.words[0].rubyUnits = [{ id: 'old', reading: 'ふるい', beginUs: null, endUs: null }];
    document.romanizationTracks.push({ id: 'latin', language: null, contents: [
      { id: 'timed', lineId: line.id, kind: 'timed', units: [
        { id: 'fu', text: 'fu', beginUs: 1_400, endUs: 1_600 },
        { id: 'ta', text: 'ta', beginUs: null, endUs: null },
      ] },
      { id: 'plain', lineId: line.id, kind: 'plain', text: 'ri' },
    ] });
    const raw = rubySourceRows(document, 'latin', ['timed', 'plain']);
    expect(raw.map((row) => row.defaultWordId)).toEqual([null, null, null]);
    expect(raw[0].candidates).toEqual(['two', 'people']);
    const assigned = proposeRuby(raw, 'katakana', { 'timed:fu': 'two', 'timed:ta': 'two', 'plain:plain': 'two' });
    expect(assigned.map((row) => row.reading)).toEqual(['フ', 'タ', 'リ']);
    expect(() => rubyGenerationCommand(document, document, assigned, {}, new Set(), new Set(), true)).toThrow(/显式选择覆盖/);
    const preview = rubyGenerationCommand(document, document, assigned, {}, new Set(), new Set(['two']), true);
    const state = executeLyricCommand(createLyricEditorState(document), preview.command);
    expect(state.present.lines[0].words[0].rubyUnits.map((unit) => [unit.reading, unit.beginUs])).toEqual([['フ', 1_400], ['タ', null], ['リ', null]]);
    expect(state.present.romanizationTracks).toBe(document.romanizationTracks);
  });

  it('flags a group whose conversion cannot be split uniquely across source units', () => {
    const document = createLyricDocument('学校');
    const line = document.lines[0];
    line.words[0].beginUs = 0; line.words[0].endUs = 2_000;
    document.romanizationTracks.push({ id: 'latin', language: null, contents: [{ id: 'c', lineId: line.id, kind: 'timed', units: [
      { id: 'k', text: 'k', beginUs: 0, endUs: 1_000 }, { id: 'ko', text: 'ko', beginUs: 1_000, endUs: 2_000 },
    ] }] });
    const rows = proposeRuby(rubySourceRows(document, 'latin', ['c']), 'hiragana');
    expect(rows[0].reading).toBeNull();
    expect(rows[0].conversionIssue).toMatch(/整组转换/);
    expect(proposeRuby(rubySourceRows(document, 'latin', ['c']), 'roman').map((row) => row.reading)).toEqual(['k', 'ko']);
  });
});
