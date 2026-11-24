import { expect, it } from 'vitest';
import { createLine, createLyricDocument, createWord } from '../src/domain/lyric-document';
import { resizeTimelineBoundary, timelineBoundaryTargets, type TimelineTarget } from '../src/domain/timeline-editing';
import { createProjectEditing } from '../src/domain/project-editing';
import { assertChangedTimes, lyricTimes } from '../src/domain/time-boundaries';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand, redoLyricCommand } from './helpers/project-history';

function sample() {
  const document = createLyricDocument('');
  const line = document.lines[0];
  Object.assign(line, { beginMs: 0, endMs: 3000 });
  line.words = ['甲', ' ', '乙'].map((text, index) => ({ ...createWord(text, `w${index}`), beginMs: index === 1 ? null : index * 500, endMs: index === 1 ? null : index * 500 + 1000 }));
  const target: TimelineTarget = { kind: 'word', lineId: line.id, wordId: 'w0' };
  return { document, line, target };
}

it('links touching leaves across untimed whitespace with one undo/redo and symmetric begin drag', () => {
  const { document, line, target } = sample();
  const next = resizeTimelineBoundary(document, target, 'endMs', 1300, true);
  expect(next.lines[0].words.map(word => [word.beginMs, word.endMs])).toEqual([[0, 1300], [null, null], [1300, 2000]]);
  const state = executeLyricCommand(createLyricEditorState(document), { type: 'replace-document', document: next });
  const undone = undoLyricCommand(state);
  expect(undone.present).toBe(document);
  expect(redoLyricCommand(undone).present).toBe(next);
  const back = resizeTimelineBoundary(document, { kind: 'word', lineId: line.id, wordId: 'w2' }, 'beginMs', 800, true);
  expect(back.lines[0].words[0].endMs).toBe(800);
  expect(back.lines[0].words[2].beginMs).toBe(800);
  expect(resizeTimelineBoundary(document, target, 'endMs', 1300, false).lines[0].words[2].beginMs).toBe(1000);
});

it.each([900, 1100])('falls back for overlap/gap at %i, and never skips an untimed nonblank word', begin => {
  const { document, line, target } = sample();
  line.words[2].beginMs = begin;
  expect(resizeTimelineBoundary(document, target, 'endMs', 1200, true).lines[0].words[2].beginMs).toBe(begin);
  line.words[1].text = '未定时'; line.words[2].beginMs = 1000;
  expect(timelineBoundaryTargets(document, target, 'endMs', true)).toHaveLength(1);
});

it('uses a timed blank as an adjacent leaf and stops at the row boundary', () => {
  const { document, line, target } = sample();
  Object.assign(line.words[1], { beginMs: 1000, endMs: 1000 });
  expect(resizeTimelineBoundary(document, target, 'endMs', 1200, true).lines[0].words[1]).toMatchObject({ beginMs: 1200, endMs: 1000 });
  const next = resizeTimelineBoundary(document, target, 'endMs', 900, true);
  expect(next.lines[0].words[1].beginMs).toBe(900);
  expect(next.lines[0].words[2].beginMs).toBe(1000);
  document.lines.push({ ...createLine('下行'), beginMs: 2000, endMs: 4000 });
  expect(timelineBoundaryTargets(document, { kind: 'word', lineId: line.id, wordId: 'w2' }, 'endMs', true)).toHaveLength(1);
});

