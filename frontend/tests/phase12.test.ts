import { createProjectEditing, emptyBeatCount, setEmptyBeat } from '../src/domain/project-editing';
import { describe, expect, it } from 'vitest';
import { createLine, createLyricDocument, createWord } from '../src/domain/lyric-document';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand, redoLyricCommand } from './helpers/project-history';

const fixture = () => {
  const document = createLyricDocument('');
  const line = document.lines[0];
  line.words = ['今', ' ', '日', '。'].map((text, i) => createWord(text, `w${i}`));
  return { document, line };
};
describe('Phase 12 merges', () => {
  it('uses document order, preserves Ruby, ORs obscene and keeps first empty beat including zero', () => {
    const { document, line } = fixture();
    line.words[0].beginMs = 1000; line.words[0].endMs = 1300;
    line.words[0].rubyUnits = [{ id: 'r0', reading: 'きょ', beginMs: 1000, endMs: 1200 }];
    line.words[2].beginMs = 1400; line.words[2].endMs = 1600;
    line.words[2].rubyUnits = [{ id: 'r1', reading: 'う', beginMs: 1400, endMs: 1600 }];
    line.words[1].obscene = true; const editing = createProjectEditing(); setEmptyBeat(editing, 'w2', 'word', 3);
    for (const beat of [0, 2]) {
      setEmptyBeat(editing, 'w0', 'word', beat);
      const state = executeLyricCommand(createLyricEditorState(document, editing), { type: 'merge-words', wordIds: ['w2', 'w1', 'w0'] });
      expect(state.present.lines[0].words[0]).toEqual({ ...line.words[0], text: '今 日', obscene: true, endMs: 1600, rubyUnits: [...line.words[0].rubyUnits, ...line.words[2].rubyUnits] });
      expect(state.present.lines[0].words[1]).toBe(line.words[3]);
      expect(undoLyricCommand(state).present).toBe(document);
      expect(redoLyricCommand(undoLyricCommand(state)).present).toBe(state.present);
    }
  });
  it.each([
    [[1000, 1500], [null, null], [1000, 1500]],
    [[1000, null], [null, 2000], [1000, 2000]],
    [[1000, null], [1500, null], [1000, null]],
    [[null, null], [null, null], [null, null]],
    [[1500, 2000], [1000, 1300], [1000, 2000]],
  ])('takes known endpoints separately: %j, %j', (a, b, expected) => {
    const { document, line } = fixture();
    [line.words[0].beginMs, line.words[0].endMs] = a;
    [line.words[1].beginMs, line.words[1].endMs] = b;
    const merged = executeLyricCommand(createLyricEditorState(document), { type: 'merge-words', wordIds: ['w1', 'w0'] }).present.lines[0].words[0];
    expect([merged.beginMs, merged.endMs]).toEqual(expected);
  });
  it('rejects gaps, stale IDs, cross-line selections, invalid envelopes and excluded Ruby atomically', () => {
    const { document, line } = fixture();
    document.lines.push({ ...createLine(''), backgroundOf: line.id, words: [createWord('背', 'bg')] });
    const state = createLyricEditorState(document);
    for (const wordIds of [['w0', 'w2'], ['w0', 'missing'], ['w0', 'bg']]) expect(() => executeLyricCommand(state, { type: 'merge-words', wordIds })).toThrow();
    line.words[0].beginMs = 2000; line.words[1].endMs = 1000;
    expect(() => executeLyricCommand(state, { type: 'merge-words', wordIds: ['w0', 'w1'] })).toThrow();
    line.words[0].beginMs = 1000; line.words[1].endMs = 2000;
    line.words[1].rubyUnits = [{ id: 'r', reading: 'あ', beginMs: 500, endMs: 1200 }];
    expect(() => executeLyricCommand(state, { type: 'merge-words', wordIds: ['w0', 'w1'] })).toThrow(/排除注音/);
    expect(state.past).toEqual([]);
  });
  it('merges three Ruby in order and rejects cross-word, gaps and stale selections', () => {
    const { document, line } = fixture();
    line.words[0].rubyUnits = [0, 1, 2, 3].map(i => ({ id: `r${i}`, reading: `${i} `, beginMs: i ? null : 1000, endMs: i === 2 ? 1600 : null }));
    line.words[1].rubyUnits = [{ id: 'other', reading: 'あ', beginMs: null, endMs: null }];
    const state = createLyricEditorState(document);
    const merged = executeLyricCommand(state, { type: 'merge-ruby', rubyIds: ['r2', 'r0', 'r1'] });
    expect(merged.present.lines[0].words[0].rubyUnits).toEqual([{ id: 'r0', reading: '0 1 2 ', beginMs: 1000, endMs: 1600 }, line.words[0].rubyUnits[3]]);
    expect(merged.present.lines[0].words[0].text).toBe('今');
    expect(undoLyricCommand(merged).present).toBe(document);
    for (const rubyIds of [['r0', 'r2'], ['r0', 'missing'], ['r0', 'other']]) expect(() => executeLyricCommand(state, { type: 'merge-ruby', rubyIds })).toThrow();
  });
});

