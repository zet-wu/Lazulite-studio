import { parseProject, serializeProject } from '../src/adapters/project-codec';
import { describe, expect, it } from 'vitest';
import { parseLyricTtml, serializeLyricTtml } from '../src/adapters/ttml/lyric-codec';
import { replaceWords, shiftLineTimes, smoothWordTimes, syncLineTimes } from '../src/domain/batch-editing';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand } from './helpers/project-history';
import { createLine, createLyricDocument, createWord } from '../src/domain/lyric-document';

describe('E3 batch editing', () => {
  it('shifts a selected line, 注音 and alignments without touching other lines or losing null time', () => {
    const document = createLyricDocument('今日');
    const line = document.lines[0], word = line.words[0];
    line.beginMs = 500; line.endMs = 1000;
    word.beginMs = 500; word.endMs = 1000;
    word.rubyUnits = [{ id: 'r', reading: 'きょう', beginMs: 600, endMs: 900 }];
    const untouched = createLine('明日', 'next'); document.lines.push(untouched);
    const state = executeLyricCommand(createLyricEditorState(document), shiftLineTimes(document, [line.id], 200));
    expect(state.present.lines[0].words[0].rubyUnits[0].beginMs).toBe(800);
    expect(state.present.lines[1]).toBe(untouched);
    expect(undoLyricCommand(state).present).toBe(document);
    expect(() => shiftLineTimes(document, [line.id], -600)).toThrow(/偏移/);
  });

  it('smooths only nearby plain word boundaries and synchronizes line envelope', () => {
    const document = createLyricDocument('a');
    const line = document.lines[0];
    line.words = [{ ...createWord('中', 'a'), beginMs: 100, endMs: 400 }, { ...createWord('文', 'b'), beginMs: 420, endMs: 900 }];
    const smoothed = smoothWordTimes(document, [line.id], 30_000);
    expect(smoothed.count).toBe(1);
    const state = executeLyricCommand(createLyricEditorState(document), smoothed.command);
    expect(state.present.lines[0].words.map((word) => [word.beginMs, word.endMs])).toEqual([[100, 410], [410, 900]]);
    const synced = executeLyricCommand(state, syncLineTimes(state.present, [line.id]));
    expect(synced.present.lines[0]).toMatchObject({ beginMs: 100, endMs: 900 });
    expect(undoLyricCommand(synced).present).toBe(state.present);
  });

  it('replaces selected text in one undo and rejects a 注音 base change', () => {
    const document = createLyricDocument('hello hello');
    const line = document.lines[0], word = line.words[0];
    const result = replaceWords(document, [word.id], 'hello', 'hi');
    expect(result.count).toBe(2);
    const state = executeLyricCommand(createLyricEditorState(document), result.command);
    expect(state.present.lines[0].words[0].text).toBe('hi hi');
    expect(undoLyricCommand(state).present).toBe(document);
    word.rubyUnits.push({ id: 'r', reading: 'ヘロー', beginMs: null, endMs: null });
    expect(() => replaceWords(document, [word.id], 'hello', 'hi')).toThrow(/注音/);
  });

  it('persists line end links in project snapshots, tracks target changes and retains the current end', () => {
    const document = createLyricDocument('一');
    const first = document.lines[0], second = createLine('二', 'second');
    first.beginMs = 100; first.endMs = 500;
    first.words[0].beginMs = 100; first.words[0].endMs = 400;
    second.beginMs = 800; second.endMs = 1100;
    second.words[0].beginMs = 950; second.words[0].endMs = 1100;
    document.lines.push(second);
    const linked = executeLyricCommand(createLyricEditorState(document), { type: 'link-line-end', lineId: first.id, targetLineId: second.id });
    expect(linked.present.lines[0].endMs).toBe(800);
    const reloaded = parseProject(serializeProject(linked.project.present));
    expect(reloaded.editing.endLinks[first.id]).toEqual(second.id);
    const moved = executeLyricCommand(createLyricEditorState(reloaded.lyrics, reloaded.editing), { type: 'set-line-time', lineId: second.id, beginMs: 900, endMs: 1100 });
    expect(moved.present.lines[0].endMs).toBe(900);
    const unlinked = executeLyricCommand(moved, { type: 'unlink-line-end', lineId: first.id });
    expect(unlinked.present.lines[0]).toMatchObject({ endMs: 900 });
    expect(() => executeLyricCommand(linked, { type: 'set-line-time', lineId: second.id, beginMs: 300, endMs: 1100 })).toThrow();
  });
});
