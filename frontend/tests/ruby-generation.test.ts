import { describe, expect, it } from 'vitest';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand, redoLyricCommand } from '../src/domain/lyric-commands';
import { createLyricDocument, createWord } from '../src/domain/lyric-document';
import { defaultRubySkips, proposeRuby, rubyGenerationCommand, rubySourceRows } from '../src/domain/ruby-generation';

describe('explicit transliteration to Ruby', () => {
  it('copies ko/na and yu/ki with independent time and extends the parent envelope once', () => {
    const document = createLyricDocument('粉雪');
    const line = document.lines[0];
    line.beginUs = 1_000_000; line.endUs = 4_000_000;
    line.words = [createWord('粉', 'powder'), createWord('雪', 'snow')];
    line.words[0].beginUs = 1_000_000; line.words[0].endUs = 2_000_000;
    line.words[1].beginUs = 2_000_000; line.words[1].endUs = 4_000_000;
    document.romanizationTracks.push({ id: 'latin', language: 'ja-Latn', contents: [{ id: 'c', lineId: line.id, kind: 'timed', units: [
      { id: 'ko', text: 'ko', beginUs: 999_000, endUs: 1_400_000 },
      { id: 'na', text: 'na', beginUs: 1_400_000, endUs: 2_000_000 },
      { id: 'yu', text: 'yu', beginUs: 2_000_000, endUs: 2_700_000 },
      { id: 'ki', text: 'ki', beginUs: 2_700_000, endUs: 4_000_000 },
    ] }] });
    const source = document.romanizationTracks[0];
    const rows = proposeRuby(rubySourceRows(document, 'latin', ['c']), 'hiragana');
    expect(rows.map((row) => [row.wordId, row.reading])).toEqual([['powder', 'こ'], ['powder', 'な'], ['snow', 'ゆ'], ['snow', 'き']]);
    expect(rubyGenerationCommand(document, document, rows, {}, new Set(), new Set())).toMatchObject({ type: 'batch' });
    const preview = rubyGenerationCommand(document, document, rows, {}, new Set(), new Set());
    const state = executeLyricCommand(createLyricEditorState(document), preview);
    expect(state.past).toHaveLength(1);
    expect(state.present.lines[0].beginUs).toBe(999_000);
    expect(state.present.lines[0].words[0].rubyUnits.map((unit) => [unit.reading, unit.beginUs, unit.endUs])).toEqual([['こ', 999_000, 1_400_000], ['な', 1_400_000, 2_000_000]]);
    expect(state.present.romanizationTracks[0]).toBe(source);
    expect(undoLyricCommand(state).present).toBe(document);
    expect(redoLyricCommand(undoLyricCommand(state)).present).toEqual(state.present);
    expect(() => rubyGenerationCommand(state.present, document, rows, {}, new Set(), new Set())).toThrow(/文档已变化/);
  });

  it('requires manual assignment for cross-word, plain and untimed sources and explicit overwrite', () => {
    const document = createLyricDocument('二人');
    const line = document.lines[0];
    line.beginUs = 0; line.endUs = 3_000_000;
    line.words = [createWord('二', 'two'), createWord('人', 'people')];
    line.words[0].beginUs = 0; line.words[0].endUs = 1_500_000;
    line.words[1].beginUs = 1_500_000; line.words[1].endUs = 3_000_000;
    line.words[0].rubyUnits = [{ id: 'old', reading: 'ふるい', beginUs: null, endUs: null }];
    document.romanizationTracks.push({ id: 'latin', language: null, contents: [
      { id: 'timed', lineId: line.id, kind: 'timed', units: [
        { id: 'fu', text: 'fu', beginUs: 1_400_000, endUs: 1_600_000 },
        { id: 'ta', text: 'ta', beginUs: null, endUs: null },
      ] },
      { id: 'plain', lineId: line.id, kind: 'plain', text: 'ri' },
    ] });
    const raw = rubySourceRows(document, 'latin', ['timed', 'plain']);
    expect(raw.map((row) => row.defaultWordId)).toEqual([null, null, null]);
    expect(raw[0].candidates).toEqual(['two', 'people']);
    const assigned = proposeRuby(raw, 'katakana', { 'timed:fu': 'two', 'timed:ta': 'two', 'plain:plain': 'two' });
    expect(assigned.map((row) => row.reading)).toEqual(['フ', 'タ', 'リ']);
    expect(() => rubyGenerationCommand(document, document, assigned, {}, new Set(), new Set())).toThrow(/显式选择覆盖/);
    const preview = rubyGenerationCommand(document, document, assigned, {}, new Set(), new Set(['two']));
    const state = executeLyricCommand(createLyricEditorState(document), preview);
    expect(state.present.lines[0].words[0].rubyUnits.map((unit) => [unit.reading, unit.beginUs])).toEqual([['フ', 1_400_000], ['タ', null], ['リ', null]]);
    expect(state.present.romanizationTracks).toBe(document.romanizationTracks);
  });

  it('flags a group whose conversion cannot be split uniquely across source units', () => {
    const document = createLyricDocument('学校');
    const line = document.lines[0];
    line.words[0].beginUs = 0; line.words[0].endUs = 2_000_000;
    document.romanizationTracks.push({ id: 'latin', language: null, contents: [{ id: 'c', lineId: line.id, kind: 'timed', units: [
      { id: 'k', text: 'k', beginUs: 0, endUs: 1_000_000 }, { id: 'ko', text: 'ko', beginUs: 1_000_000, endUs: 2_000_000 },
    ] }] });
    const rows = proposeRuby(rubySourceRows(document, 'latin', ['c']), 'hiragana');
    expect(rows[0].reading).toBeNull();
    expect(rows[0].conversionIssue).toMatch(/整组转换/);
    expect(proposeRuby(rubySourceRows(document, 'latin', ['c']), 'roman').map((row) => row.reading)).toEqual(['k', 'ko']);
  });
});