it('splits into three segments retaining original units, links, independent attached times and atomic history', () => {
  const { document, line } = fixture();
  line.beginMs = 500; line.endMs = 5000;
  line.words.forEach((word, i) => { word.beginMs = 1000 + i * 900; word.endMs = 2400 + i * 700; });
  const editing = createProjectEditing(); editing.endLinks[line.id] = 'next';
  document.lines.push({ ...createLine('', 'bg'), backgroundOf: line.id, beginMs: 200, endMs: 9000 }, { ...createLine('', 'next'), beginMs: 5000 });
  document.romanizationTracks = [{ id: 'r', language: 'ja-Latn', contents: [{ id: 'rc', lineId: line.id, kind: 'timed', units: [{ id: 'ru', text: ' ima ', beginMs: 300, endMs: 8000 }] }] }];
  document.translationTracks = [{ id: 't', language: 'en', purpose: 'subtitle', contents: [{ id: 'tc', lineId: line.id, kind: 'plain', text: ' now ' }] }];
  const state = executeLyricCommand(createLyricEditorState(document, editing), { type: 'split-line', lineId: line.id, beforeWordIds: ['w3', 'w1'], newLineIds: ['part2', 'part3'], translationTargets: { tc: 1 }, contentTargets: { rc: 2 }, backgroundTarget: 2 });
  expect(state.present.lines.slice(0, 3).map(item => [item.beginMs, item.endMs])).toEqual([[1000, 2400], [1900, 3800], [3700, 4500]]);
  expect(state.present.lines.slice(0, 3).flatMap(item => item.words)).toEqual(line.words);
  expect(state.editing.endLinks[state.present.lines[0].id]).toBeUndefined(); expect(state.editing.endLinks[state.present.lines[1].id]).toBeUndefined();
  expect(state.editing.endLinks[state.present.lines[2].id]).toBeUndefined();
  expect(state.present.lines[3]).toEqual({ ...document.lines[1], backgroundOf: 'part3' });
  expect(state.present.romanizationTracks[0].contents[0]).toEqual({ ...document.romanizationTracks[0].contents[0], lineId: 'part3' });
  expect(state.present.translationTracks[0].contents[0]).toEqual({ ...document.translationTracks[0].contents[0], lineId: 'part2' });
  expect(undoLyricCommand(state).present).toBe(document);
  expect(redoLyricCommand(undoLyricCommand(state)).present).toBe(state.present);
});

it('uses known endpoints despite unknown siblings, and rejects invalid intervals', () => {
  const { document, line } = fixture();
  const command = { type: 'split-line' as const, lineId: line.id, beforeWordIds: ['w2'], newLineIds: ['new'], translationTargets: {}, contentTargets: {}, backgroundTarget: null };
  line.words[0].endMs = 2000;
  expect(executeLyricCommand(createLyricEditorState(document), command).present.lines[0].endMs).toBe(2000);
  line.words[2].beginMs = 1500; line.words[3].beginMs = 1000;
  expect(executeLyricCommand(createLyricEditorState(document), command).present.lines[1].beginMs).toBe(1000);
  line.words[3].endMs = 500;
  expect(() => executeLyricCommand(createLyricEditorState(document), command)).toThrow(/第 2 行/);
  expect(() => executeLyricCommand(createLyricEditorState(document), { ...command, beforeWordIds: [] })).toThrow(/切点/);
});

