import { describe, expect, it } from 'vitest';
import { parseLyricTtml, serializeLyricTtml } from '../src/adapters/ttml/lyric-codec';
import { replaceWords, shiftLineTimes, smoothWordTimes, syncLineTimes } from '../src/domain/batch-editing';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand } from '../src/domain/lyric-commands';
import { createLine, createLyricDocument, createWord } from '../src/domain/lyric-document';

describe('E3 batch editing', () => {
  it('shifts a selected line, Ruby and alignments without touching other lines or losing null time', () => {
    const document = createLyricDocument('今日');
    const line = document.lines[0], word = line.words[0];
    line.beginUs = 500_000; line.endUs = 1_000_000;
    word.beginUs = 500_000; word.endUs = 1_000_000;
    word.rubyUnits = [{ id: 'r', reading: 'きょう', beginUs: 600_000, endUs: 900_000 }];
    word.alignmentUnits = [{ id: 'a', kind: 'mora', text: 'きょ', beginUs: 600_000, endUs: null, readingStart: 0, readingEnd: 2, rubyUnitId: 'r' }];
    const untouched = createLine('明日', 'next'); document.lines.push(untouched);
    const state = executeLyricCommand(createLyricEditorState(document), shiftLineTimes(document, [line.id], 200_000));
    expect(state.present.lines[0].words[0].rubyUnits[0].beginUs).toBe(800_000);
    expect(state.present.lines[0].words[0].alignmentUnits[0].endUs).toBeNull();
    expect(state.present.lines[1]).toBe(untouched);
    expect(undoLyricCommand(state).present).toBe(document);
    expect(() => shiftLineTimes(document, [line.id], -600_000)).toThrow(/偏移/);
  });

  it('smooths only nearby plain word boundaries and synchronizes line envelope', () => {
    const document = createLyricDocument('a');
    const line = document.lines[0];
    line.words = [{ ...createWord('a', 'a'), beginUs: 100_000, endUs: 400_000 }, { ...createWord('b', 'b'), beginUs: 420_000, endUs: 900_000 }];
    const smoothed = smoothWordTimes(document, [line.id], 30_000);
    expect(smoothed.count).toBe(1);
    const state = executeLyricCommand(createLyricEditorState(document), smoothed.command);
    expect(state.present.lines[0].words.map((word) => [word.beginUs, word.endUs])).toEqual([[100_000, 410_000], [410_000, 900_000]]);
    const synced = executeLyricCommand(state, syncLineTimes(state.present, [line.id]));
    expect(synced.present.lines[0]).toMatchObject({ beginUs: 100_000, endUs: 900_000 });
    expect(undoLyricCommand(synced).present).toBe(state.present);
  });

  it('replaces selected text in one undo and rejects a Ruby base change', () => {
    const document = createLyricDocument('hello hello');
    const line = document.lines[0], word = line.words[0];
    const result = replaceWords(document, [word.id], 'hello', 'hi');
    expect(result.count).toBe(2);
    const state = executeLyricCommand(createLyricEditorState(document), result.command);
    expect(state.present.lines[0].words[0].text).toBe('hi hi');
    expect(undoLyricCommand(state).present).toBe(document);
    word.rubyUnits.push({ id: 'r', reading: 'ヘロー', beginUs: null, endUs: null });
    expect(() => replaceWords(document, [word.id], 'hello', 'hi')).toThrow(/注音/);
  });

  it('persists line end links in draft TTML, tracks target changes and restores the original end', () => {
    const document = createLyricDocument('一');
    const first = document.lines[0], second = createLine('二', 'second');
    first.beginUs = 100_000; first.endUs = 500_000;
    first.words[0].beginUs = 100_000; first.words[0].endUs = 400_000;
    second.beginUs = 800_000; second.endUs = 1_100_000;
    second.words[0].beginUs = 950_000; second.words[0].endUs = 1_100_000;
    document.lines.push(second);
    const linked = executeLyricCommand(createLyricEditorState(document), { type: 'link-line-end', lineId: first.id, targetLineId: second.id });
    expect(linked.present.lines[0].endUs).toBe(800_000);
    const reloaded = parseLyricTtml(serializeLyricTtml(linked.present, { draft: true }));
    expect(reloaded.lines[0].endLink).toEqual({ targetLineId: second.id, originalEndUs: 500_000 });
    const moved = executeLyricCommand(createLyricEditorState(reloaded), { type: 'set-line-time', lineId: second.id, beginUs: 900_000, endUs: 1_100_000 });
    expect(moved.present.lines[0].endUs).toBe(900_000);
    const unlinked = executeLyricCommand(moved, { type: 'unlink-line-end', lineId: first.id });
    expect(unlinked.present.lines[0]).toMatchObject({ endUs: 500_000, endLink: null });
    expect(() => executeLyricCommand(linked, { type: 'set-line-time', lineId: second.id, beginUs: 300_000, endUs: 1_100_000 })).toThrow();
  });
});