it.each(['same-word', 'cross-word', 'ruby-word', 'word-ruby'] as const)('resizes leaf adjacency %s and updates both word envelopes', kind => {
  const { document, line } = sample();
  line.words = line.words.filter(word => word.text.trim());
  const [a, b] = line.words;
  const r = (id: string, beginMs: number, endMs: number) => ({ id, reading: id, beginMs, endMs });
  if (kind === 'same-word') { a.endMs = 2000; a.rubyUnits = [r('a', 0, 1000), r('b', 1000, 2000)]; }
  if (kind === 'cross-word' || kind === 'ruby-word') a.rubyUnits = [r('a', 0, 1000)];
  if (kind === 'cross-word' || kind === 'word-ruby') b.rubyUnits = [r('b', 1000, 2000)];
  const target: TimelineTarget = kind === 'word-ruby' ? { kind: 'word', lineId: line.id, wordId: a.id } : { kind: 'ruby', lineId: line.id, wordId: a.id, rubyId: 'a' };
  const next = resizeTimelineBoundary(document, target, 'endMs', 1200, true).lines[0];
  if (kind === 'same-word') {
    expect(next.words[0].rubyUnits.map(unit => [unit.beginMs, unit.endMs])).toEqual([[0, 1200], [1200, 2000]]);
    expect(next.words[0].endMs).toBe(2000);
  } else {
    expect(next.words[0].endMs).toBe(1200); expect(next.words[1].beginMs).toBe(1200);
  }
});

it('word handles carry coincident ruby endpoints, protect inset readings and allow reversed neighbors atomically', () => {
  const { document, line, target } = sample();
  const [a, , b] = line.words;
  a.rubyUnits = [{ id: 'a', reading: 'a', beginMs: 0, endMs: 1000 }];
  b.rubyUnits = [{ id: 'b', reading: 'b', beginMs: 1000, endMs: 2000 }];
  const original = structuredClone(document);
  const next = resizeTimelineBoundary(document, target, 'endMs', 1200, true).lines[0];
  expect(next.words[0].rubyUnits[0].endMs).toBe(1200);
  expect(next.words[2].rubyUnits[0].beginMs).toBe(1200);
  expect(resizeTimelineBoundary(document, target, 'endMs', 2100, true).lines[0].words[2]).toMatchObject({ beginMs: 2100, endMs: 2000 });
  expect(document).toEqual(original);
  a.rubyUnits[0].endMs = 900; b.rubyUnits[0].beginMs = 1100;
  const inset = resizeTimelineBoundary(document, target, 'endMs', 1050, true).lines[0];
  expect(inset.words[0].rubyUnits[0].endMs).toBe(900);
  expect(inset.words[2].rubyUnits[0].beginMs).toBe(1100);
  expect(() => resizeTimelineBoundary(document, target, 'endMs', 1150, true)).toThrow('timeline.wordExcludesRuby');
  expect(() => resizeTimelineBoundary(document, target, 'endMs', 850, true)).toThrow('timeline.wordExcludesRuby');
});

it.each(['romanizationTracks', 'translationTracks'] as const)('links only adjacent timed units within the same content in %s', key => {
  const { document, line } = sample();
  document[key] = [{ id: 't', language: 'ja', purpose: 'subtitle' as const, contents: [{ id: 'c', lineId: line.id, kind: 'timed', units: [{ id: 'u1', text: 'a', beginMs: 0, endMs: 1000 }, { id: 'u2', text: 'b', beginMs: 1000, endMs: 2000 }] }] }];
  const target: TimelineTarget = { kind: 'romanization', ...(key === 'translationTracks' ? { attachment: 'translation' as const } : {}), lineId: line.id, trackId: 't', contentId: 'c', unitId: 'u2' };
  const content = resizeTimelineBoundary(document, target, 'beginMs', 700, true)[key][0].contents[0];
  expect(content.kind === 'timed' && content.units.map(unit => [unit.beginMs, unit.endMs])).toEqual([[0, 700], [700, 2000]]);
});

it('retains media-duration checks for the whole candidate', () => {
  const { document: source, target: word } = sample();
  const next = resizeTimelineBoundary(source, word, 'endMs', 1800, true);
  expect(() => assertChangedTimes(lyricTimes(source), lyricTimes(next), 1500)).toThrow('time.endOutsideSource');
});

