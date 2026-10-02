import { describe, expect, it } from 'vitest';
import { createLine, createLyricDocument, createWord } from '../src/domain/lyric-document';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand } from '../src/domain/lyric-commands';
import { stampSync, syncUnits } from '../src/domain/sync-editing';
import { parseLyricTtml, serializeLyricTtml } from '../src/adapters/ttml/lyric-codec';

describe('E5 sync editing', () => {
  it('advances 注音 before ordinary words and skips background and ignored lines', () => {
    const document = createLyricDocument('今日');
    document.lines[0].words[0].rubyUnits = [
      { id: 'r1', reading: 'きょ', beginMs: null, endMs: null },
      { id: 'r2', reading: 'う', beginMs: null, endMs: null },
    ];
    document.lines[0].words.push(createWord('も', 'also'));
    const background = createLine('響く', 'background'); background.backgroundOf = document.lines[0].id;
    const ignored = createLine('間奏', 'ignored'); ignored.ignoreSync = true;
    const final = createLine('宇宙', 'final');
    document.lines.push(background, ignored, final);
    expect(syncUnits(document).map((unit) => [unit.lineId, unit.wordId, unit.rubyUnitId])).toEqual([
      [document.lines[0].id, document.lines[0].words[0].id, 'r1'],
      [document.lines[0].id, document.lines[0].words[0].id, 'r2'],
      [document.lines[0].id, 'also', null],
      ['final', final.words[0].id, null],
    ]);
  });

  it('stamps one 注音 edge and the next start in one undoable transaction', () => {
    const document = createLyricDocument('今日');
    const line = document.lines[0], word = line.words[0];
    word.rubyUnits = [
      { id: 'r1', reading: 'きょ', beginMs: null, endMs: null },
      { id: 'r2', reading: 'う', beginMs: null, endMs: null },
    ];
    const [first, second] = syncUnits(document);
    let state = executeLyricCommand(createLyricEditorState(document), { type: 'sync-stamp', cursor: first, action: 'start', timeMs: 1000 });
    const beforeNext = state.present;
    state = executeLyricCommand(state, { type: 'sync-stamp', cursor: first, action: 'next', timeMs: 1500 });
    expect(state.present.lines[0].words[0].rubyUnits).toEqual([
      { id: 'r1', reading: 'きょ', beginMs: 1000, endMs: 1500 },
      { id: 'r2', reading: 'う', beginMs: 1500, endMs: null },
    ]);
    expect(state.present.lines[0]).toMatchObject({ beginMs: 1000, endMs: 1500 });
    expect(undoLyricCommand(state).present).toBe(beforeNext);
    state = executeLyricCommand(state, { type: 'sync-stamp', cursor: second, action: 'end', timeMs: 2000 });
    expect(state.present.lines[0].words[0]).toMatchObject({ beginMs: 1000, endMs: 2000 });
  });

  it('does not write an end before a start or alter the document after rejection', () => {
    const document = createLyricDocument('今日');
    const cursor = syncUnits(document)[0];
    expect(() => stampSync(document, cursor, 'next', 1000)).toThrow(/先为当前单元打起始轴/);
    const started = stampSync(document, cursor, 'start', 2000);
    expect(() => stampSync(started, cursor, 'end', 1000)).toThrow(/早于起始轴/);
    expect(document.lines[0].words[0].beginMs).toBeNull();
  });

  it('keeps skip and empty-beat settings in drafts and omits them from final TTML', () => {
    const document = createLyricDocument('間奏');
    const line = document.lines[0], word = line.words[0];
    let state = createLyricEditorState(document);
    state = executeLyricCommand(state, { type: 'batch', commands: [
      { type: 'set-ignore-sync', lineId: line.id, ignoreSync: true },
      { type: 'set-word-empty-beat', lineId: line.id, wordId: word.id, emptyBeat: 2 },
    ] });
    expect(syncUnits(state.present)).toEqual([]);
    const draft = parseLyricTtml(serializeLyricTtml(state.present, { draft: true }));
    expect(draft.lines[0].ignoreSync).toBe(true);
    expect(draft.lines[0].words[0].emptyBeat).toBe(2);
    expect(serializeLyricTtml(state.present)).not.toContain('studio:');
    expect(undoLyricCommand(state).present).toBe(document);
  });

  it('takes a short song through every 注音 and word and reopens the final TTML', () => {
    const document = createLyricDocument('今日');
    document.lines[0].words[0].rubyUnits = [
      { id: 'r1', reading: 'きょ', beginMs: null, endMs: null },
      { id: 'r2', reading: 'う', beginMs: null, endMs: null },
    ];
    document.lines.push(createLine('宇宙', 'second'));
    const units = syncUnits(document);
    let state = createLyricEditorState(document);
    state = executeLyricCommand(state, { type: 'sync-stamp', cursor: units[0], action: 'start', timeMs: 1000 });
    state = executeLyricCommand(state, { type: 'sync-stamp', cursor: units[0], action: 'next', timeMs: 1500 });
    state = executeLyricCommand(state, { type: 'sync-stamp', cursor: units[1], action: 'next', timeMs: 2000 });
    state = executeLyricCommand(state, { type: 'sync-stamp', cursor: units[2], action: 'end', timeMs: 3000 });
    const reopened = parseLyricTtml(serializeLyricTtml(state.present));
    expect(reopened.lines.map((line) => [line.beginMs, line.endMs])).toEqual([[1000, 2000], [2000, 3000]]);
    expect(reopened.lines[0].words[0].rubyUnits.map((unit) => [unit.beginMs, unit.endMs])).toEqual([[1000, 1500], [1500, 2000]]);
    expect(reopened.lines[1].words[0]).toMatchObject({ beginMs: 2000, endMs: 3000 });
  });
});