it('keeps plain and timed translation/romanization content intact across split assignments', () => {
  const { document, line } = fixture();
  const units = [{ id: 'u', text: ' independent ', beginMs: 200, endMs: 9000 }];
  document.translationTracks = [{ id: 't', language: 'en', purpose: 'subtitle', contents: [
    { id: 'plain', lineId: line.id, kind: 'plain', text: ' untouched ' }, { id: 'timed', lineId: line.id, kind: 'timed', units },
  ] }];
  document.romanizationTracks = [{ id: 'r', language: 'ja-Latn', contents: [
    { id: 'rp', lineId: line.id, kind: 'plain', text: ' unchanged ' }, { id: 'rt', lineId: line.id, kind: 'timed', units: [{ ...units[0], id: 'ru' }] },
  ] }];
  const command = { type: 'split-line' as const, lineId: line.id, beforeWordIds: ['w1', 'w3'], newLineIds: ['b', 'c'], translationTargets: { plain: 0, timed: 2 }, contentTargets: { rp: 1, rt: 2 }, backgroundTarget: null };
  const state = createLyricEditorState(document);
  const next = executeLyricCommand(state, command).present;
  expect(next.translationTracks[0].contents).toEqual([document.translationTracks[0].contents[0], { ...document.translationTracks[0].contents[1], lineId: 'c' }]);
  expect(next.romanizationTracks[0].contents).toEqual(document.romanizationTracks[0].contents.map((content, i) => ({ ...content, lineId: i ? 'c' : 'b' })));
  expect(() => executeLyricCommand(state, { ...command, translationTargets: { plain: 0, timed: 3 } })).toThrow(/归属已失效/);
  expect(() => executeLyricCommand(state, { ...command, contentTargets: { rp: 1 } })).toThrow(/归属已失效/);
});

it('merges inside a background line and preserves attached content, while excluding out-of-parent Ruby', () => {
  const { document, line } = fixture();
  const bg = { ...createLine('', 'bg'), backgroundOf: line.id, words: ['a', 'b', 'c'].map((text, i) => createWord(text, `bg${i}`)) };
  document.lines.push(bg);
  const merged = executeLyricCommand(createLyricEditorState(document), { type: 'merge-words', wordIds: ['bg2', 'bg0', 'bg1'] });
  expect(merged.present.lines[1].words[0]).toMatchObject({ text: 'abc', id: 'bg0', beginMs: null, endMs: null });
  expect(merged.present.lines[0]).toBe(line);
  line.words[0].beginMs = 1000;
  line.words[0].rubyUnits = [{ id: 'a', reading: 'a', beginMs: 500, endMs: null }, { id: 'b', reading: 'b', beginMs: null, endMs: 1500 }];
  expect(() => executeLyricCommand(createLyricEditorState(document), { type: 'merge-ruby', rubyIds: ['a', 'b'] })).toThrow(/排除注音/);
});

it('splits a 1ms reversed punctuation boundary by word envelope without changing words or Ruby', () => {
  const { document, line } = fixture();
  line.beginMs = 73000; line.endMs = 78000;
  line.words = [
    { ...createWord('伝え', 'left'), beginMs: 74560, endMs: 75224 },
    { ...createWord('(', 'cut'), beginMs: 75224, endMs: 75224 },
    { ...createWord('伝え)', 'right'), beginMs: 75223, endMs: 75865, rubyUnits: [{ id: 'reading', reading: 'つたえ', beginMs: 75223, endMs: 75865 }] },
  ];
  const result = executeLyricCommand(createLyricEditorState(document), { type: 'split-line', lineId: line.id, beforeWordIds: ['cut'], newLineIds: ['new'], translationTargets: {}, contentTargets: {}, backgroundTarget: null });
  expect(result.present.lines.map(item => [item.beginMs, item.endMs])).toEqual([[74560, 75224], [75223, 75865]]);
  expect(result.present.lines.flatMap(item => item.words)).toEqual(line.words);
  expect(undoLyricCommand(result).present).toBe(document);
});

it('freezes incoming links when the first start changes and leaves fully unknown split times unknown', () => {
  const { document, line } = fixture();
  line.beginMs = 1000; line.endMs = 5000;
  document.lines.unshift({ ...createLine('', 'incoming'), beginMs: 0, endMs: 1000 });
  const editing = createProjectEditing(); editing.endLinks.incoming = line.id;
  const result = executeLyricCommand(createLyricEditorState(document, editing), { type: 'split-line', lineId: line.id, beforeWordIds: ['w2'], newLineIds: ['new'], translationTargets: {}, contentTargets: {}, backgroundTarget: null });
  expect(result.present.lines[0]).toMatchObject({ endMs: 1000 });
  expect(result.present.lines.slice(1).map(item => [item.beginMs, item.endMs])).toEqual([[null, null], [null, null]]);
  expect(undoLyricCommand(result).present).toBe(document);
});