describe('P4 Ruby candidate tolerance and grouped defaults', () => {
  function fixture(beginUs: number | null, endUs: number | null) {
    const document = createLyricDocument('合成');
    const line = document.lines[0];
    line.beginUs = 0; line.endUs = 2_000_000;
    line.words = [createWord('が', 'left'), createWord('な', 'right')];
    line.words[0].beginUs = 0; line.words[0].endUs = 1_000_000;
    line.words[1].beginUs = 1_000_000; line.words[1].endUs = 2_000_000;
    document.romanizationTracks.push({ id: 'latin', language: 'ja', contents: [{ id: 'c', lineId: line.id, kind: 'timed', units: [{ id: 'u', text: 'na', beginUs, endUs }] }] });
    return document;
  }
  it('distinguishes touching, 1ms, exact 10ms, 10ms+1us, true crossing and tiny matches without mutating time', () => {
    for (const [begin, end, candidates, defaultId] of [
      [1_000_000, 1_500_000, ['right'], 'right'],
      [999_000, 1_500_000, ['right'], 'right'],
      [990_000, 1_500_000, ['right'], 'right'],
      [989_999, 1_500_000, ['right', 'left'], null],
      [500_000, 1_500_000, ['left', 'right'], null],
      [999_000, 1_001_000, ['left', 'right'], null],
      [1_000_000, 1_010_000, ['right'], null],
      [2_000_000, 3_000_000, [], null],
      [null, null, [], null],
    ] as const) {
      const document = fixture(begin, end), snapshot = JSON.stringify(document);
      const row = rubySourceRows(document, 'latin', ['c'])[0];
      expect(row.candidates).toEqual(candidates);
      expect(row.defaultWordId).toBe(defaultId);
      expect(JSON.stringify(document)).toBe(snapshot);
    }
  });
  it('matches L7 equivalent jitter and automatically extends envelopes when explicitly generated', () => {
    for (const [sourceBegin, sourceEnd, boundary, text, source] of [
      [146_904_000, 147_937_000, 146_905_000, 'が', 'ga'],
      [148_977_000, 149_594_000, 148_978_000, 'な', 'na'],
    ] as const) {
      const document = fixture(sourceBegin, sourceEnd), line = document.lines[0];
      line.beginUs = sourceBegin - 1_000_000; line.endUs = sourceEnd;
      line.words[0].beginUs = line.beginUs; line.words[0].endUs = boundary;
      Object.assign(line.words[1], { text, beginUs: boundary, endUs: sourceEnd });
      const content = document.romanizationTracks[0].contents[0];
      if (content.kind === 'timed') content.units[0].text = source;
      const rows = proposeRuby(rubySourceRows(document, 'latin', ['c']), 'hiragana');
      expect(rows[0].wordId).toBe('right');
      expect(defaultRubySkips(document, rows, 'hiragana', {})).toEqual(new Set(['c:u']));
      expect(rubyGenerationCommand(document, document, rows, {}, new Set(), new Set())).toMatchObject({ type: 'batch' });
    }
  });
  it('compares whole words with NFC only and preserves manual reading and conversion failures', () => {
    const document = fixture(0, 500_000), line = document.lines[0];
    line.words[0].text = 'がな';
    const content = document.romanizationTracks[0].contents[0];
    if (content.kind !== 'timed') throw new Error('fixture');
    content.units = [{ id: 'a', text: 'ga', beginUs: 0, endUs: 500_000 }, { id: 'b', text: 'na', beginUs: 500_000, endUs: 1_000_000 }];
    const raw = rubySourceRows(document, 'latin', ['c']);
    const rows = proposeRuby(raw, 'hiragana');
    expect(defaultRubySkips(document, rows, 'hiragana', {})).toEqual(new Set(['c:a', 'c:b']));
    line.words[0].text = 'か\u3099な';
    expect(defaultRubySkips(document, rows, 'hiragana', {})).toHaveProperty('size', 2);
    expect(defaultRubySkips(document, rows, 'hiragana', { 'c:a': 'が' })).toEqual(new Set(['c:b']));
    expect(defaultRubySkips(document, rows, 'hiragana', { 'c:a': 'か' }).size).toBe(0);
    for (const text of ['仮名', 'ガナ', 'が な', 'がな。', 'ｶﾞﾅ']) {
      line.words[0].text = text;
      expect(defaultRubySkips(document, rows, 'hiragana', {}).size).toBe(0);
    }
    line.words[0].text = 'ガナ';
    expect(defaultRubySkips(document, proposeRuby(raw, 'katakana'), 'katakana', {}).size).toBe(2);
    expect(defaultRubySkips(document, proposeRuby(raw, 'roman'), 'roman', {}).size).toBe(0);
    content.units[0].text = 'k';
    expect(defaultRubySkips(document, proposeRuby(rubySourceRows(document, 'latin', ['c']), 'hiragana'), 'hiragana', {}).size).toBe(0);
  });
});

