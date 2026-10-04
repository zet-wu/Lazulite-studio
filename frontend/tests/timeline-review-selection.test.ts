import { expect, it } from 'vitest';
import { createLine, createLyricDocument, createWord } from '../src/domain/lyric-document';
import { moveTimeline, resizeTimeline } from '../src/domain/timeline-editing';
import { selectionEnvelope, targetSelection, selectionTargets } from '../src/features/editor/selection-targets';
import { applyLyricCommand } from '../src/domain/lyric-commands';
import { deleteSelection } from '../src/features/editor/editing-actions';

function sample() {
  const d = createLyricDocument();
  d.lines = [createLine('first', 'a'), createLine('second', 'b')];
  d.lines.forEach((line, i) => { line.beginMs = 10000 + i * 3000; line.endMs = line.beginMs + 1000; line.words = [{ ...createWord(line.id, `w${i}`), beginMs: line.beginMs, endMs: line.endMs, rubyUnits: [{ id: `r${i}`, reading: line.id, beginMs: line.beginMs, endMs: line.endMs }] }]; });
  d.romanizationTracks = [{ id: 't', language: 'ja-Latn', contents: d.lines.map((line, i) => ({ id: `c${i}`, lineId: line.id, kind: 'timed', units: [{ id: `u${i}`, text: ' a ', beginMs: line.beginMs, endMs: line.endMs }] })) }];
  return d;
}
it('captures selection envelopes including gaps, rejects incomplete members and does not borrow parent endpoints', () => {
  const d = sample();
  const selection = targetSelection({ kind: 'word', lineId: 'a', wordId: 'w0' }, ['w0', 'w1']);
  expect(selectionEnvelope(d, selection, 20000).range).toEqual({ begin_ms: 10000, end_ms: 14000 });
  d.lines[1].words[0].endMs = null;
  expect(selectionEnvelope(d, selection, 20000).range).toBeUndefined();
  d.lines[1].words[0].endMs = 14000;
  expect(selectionEnvelope(d, selection, 13000).range).toBeUndefined();
  expect(selectionEnvelope(d, null, 20000).range).toBeUndefined();
  expect(selectionEnvelope(d, { kind: 'romanization-content', lineId: 'a', trackId: 't', contentId: 'c0', ids: ['c0', 'missing'], anchorId: 'c0', activeId: 'missing' }, 20000).range).toBeUndefined();
});
it('resolves and deletes Ruby and romanization across owners atomically', () => {
  const d = sample();
  const ruby = targetSelection({ kind: 'ruby', lineId: 'b', wordId: 'w1', rubyId: 'r1' }, ['r0', 'r1']);
  expect(selectionTargets(d, ruby).map(target => target.lineId)).toEqual(['a', 'b']);
  const removed = applyLyricCommand(d, deleteSelection(d, ruby));
  expect(removed.lines.flatMap(line => line.words.flatMap(word => word.rubyUnits))).toEqual([]);
  const roman = targetSelection({ kind: 'romanization', lineId: 'b', trackId: 't', contentId: 'c1', unitId: 'u1' }, ['u0', 'u1']);
  const deleted = applyLyricCommand(d, deleteSelection(d, roman));
  expect(deleted.romanizationTracks[0].contents.every(content => content.kind === 'timed' && !content.units.length)).toBe(true);
});
it('moves timed romanization without touching lyric timing, merges updates within a content and rejects the entire invalid group', () => {
  const d = sample();
  const selection = targetSelection({ kind: 'romanization', lineId: 'b', trackId: 't', contentId: 'c1', unitId: 'u1' }, ['u0', 'u1']);
  const targets = selectionTargets(d, selection);
  const moved = moveTimeline(d, targets, 500);
  expect(moved.lines).toBe(d.lines);
  expect(moved.romanizationTracks[0].contents.map(c => c.kind === 'timed' && c.units[0])).toEqual([
    { id: 'u0', text: ' a ', beginMs: 10500, endMs: 11500 }, { id: 'u1', text: ' a ', beginMs: 13500, endMs: 14500 },
  ]);
  expect(resizeTimeline(d, targets[0], 'endMs', 19000).lines).toBe(d.lines);
  expect(() => moveTimeline(d, targets, -11000)).toThrow();
  expect(d.romanizationTracks[0].contents[0]).toMatchObject({ units: [{ beginMs: 10000 }] });
});
