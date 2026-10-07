import { expect, it } from 'vitest';
import { createLine, createLyricDocument, createWord } from '../src/domain/lyric-document';
import { projectTimeline } from '../src/domain/timeline-projection';
import { moveTimeline, resizeTimeline } from '../src/domain/timeline-editing';

it('uses shortest legal candidates without excluding real descendants or borrowing ghost siblings', () => {
  const doc = createLyricDocument('a'); const first = doc.lines[0];
  first.beginMs = 10000; first.words[0].endMs = 15000;
  doc.lines.push({ ...createLine('b'), beginMs: 12000, endMs: null });
  const shown = projectTimeline(doc, 180000);
  expect(shown.lines[0].endMs).toBe(180000);
  expect(shown.lines[0].words[0].beginMs).toBe(10000);
  expect(doc.lines[0].endMs).toBeNull(); expect(doc.lines[0].words[0].beginMs).toBeNull();
  expect(projectTimeline(doc).lines[0].endMs).toBeNull();
});
it('keeps unknown parents, uses actual sibling sides, handles media edges and independent backgrounds', () => {
  const doc = createLyricDocument('a'); const line = doc.lines[0];
  line.words = [{ ...createWord('a'), beginMs: 10000, endMs: null }, { ...createWord('b'), beginMs: 12000, endMs: null }];
  let shown = projectTimeline(doc, 180000);
  expect(shown.lines[0].beginMs).toBeNull(); expect(shown.lines[0].endMs).toBeNull();
  expect(shown.lines[0].words[0].endMs).toBe(12000);
  line.words[1].beginMs = 9000; shown = projectTimeline(doc, 180000);
  expect(shown.lines[0].words[0].endMs).toBe(180000);
  line.words[0].beginMs = 180000;
  expect(projectTimeline(doc, 180000).lines[0].words[0].endMs).toBe(180000);
  line.words[0].beginMs = 180001;
  expect(projectTimeline(doc, 180000).lines[0].words[0].endMs).toBeNull();
  doc.lines.push({ ...createLine('bg'), backgroundOf: line.id, beginMs: null, endMs: 20000 });
  expect(projectTimeline(doc, 30000).lines[1].beginMs).toBe(0);
});
it('resizes only the requested side without filling unknown ancestors and rejects group moves', () => {
  const doc = createLyricDocument('a'); const line = doc.lines[0], word = line.words[0];
  word.rubyUnits = [{ id: 'r', reading: 'あ', beginMs: 100, endMs: null }];
  const next = resizeTimeline(doc, { kind: 'ruby', lineId: line.id, wordId: word.id, rubyId: 'r' }, 'endMs', 200);
  expect(next.lines[0].words[0]).toMatchObject({ beginMs: null, endMs: null, rubyUnits: [{ beginMs: 100, endMs: 200 }] });
  expect(next.lines[0]).toMatchObject({ beginMs: null, endMs: null });
  line.beginMs = 0;
  expect(() => moveTimeline(doc, [{ kind: 'line', lineId: line.id }], 10)).toThrow('完整时间');
});
it('computes parents before children while using only real sibling endpoints and all descendant constraints', () => {
  const doc = createLyricDocument('');
  doc.lines = [{ ...createLine('prior'), beginMs: 0, endMs: 2000 }, { ...createLine('target'), beginMs: null, endMs: 3000 }];
  const row = doc.lines[1];
  row.words = [{ ...createWord('a'), beginMs: 1000, endMs: null, rubyUnits: [{ id: 'r', reading: 'あ', beginMs: 500, endMs: 2500 }] }, { ...createWord('b'), beginMs: 2000, endMs: null }];
  const shown = projectTimeline(doc, 5000);
  expect(shown.lines[1].beginMs).toBe(0); // 2000 excludes real descendants.
  expect(shown.lines[1].words[0].endMs).toBeNull(); // The known start already excludes its Ruby.
  row.words[0].beginMs = null; row.words[0].endMs = 2500;
  expect(projectTimeline(doc, 5000).lines[1].words[0].beginMs).toBe(0);
  expect(doc.lines[1].beginMs).toBeNull();
});
it('keeps romanization independent, discards reverse candidates and never projects two unknown endpoints', () => {
  const doc = createLyricDocument('a'), line = doc.lines[0]; line.beginMs = 100; line.endMs = 200;
  doc.romanizationTracks = [{ id: 't', language: null, contents: [{ id: 'c', lineId: line.id, kind: 'timed', units: [
    { id: 'u', text: 'a', beginMs: 300, endMs: null }, { id: 'v', text: 'b', beginMs: 400, endMs: null }, { id: 'unknown', text: 'c', beginMs: null, endMs: null },
  ] }] }];
  const units = (d: typeof doc) => { const c = d.romanizationTracks[0].contents[0]; if (c.kind !== 'timed') throw Error(); return c.units; };
  expect(units(projectTimeline(doc))[0].endMs).toBe(400);
  expect(units(projectTimeline(doc))[1].endMs).toBeNull();
  expect(units(projectTimeline(doc, 500))[1].endMs).toBe(500);
  expect(units(projectTimeline(doc, 500))[2]).toMatchObject({ beginMs: null, endMs: null });
});
it('resizing Ruby retains known parent sides when no Ruby supplies that side, and row resize includes real Ruby', () => {
  const doc = createLyricDocument('a'), row = doc.lines[0], word = row.words[0];
  row.beginMs = 0; row.endMs = null; word.beginMs = 10; word.endMs = null;
  word.rubyUnits = [{ id: 'r', reading: 'あ', beginMs: null, endMs: 100 }];
  const next = resizeTimeline(doc, { kind: 'ruby', lineId: row.id, wordId: word.id, rubyId: 'r' }, 'endMs', 200);
  expect(next.lines[0]).toMatchObject({ beginMs: 0, endMs: null });
  expect(next.lines[0].words[0]).toMatchObject({ beginMs: 10, endMs: null });
  expect(() => resizeTimeline(doc, { kind: 'line', lineId: row.id }, 'endMs', 50)).toThrow('不能排除');
});