it('automatic expansion retains link, assignment, reading and empty-generation guards', () => {
  const document = createLyricDocument('粉'), line = document.lines[0];
  line.beginUs = 1_000_000; line.endUs = 2_000_000;
  Object.assign(line.words[0], { beginUs: 1_000_000, endUs: 2_000_000 });
  document.romanizationTracks.push({ id: 'track', language: 'ja', contents: [{ id: 'content', lineId: line.id, kind: 'timed', units: [{ id: 'u', text: 'ko', beginUs: 999_000, endUs: 2_000_000 }] }] });
  const rows = proposeRuby(rubySourceRows(document, 'track', ['content']), 'hiragana');
  expect(() => rubyGenerationCommand(document, document, rows, {}, new Set([rows[0].key]), new Set())).toThrow('没有可应用');
  expect(() => rubyGenerationCommand(document, document, [{ ...rows[0], wordId: null }], {}, new Set(), new Set())).toThrow('尚未指定');
  expect(() => rubyGenerationCommand(document, document, [{ ...rows[0], reading: null }], {}, new Set(), new Set())).toThrow('尚未确认');
  line.endLink = { targetLineId: 'next', originalEndUs: 2_000_000 };
  expect(() => rubyGenerationCommand(document, document, rows, {}, new Set(), new Set())).toThrow('行尾链接');
  expect(line.beginUs).toBe(1_000_000); expect(line.words[0].rubyUnits).toHaveLength(0);
});

it('filters empty and whitespace Ruby sources without changing source times or creating an empty command', () => {
  const document = createLyricDocument('歌'), line = document.lines[0];
  line.words[0].beginUs = 1_000_000; line.words[0].endUs = 2_000_000;
  document.romanizationTracks = [{ id: 'track', language: null, contents: [{ id: 'c', lineId: line.id, kind: 'timed', units: [
    { id: 'empty', text: '', beginUs: 0, endUs: 3_000_000 },
    { id: 'space', text: ' \t\n　', beginUs: 0, endUs: 3_000_000 },
    { id: 'normal', text: 'uta', beginUs: 1_000_000, endUs: 2_000_000 },
  ] }, { id: 'plain', lineId: line.id, kind: 'plain', text: '   ' }] }];
  const snapshot = structuredClone(document);
  const rows = proposeRuby(rubySourceRows(document, 'track', ['c', 'plain']), 'hiragana');
  expect(rows.map(row => row.unitId)).toEqual(['normal']);
  const state = executeLyricCommand(createLyricEditorState(document), rubyGenerationCommand(document, document, rows, {}, new Set(), new Set()));
  expect(state.present.lines[0].words[0].beginUs).toBe(1_000_000);
  expect(state.present.romanizationTracks).toEqual(snapshot.romanizationTracks);
  expect(rubySourceRows(document, 'track', ['plain'])).toEqual([]);
  expect(() => rubyGenerationCommand(document, document, [], {}, new Set(), new Set())).toThrow();
  expect(document).toEqual(snapshot);
});