it('preserves line margins and its unchanged link, and limits line-mode successors atomically', () => {
  const document = createLyricDocument('one');
  const line = document.lines[0];
  line.beginMs = 0; line.endMs = 10000;
  line.words[0].beginMs = 2000; line.words[0].endMs = 8000;
  const next = createLine('two'); next.beginMs = 10000;
  document.lines.push(next);
  line.endLink = { targetLineId: next.id};
  const cursor = syncUnits(document)[0];
  let state = createLyricEditorState(document);
  state = executeLyricCommand(state, { type: 'sync-stamp', cursor, action: 'start', timeMs: 3000 });
  expect(state.present.lines[0]).toMatchObject({ beginMs: 0, endMs: 10000, endLink: line.endLink });
  const before = state.present;
  state = executeLyricCommand(state, { type: 'sync-stamp', cursor, action: 'next', timeMs: 7000, mode: 'line' });
  expect(state.present.lines[1]).toEqual(next);
  expect(state.present.lines[0]).toMatchObject({ beginMs: 0, endMs: 10000, endLink: line.endLink });
  expect(undoLyricCommand(state).present).toBe(before);
  const outside = stampSync(state.present, cursor, 'end', 12000, 'line');
  expect(outside.lines[0]).toMatchObject({ beginMs: 0, endMs: 12000, endLink: null });
});

it('updates incoming line links and rejects an excluded word without changing document or history', () => {
  const document = createLyricDocument('source');
  const source = document.lines[0];
  source.beginMs = 0; source.endMs = 10000;
  source.words[0].beginMs = 0; source.words[0].endMs = 8000;
  const target = createLine('target'); target.beginMs = 10000; target.endMs = 20000;
  target.words[0].beginMs = 12000; target.words[0].endMs = 18000;
  source.endLink = { targetLineId: target.id};
  document.lines.push(target);
  const state = createLyricEditorState(document), cursor = syncUnits(document)[1];
  const accepted = executeLyricCommand(state, { type: 'sync-stamp', cursor, action: 'start', timeMs: 9000 });
  expect(accepted.present.lines[0]).toMatchObject({ endMs: 9000, endLink: source.endLink });
  expect(accepted.present.lines[1].beginMs).toBe(9000);
  expect(undoLyricCommand(accepted).present).toBe(document);
  expect(() => executeLyricCommand(state, { type: 'sync-stamp', cursor, action: 'start', timeMs: 7000 })).toThrow(/关联行/);
  expect(state.present).toBe(document); expect(state.past).toHaveLength(0);
  expect(source.endMs).toBe(10000); expect(target.beginMs).toBe(10000);
});
