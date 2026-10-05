import { describe, expect, it } from 'vitest';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand, redoLyricCommand } from '../src/domain/lyric-commands';
import { createLyricDocument, createWord } from '../src/domain/lyric-document';
import { defaultRubySkips, rubyGenerationIssues, nextRubyIssue, proposeRuby, rubyGenerationCommand, rubySourceRows } from '../src/domain/ruby-generation';

describe('explicit transliteration to 注音', () => {
  it('copies ko/na and yu/ki with independent time and extends the parent envelope once', () => {
    const document = createLyricDocument('粉雪');
    const line = document.lines[0];
    line.beginMs = 1000; line.endMs = 4000;
    line.words = [createWord('粉', 'powder'), createWord('雪', 'snow')];
    line.words[0].beginMs = 1000; line.words[0].endMs = 2000;
    line.words[1].beginMs = 2000; line.words[1].endMs = 4000;
    document.romanizationTracks.push({ id: 'latin', language: 'ja-Latn', contents: [{ id: 'c', lineId: line.id, kind: 'timed', units: [
      { id: 'ko', text: 'ko', beginMs: 999, endMs: 1400 },
      { id: 'na', text: 'na', beginMs: 1400, endMs: 2000 },
      { id: 'yu', text: 'yu', beginMs: 2000, endMs: 2700 },
      { id: 'ki', text: 'ki', beginMs: 2700, endMs: 4000 },
    ] }] });
    const source = document.romanizationTracks[0];
    const rows = proposeRuby(rubySourceRows(document, 'latin', ['c']), 'hiragana');
    expect(rows.map((row) => [row.wordId, row.reading])).toEqual([['powder', 'こ'], ['powder', 'な'], ['snow', 'ゆ'], ['snow', 'き']]);
    expect(rubyGenerationCommand(document, document, rows, {}, new Set(), new Set())).toMatchObject({ type: 'batch' });
    const preview = rubyGenerationCommand(document, document, rows, {}, new Set(), new Set());
    const state = executeLyricCommand(createLyricEditorState(document), preview);
    expect(state.past).toHaveLength(1);
    expect(state.present.lines[0].beginMs).toBe(999);
    expect(state.present.lines[0].words[0].rubyUnits.map((unit) => [unit.reading, unit.beginMs, unit.endMs])).toEqual([['こ', 999, 1400], ['な', 1400, 2000]]);
    expect(state.present.romanizationTracks[0]).toBe(source);
    expect(undoLyricCommand(state).present).toBe(document);
    expect(redoLyricCommand(undoLyricCommand(state)).present).toEqual(state.present);
    expect(() => rubyGenerationCommand(state.present, document, rows, {}, new Set(), new Set())).toThrow(/文档已变化/);
  });

  it('requires manual assignment for cross-word, plain and untimed sources and explicit overwrite', () => {
    const document = createLyricDocument('二人');
    const line = document.lines[0];
    line.beginMs = 0; line.endMs = 3000;
    line.words = [createWord('二', 'two'), createWord('人', 'people')];
    line.words[0].beginMs = 0; line.words[0].endMs = 1500;
    line.words[1].beginMs = 1500; line.words[1].endMs = 3000;
    line.words[0].rubyUnits = [{ id: 'old', reading: 'ふるい', beginMs: null, endMs: null }];
    document.romanizationTracks.push({ id: 'latin', language: null, contents: [
      { id: 'timed', lineId: line.id, kind: 'timed', units: [
        { id: 'fu', text: 'fu', beginMs: 1400, endMs: 1600 },
        { id: 'ta', text: 'ta', beginMs: null, endMs: null },
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
    expect(state.present.lines[0].words[0].rubyUnits.map((unit) => [unit.reading, unit.beginMs])).toEqual([['フ', 1400], ['タ', null], ['リ', null]]);
    expect(state.present.romanizationTracks).toBe(document.romanizationTracks);
  });

  it('flags a group whose conversion cannot be split uniquely across source units', () => {
    const document = createLyricDocument('学校');
    const line = document.lines[0];
    line.words[0].beginMs = 0; line.words[0].endMs = 2000;
    document.romanizationTracks.push({ id: 'latin', language: null, contents: [{ id: 'c', lineId: line.id, kind: 'timed', units: [
      { id: 'k', text: 'k', beginMs: 0, endMs: 1000 }, { id: 'ko', text: 'ko', beginMs: 1000, endMs: 2000 },
    ] }] });
    const rows = proposeRuby(rubySourceRows(document, 'latin', ['c']), 'hiragana');
    expect(rows[0].reading).toBeNull();
    expect(rows[0].conversionIssue).toMatch(/整组转换/);
    expect(proposeRuby(rubySourceRows(document, 'latin', ['c']), 'roman').map((row) => row.reading)).toEqual(['k', 'ko']);
  });
});

describe('P4 注音 candidate tolerance and grouped defaults', () => {
  function fixture(beginMs: number | null, endMs: number | null) {
    const document = createLyricDocument('合成');
    const line = document.lines[0];
    line.beginMs = 0; line.endMs = 2000;
    line.words = [createWord('が', 'left'), createWord('な', 'right')];
    line.words[0].beginMs = 0; line.words[0].endMs = 1000;
    line.words[1].beginMs = 1000; line.words[1].endMs = 2000;
    document.romanizationTracks.push({ id: 'latin', language: 'ja', contents: [{ id: 'c', lineId: line.id, kind: 'timed', units: [{ id: 'u', text: 'na', beginMs, endMs }] }] });
    return document;
  }
  it('distinguishes touching, 1ms, 49ms, exact 50ms, 51ms, true crossing and tiny matches without mutating time', () => {
    for (const [begin, end, candidates, defaultId] of [
      [1000, 1500, ['right'], 'right'],
      [999, 1500, ['right'], 'right'],
      [951, 1500, ['right'], 'right'],
      [949, 1500, ['right', 'left'], null],
      [500, 1500, ['left', 'right'], null],
      [999, 1001, ['left', 'right'], null],
      [1000, 1049, ['right'], null],
      [1000, 1050, ['right'], null],
      [1000, 1051, ['right'], 'right'],
      [950, 1500, ['right'], 'right'],
      [2000, 3000, [], null],
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
      [146904, 147937, 146905, 'が', 'ga'],
      [148977, 149594, 148978, 'な', 'na'],
    ] as const) {
      const document = fixture(sourceBegin, sourceEnd), line = document.lines[0];
      line.beginMs = sourceBegin - 1000; line.endMs = sourceEnd;
      line.words[0].beginMs = line.beginMs; line.words[0].endMs = boundary;
      Object.assign(line.words[1], { text, beginMs: boundary, endMs: sourceEnd });
      const content = document.romanizationTracks[0].contents[0];
      if (content.kind === 'timed') content.units[0].text = source;
      const rows = proposeRuby(rubySourceRows(document, 'latin', ['c']), 'hiragana');
      expect(rows[0].wordId).toBe('right');
      expect(defaultRubySkips(document, rows, 'hiragana', {})).toEqual(new Set(['c:u']));
      expect(rubyGenerationCommand(document, document, rows, {}, new Set(), new Set())).toMatchObject({ type: 'batch' });
    }
  });
  it('compares whole words with NFC only and preserves manual reading and conversion failures', () => {
    const document = fixture(0, 500), line = document.lines[0];
    line.words[0].text = 'がな';
    const content = document.romanizationTracks[0].contents[0];
    if (content.kind !== 'timed') throw new Error('fixture');
    content.units = [{ id: 'a', text: 'ga', beginMs: 0, endMs: 500 }, { id: 'b', text: 'na', beginMs: 500, endMs: 1000 }];
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
  line.beginMs = 1000; line.endMs = 2000;
  Object.assign(line.words[0], { beginMs: 1000, endMs: 2000 });
  document.romanizationTracks.push({ id: 'track', language: 'ja', contents: [{ id: 'content', lineId: line.id, kind: 'timed', units: [{ id: 'u', text: 'ko', beginMs: 999, endMs: 2000 }] }] });
  const rows = proposeRuby(rubySourceRows(document, 'track', ['content']), 'hiragana');
  expect(() => rubyGenerationCommand(document, document, rows, {}, new Set([rows[0].key]), new Set())).toThrow('没有可应用');
  expect(() => rubyGenerationCommand(document, document, [{ ...rows[0], wordId: null }], {}, new Set(), new Set())).toThrow('尚未指定');
  expect(() => rubyGenerationCommand(document, document, [{ ...rows[0], reading: null }], {}, new Set(), new Set())).toThrow('尚未确认');
  line.endLink = { targetLineId: 'next'};
  expect(() => rubyGenerationCommand(document, document, rows, {}, new Set(), new Set())).toThrow('行尾链接');
  expect(line.beginMs).toBe(1000); expect(line.words[0].rubyUnits).toHaveLength(0);
});

it('filters empty and whitespace 注音 sources without changing source times or creating an empty command', () => {
  const document = createLyricDocument('歌'), line = document.lines[0];
  line.words[0].beginMs = 1000; line.words[0].endMs = 2000;
  document.romanizationTracks = [{ id: 'track', language: null, contents: [{ id: 'c', lineId: line.id, kind: 'timed', units: [
    { id: 'empty', text: '', beginMs: 0, endMs: 3000 },
    { id: 'space', text: ' \t\n　', beginMs: 0, endMs: 3000 },
    { id: 'normal', text: 'uta', beginMs: 1000, endMs: 2000 },
  ] }, { id: 'plain', lineId: line.id, kind: 'plain', text: '   ' }] }];
  const snapshot = structuredClone(document);
  const rows = proposeRuby(rubySourceRows(document, 'track', ['c', 'plain']), 'hiragana');
  expect(rows.map(row => row.unitId)).toEqual(['normal']);
  const state = executeLyricCommand(createLyricEditorState(document), rubyGenerationCommand(document, document, rows, {}, new Set(), new Set()));
  expect(state.present.lines[0].words[0].beginMs).toBe(1000);
  expect(state.present.romanizationTracks).toEqual(snapshot.romanizationTracks);
  expect(rubySourceRows(document, 'track', ['plain'])).toEqual([]);
  expect(() => rubyGenerationCommand(document, document, [], {}, new Set(), new Set())).toThrow();
  expect(document).toEqual(snapshot);
});

it('filters only explicit punctuation before conversion', () => {
  const document = createLyricDocument('歌'), line = document.lines[0];
  const removed = ['', '　', ' ,。()「」… ', '“”！？'];
  const retained = ['ー', '-', "'", '々', '★', '123', 'ka,', 'ka', '（ ka ）'];
  document.romanizationTracks = [{ id: 't', language: null, contents: [{ id: 'c', lineId: line.id, kind: 'timed', units:
    [...removed, ...retained].map((text, i) => ({ id: String(i), text, beginMs: null, endMs: null })) }] }];
  const snapshot = structuredClone(document);
  expect(rubySourceRows(document, 't', ['c']).map(row => row.sourceText)).toEqual(retained);
  expect(document).toEqual(snapshot);
});

describe('structured reverse-ruby issues', () => {
  function fixture(text = 'かな') {
    const document = createLyricDocument(text), line = document.lines[0];
    line.beginMs = 0; line.endMs = 1000;
    Object.assign(line.words[0], { beginMs: 0, endMs: 1000 });
    document.romanizationTracks = [{ id: 't', language: null, contents: [{ id: 'c', lineId: line.id, kind: 'timed',
      units: [{ id: 'a', text: 'ka', beginMs: 0, endMs: 500 }, { id: 'b', text: 'ni', beginMs: 500, endMs: 1000 }] }] }];
    const rows = proposeRuby(rubySourceRows(document, 't', ['c']), 'hiragana');
    const issues = (readings = {}, skipped = new Set<string>(), output: 'hiragana' | 'roman' = 'hiragana') =>
      rubyGenerationIssues(document, rows, readings, skipped, new Set(), output);
    return { document, line, rows, issues };
  }
  it('compares entire groups, folds kana scripts only, and keeps differences nonblocking', () => {
    const { document, line, rows, issues } = fixture();
    expect(issues()).toMatchObject([{ kind: 'kana-difference', severity: 'warning', rowKeys: ['c:a', 'c:b'] }]);
    expect(() => rubyGenerationCommand(document, document, rows, {}, new Set(), new Set())).not.toThrow();
    expect(issues({ 'c:b': 'な' })).toEqual([]);
    expect(issues({}, new Set(['c:a']))).toMatchObject([{ rowKeys: ['c:b'] }]);
    expect(issues({ 'c:b': 'な' }, new Set(['c:a']))).toEqual([]);
    expect(issues({}, new Set(['c:a', 'c:b']))).toEqual([]);
    line.words[0].text = 'カニ';
    expect(issues()).toEqual([]);
    expect(defaultRubySkips(document, rows, 'hiragana', {}).size).toBe(0);
    line.words[0].text = '漢字'; expect(issues()).toEqual([]);
    line.words[0].text = 'かな'; expect(issues({}, new Set(), 'roman')).toEqual([]);
    for (const [text, reading] of [['は', 'わ'], ['へ', 'え'], ['が', 'が']]) {
      line.words[0].text = text;
      const result = issues({ 'c:a': reading, 'c:b': 'ー' });
      expect(result).toHaveLength(1);
    }
  });
  it('collects target, reading, overwrite and link errors without stale conversion gates', () => {
    const { document, line, rows, issues } = fixture();
    rows[0].reading = null; rows[0].conversionIssue = '整组转换：请确认';
    expect(issues().map(issue => issue.kind)).toEqual(['reading']);
    expect(issues({ 'c:a': 'か', 'c:b': 'な' })).toEqual([]);
    line.words[0].rubyUnits = [{ id: 'old', reading: 'か', beginMs: 0, endMs: 1000 }];
    line.endLink = { targetLineId: 'next' }; rows[1].endMs = 1001;
    const result = issues();
    expect(result.map(issue => issue.kind)).toEqual(['reading', 'overwrite', 'link']);
    const skipped = new Set(rows.map(row => row.key));
    expect(issues({}, skipped)).toEqual([]);
    rows[0].wordId = null;
    expect(issues().map(issue => issue.kind)).toContain('target');
    expect(() => rubyGenerationCommand(document, document, rows, {}, new Set(), new Set())).toThrow('目标词');
  });
  it('continues after a removed issue, cycles and shares direct-selection position', () => {
    const { rows, issues } = fixture();
    rows.forEach(row => { row.wordId = null; row.reading = null; });
    const all = issues();
    expect(nextRubyIssue(all, null)).toBe(all[0]);
    expect(nextRubyIssue(all, all[0])).toBe(all[1]);
    expect(nextRubyIssue(all.slice(2), all[1])).toBe(all[2]);
    expect(nextRubyIssue(all, all.at(-1)!)).toBe(all[0]);
    expect(nextRubyIssue([all[0]], all[0])).toBe(all[0]);
    expect(nextRubyIssue([], all[0])).toBeNull();
  });
});
