import { describe, expect, it } from 'vitest';
import { createLine, createLyricDocument, createWord } from '../src/domain/lyric-document';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand, redoLyricCommand } from '../src/domain/lyric-commands';

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
    line.words[1].obscene = true; line.words[2].emptyBeat = 3;
    for (const beat of [0, 2]) {
      line.words[0].emptyBeat = beat;
      const state = executeLyricCommand(createLyricEditorState(document), { type: 'merge-words', wordIds: ['w2', 'w1', 'w0'] });
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
  line.endLink = { targetLineId: 'next' };
  document.lines.push({ ...createLine('', 'bg'), backgroundOf: line.id, beginMs: 200, endMs: 9000 }, { ...createLine('', 'next'), beginMs: 5000 });
  document.romanizationTracks = [{ id: 'r', language: 'ja-Latn', contents: [{ id: 'rc', lineId: line.id, kind: 'timed', units: [{ id: 'ru', text: ' ima ', beginMs: 300, endMs: 8000 }] }] }];
  document.translationTracks = [{ id: 't', language: 'en', purpose: 'subtitle', contents: [{ id: 'tc', lineId: line.id, kind: 'plain', text: ' now ' }] }];
  const state = executeLyricCommand(createLyricEditorState(document), { type: 'split-line', lineId: line.id, beforeWordIds: ['w3', 'w1'], newLineIds: ['part2', 'part3'], translationTargets: { tc: 1 }, contentTargets: { rc: 2 }, backgroundTarget: 2 });
  expect(state.present.lines.slice(0, 3).map(item => [item.beginMs, item.endMs])).toEqual([[500, 2400], [1900, 3800], [3700, 5000]]);
  expect(state.present.lines.slice(0, 3).flatMap(item => item.words)).toEqual(line.words);
  expect(state.present.lines[0].endLink).toBeNull(); expect(state.present.lines[1].endLink).toBeNull();
  expect(state.present.lines[2].endLink).toEqual(line.endLink);
  expect(state.present.lines[3]).toEqual({ ...document.lines[1], backgroundOf: 'part3' });
  expect(state.present.romanizationTracks[0].contents[0]).toEqual({ ...document.romanizationTracks[0].contents[0], lineId: 'part3' });
  expect(state.present.translationTracks[0].contents[0]).toEqual({ ...document.translationTracks[0].contents[0], lineId: 'part2' });
  expect(undoLyricCommand(state).present).toBe(document);
  expect(redoLyricCommand(undoLyricCommand(state)).present).toBe(state.present);
});

it('rejects invalid split segments and assignments; unknown segment ends remain unknown', () => {
  const { document, line } = fixture();
  const command = { type: 'split-line' as const, lineId: line.id, beforeWordIds: ['w2'], newLineIds: ['new'], translationTargets: {}, contentTargets: {}, backgroundTarget: null };
  line.words[0].endMs = 2000;
  expect(executeLyricCommand(createLyricEditorState(document), command).present.lines[0].endMs).toBeNull();
  line.words[2].beginMs = 1500; line.words[3].beginMs = 1000;
  expect(() => executeLyricCommand(createLyricEditorState(document), command)).toThrow(/第 2 行/);
  expect(() => executeLyricCommand(createLyricEditorState(document), { ...command, beforeWordIds: [] })).toThrow(/切点/);
});
