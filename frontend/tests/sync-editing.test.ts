import { describe, expect, it } from 'vitest';
import { createLine, createLyricDocument, createWord } from '../src/domain/lyric-document';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand } from '../src/domain/lyric-commands';
import { stampSync, syncUnits } from '../src/domain/sync-editing';
import { parseLyricTtml, serializeLyricTtml } from '../src/adapters/ttml/lyric-codec';

describe('E5 sync editing', () => {
  it('advances Ruby before ordinary words and skips background and ignored lines', () => {
    const document = createLyricDocument('今日');
    document.lines[0].words[0].rubyUnits = [
      { id: 'r1', reading: 'きょ', beginUs: null, endUs: null },
      { id: 'r2', reading: 'う', beginUs: null, endUs: null },
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

  it('stamps one Ruby edge and the next start in one undoable transaction', () => {
    const document = createLyricDocument('今日');
    const line = document.lines[0], word = line.words[0];
    word.rubyUnits = [
      { id: 'r1', reading: 'きょ', beginUs: null, endUs: null },
      { id: 'r2', reading: 'う', beginUs: null, endUs: null },
    ];
    const [first, second] = syncUnits(document);
    let state = executeLyricCommand(createLyricEditorState(document), { type: 'sync-stamp', cursor: first, action: 'start', timeUs: 1_000_000 });
    const beforeNext = state.present;
    state = executeLyricCommand(state, { type: 'sync-stamp', cursor: first, action: 'next', timeUs: 1_500_000 });
    expect(state.present.lines[0].words[0].rubyUnits).toEqual([
      { id: 'r1', reading: 'きょ', beginUs: 1_000_000, endUs: 1_500_000 },
      { id: 'r2', reading: 'う', beginUs: 1_500_000, endUs: null },
    ]);
    expect(state.present.lines[0]).toMatchObject({ beginUs: 1_000_000, endUs: 1_500_000 });
    expect(undoLyricCommand(state).present).toBe(beforeNext);
    state = executeLyricCommand(state, { type: 'sync-stamp', cursor: second, action: 'end', timeUs: 2_000_000 });
    expect(state.present.lines[0].words[0]).toMatchObject({ beginUs: 1_000_000, endUs: 2_000_000 });
  });

  it('does not write an end before a start or alter the document after rejection', () => {
    const document = createLyricDocument('今日');
    const cursor = syncUnits(document)[0];
    expect(() => stampSync(document, cursor, 'next', 1_000_000)).toThrow(/先为当前单元打起始轴/);
    const started = stampSync(document, cursor, 'start', 2_000_000);
    expect(() => stampSync(started, cursor, 'end', 1_000_000)).toThrow(/早于起始轴/);
    expect(document.lines[0].words[0].beginUs).toBeNull();
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
});