it.each([false, true])('links the same word boundary from either handle with inset ruby on the left=%s', rubyOnLeft => {
  const { document, line } = sample();
  line.words = line.words.filter(word => word.text.trim());
  const [a, b] = line.words;
  Object.assign(a, { beginMs: 1000, endMs: 1500 }); Object.assign(b, { beginMs: 1500, endMs: 2000 });
  const owner = rubyOnLeft ? a : b;
  owner.rubyUnits = [{ id: 'inset', reading: '音', beginMs: rubyOnLeft ? 1200 : 1550, endMs: rubyOnLeft ? 1450 : 1750 }];
  const left: TimelineTarget = { kind: 'word', lineId: line.id, wordId: a.id };
  const right: TimelineTarget = { kind: 'word', lineId: line.id, wordId: b.id };
  const time = rubyOnLeft ? 1480 : 1520;
  const fromLeft = resizeTimelineBoundary(document, left, 'endMs', time, true);
  const fromRight = resizeTimelineBoundary(document, right, 'beginMs', time, true);
  expect(fromLeft).toEqual(fromRight);
  expect(fromLeft.lines[0].words.map(word => [word.beginMs, word.endMs])).toEqual([[1000, time], [time, 2000]]);
  expect(fromLeft.lines[0].words[rubyOnLeft ? 0 : 1].rubyUnits).toEqual(owner.rubyUnits);
  const rejected = rubyOnLeft ? 1440 : 1560;
  for (const [target, side] of [[left, 'endMs'], [right, 'beginMs']] as const)
    expect(() => resizeTimelineBoundary(document, target, side, rejected, true)).toThrow('timeline.wordExcludesRuby');
  const state = executeLyricCommand(createLyricEditorState(document), { type: 'replace-document', document: fromLeft });
  expect(undoLyricCommand(state).present).toBe(document);
  expect(redoLyricCommand(undoLyricCommand(state)).present).toBe(fromLeft);
});

it('ruby linking preserves the unrelated padding at both owners and matches the opposite handle', () => {
  const { document, line } = sample();
  line.words = line.words.filter(word => word.text.trim());
  const [a, b] = line.words;
  a.beginMs = 50; a.rubyUnits = [{ id: 'ra', reading: '甲', beginMs: 100, endMs: 1000 }];
  b.endMs = 2050; b.rubyUnits = [{ id: 'rb', reading: '乙', beginMs: 1000, endMs: 2000 }];
  const left: TimelineTarget = { kind: 'ruby', lineId: line.id, wordId: a.id, rubyId: 'ra' };
  const right: TimelineTarget = { kind: 'ruby', lineId: line.id, wordId: b.id, rubyId: 'rb' };
  const fromLeft = resizeTimelineBoundary(document, left, 'endMs', 1200, true);
  expect(fromLeft).toEqual(resizeTimelineBoundary(document, right, 'beginMs', 1200, true));
  expect(fromLeft.lines[0].words.map(word => [word.beginMs, word.endMs])).toEqual([[50, 1200], [1200, 2050]]);
  const unlinked = resizeTimelineBoundary(document, left, 'endMs', 1200, false);
  expect(unlinked.lines[0].words[0].beginMs).toBe(50);
  expect(unlinked.lines[0].words[1]).toBe(b);
});

it('an internal linked ruby boundary preserves both outer word margins', () => {
  const { document, line } = sample(); const word = line.words[0];
  Object.assign(word, { beginMs: 50, endMs: 2050 });
  word.rubyUnits = [{ id: 'r1', reading: '甲', beginMs: 100, endMs: 1000 }, { id: 'r2', reading: '乙', beginMs: 1000, endMs: 2000 }];
  const target: TimelineTarget = { kind: 'ruby', lineId: line.id, wordId: word.id, rubyId: 'r1' };
  const next = resizeTimelineBoundary(document, target, 'endMs', 1200, true).lines[0].words[0];
  expect(next).toMatchObject({ beginMs: 50, endMs: 2050, rubyUnits: [{ beginMs: 100, endMs: 1200 }, { beginMs: 1200, endMs: 2000 }] });
});