it.each(['beginMs', 'endMs'] as const)('skips consecutive untimed whitespace for a background word missing %s without changing source data', side => {
  const doc = createLyricDocument('main');
  const background = { ...createLine(''), backgroundOf: doc.lines[0].id, beginMs: 147255, endMs: 151092 };
  background.words = [
    { ...createWord('scell'), beginMs: 147919, endMs: 148176 }, createWord(' '), createWord('\t\u3000'),
    { ...createWord('gungnir'), beginMs: 148176, endMs: 148528, [side]: null },
    createWord('\u3000'), createWord(' '), { ...createWord('tron)'), beginMs: 148528, endMs: 151092 },
  ];
  doc.lines.push(background);
  const before = structuredClone(doc);
  for (const duration of [null, 180000]) {
    const shown = projectTimeline(doc, duration).lines[1];
    expect(shown.words[3]).toMatchObject({ beginMs: 148176, endMs: 148528 });
    expect(shown.words.map(word => word.text)).toEqual(background.words.map(word => word.text));
    for (const index of [1, 2, 4, 5]) expect(shown.words[index]).toEqual(background.words[index]);
  }
  expect(doc).toEqual(before);
});

it.each([
  { text: ' ', beginMs: 12000, endMs: 13000, expectedBegin: 13000, expectedEnd: 12000 },
  { text: ' ', beginMs: 12000, endMs: null, expectedBegin: 1000, expectedEnd: 12000 },
  { text: ' ', beginMs: null, endMs: 13000, expectedBegin: 13000, expectedEnd: 20000 },
  { text: 'unknown', beginMs: null, endMs: null, expectedBegin: 1000, expectedEnd: 20000 },
  { text: '、', beginMs: null, endMs: null, expectedBegin: 1000, expectedEnd: 20000 },
])('retains the neighbor barrier for $text [$beginMs, $endMs]', ({ text, beginMs, endMs, expectedBegin, expectedEnd }) => {
  const doc = createLyricDocument(''); const line = doc.lines[0]; line.beginMs = 1000; line.endMs = 20000;
  line.words = [
    { ...createWord('left'), beginMs: 1000, endMs: 9000 }, createWord(' '),
    { ...createWord(text), beginMs, endMs }, createWord('\u3000'),
    { ...createWord('target'), beginMs: null, endMs: 15000 },
  ];
  expect(projectTimeline(doc).lines[0].words[4].beginMs).toBe(expectedBegin);
  line.words.reverse(); line.words[0].beginMs = 10000; line.words[0].endMs = null;
  expect(projectTimeline(doc).lines[0].words[0].endMs).toBe(expectedEnd);
});

it('filters skipped-whitespace candidates by direction and real Ruby bounds, and stays within the row', () => {
  const doc = createLyricDocument(''); const line = doc.lines[0]; line.beginMs = 1000; line.endMs = 20000;
  line.words = [{ ...createWord('target'), beginMs: 10000, endMs: null }, createWord(' '), { ...createWord('next'), beginMs: 9000, endMs: 16000 }];
  expect(projectTimeline(doc).lines[0].words[0].endMs).toBe(20000);
  line.words[2].beginMs = 12000;
  line.words[0].rubyUnits = [{ id: 'r', reading: 'あ', beginMs: 10000, endMs: 13000 }];
  expect(projectTimeline(doc).lines[0].words[0].endMs).toBe(20000);
  line.words[0].rubyUnits = [];
  expect(projectTimeline(doc).lines[0].words[0].endMs).toBe(12000);
  line.words.pop();
  doc.lines.push({ ...createLine('other row'), beginMs: 11000, endMs: 15000 });
  expect(projectTimeline(doc).lines[0].words[0].endMs).toBe(20000);
});
