import { describe, expect, it } from 'vitest';
import { createLine, createLyricDocument, createWord } from '../src/domain/lyric-document';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand } from '../src/domain/lyric-commands';
import { moveTimeline, resizeTimeline, snapTime } from '../src/domain/timeline-editing';

describe('E6 timeline editing', () => {
  const sample = () => {
    const document = createLyricDocument('今日');
    const line = document.lines[0], word = line.words[0];
    line.beginMs = 1000; line.endMs = 4000;
    word.beginMs = 1000; word.endMs = 3000;
    word.rubyUnits = [
      { id: 'r1', reading: 'きょ', beginMs: 1000, endMs: 2000 },
      { id: 'r2', reading: 'う', beginMs: 2000, endMs: 3000 },
    ];
    line.words.push({ ...createWord('も', 'also'), beginMs: 3000, endMs: 4000 });
    const background = createLine('響く', 'bg');
    background.backgroundOf = line.id; background.beginMs = 1500; background.endMs = 2500;
    background.words[0].beginMs = 1500; background.words[0].endMs = 2500;
    document.lines.push(background);
    return document;
  };

  it('moves a line with its 注音, alignment and background in one undo step', () => {
    const document = sample();
    const word = document.lines[0].words[0];
    const moved = moveTimeline(document, [{ kind: 'line', lineId: document.lines[0].id }], 500);
    const state = executeLyricCommand(createLyricEditorState(document), { type: 'replace-document', document: moved });
    expect(state.present.lines[0].words[0].rubyUnits[0].beginMs).toBe(1500);
    expect(state.present.lines[1].words[0].beginMs).toBe(2000);
    expect(undoLyricCommand(state).present).toBe(document);
  });

  it('resizes a 注音 edge and updates its parent without changing another word', () => {
    const document = sample();
    const target = { kind: 'ruby' as const, lineId: document.lines[0].id, wordId: document.lines[0].words[0].id, rubyId: 'r2' };
    const changed = resizeTimeline(document, target, 'endMs', 3500);
    expect(changed.lines[0].words[0]).toMatchObject({ beginMs: 1000, endMs: 3500 });
    expect(changed.lines[0].words[1]).toBe(document.lines[0].words[1]);
    expect(() => resizeTimeline(document, { kind: 'line', lineId: document.lines[0].id }, 'endMs', 2000)).toThrow(/不能排除词/);
  });

  it('moves selected words together and rejects negative times while snapping near a beat', () => {
    const document = sample();
    const targets = document.lines[0].words.map((word) => ({ kind: 'word' as const, lineId: document.lines[0].id, wordId: word.id }));
    const moved = moveTimeline(document, targets, 250);
    expect(moved.lines[0].words.map((word) => word.beginMs)).toEqual([1250, 3250]);
    expect(() => moveTimeline(document, targets, -2000)).toThrow(/有效范围/);
    expect(snapTime(1498, [1000, 1500, 2000], 10_000)).toBe(1500);
  });
});
