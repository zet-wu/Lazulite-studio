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
