import { describe, expect, it } from 'vitest';
import { createLine, createLyricDocument, createWord } from '../src/domain/lyric-document';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand } from '../src/domain/lyric-commands';
import { moveTimeline, resizeTimeline, snapTime } from '../src/domain/timeline-editing';

describe('E6 timeline editing', () => {
  const sample = () => {
    const document = createLyricDocument('今日');
    const line = document.lines[0], word = line.words[0];
    line.beginUs = 1_000_000; line.endUs = 4_000_000;
    word.beginUs = 1_000_000; word.endUs = 3_000_000;
    word.rubyUnits = [
      { id: 'r1', reading: 'きょ', beginUs: 1_000_000, endUs: 2_000_000 },
      { id: 'r2', reading: 'う', beginUs: 2_000_000, endUs: 3_000_000 },
    ];
    line.words.push({ ...createWord('も', 'also'), beginUs: 3_000_000, endUs: 4_000_000 });
    const background = createLine('響く', 'bg');
    background.backgroundOf = line.id; background.beginUs = 1_500_000; background.endUs = 2_500_000;
    background.words[0].beginUs = 1_500_000; background.words[0].endUs = 2_500_000;
    document.lines.push(background);
    return document;
  };

  it('moves a line with its Ruby, alignment and background in one undo step', () => {
    const document = sample();
    const word = document.lines[0].words[0];
    word.alignmentUnits = [{ id: 'm1', kind: 'mora', text: 'きょ', beginUs: 1_000_000, endUs: 1_500_000, readingStart: 0, readingEnd: 2, rubyUnitId: 'r1' }];
    const moved = moveTimeline(document, [{ kind: 'line', lineId: document.lines[0].id }], 500_000);
    const state = executeLyricCommand(createLyricEditorState(document), { type: 'replace-document', document: moved });
    expect(state.present.lines[0].words[0].rubyUnits[0].beginUs).toBe(1_500_000);
    expect(state.present.lines[0].words[0].alignmentUnits[0].beginUs).toBe(1_500_000);
    expect(state.present.lines[1].words[0].beginUs).toBe(2_000_000);
    expect(undoLyricCommand(state).present).toBe(document);
  });

  it('resizes a Ruby edge and updates its parent without changing another word', () => {
    const document = sample();
    const target = { kind: 'ruby' as const, lineId: document.lines[0].id, wordId: document.lines[0].words[0].id, rubyId: 'r2' };
    const changed = resizeTimeline(document, target, 'endUs', 3_500_000);
    expect(changed.lines[0].words[0]).toMatchObject({ beginUs: 1_000_000, endUs: 3_500_000 });
    expect(changed.lines[0].words[1]).toBe(document.lines[0].words[1]);
    expect(() => resizeTimeline(document, { kind: 'line', lineId: document.lines[0].id }, 'endUs', 2_000_000)).toThrow(/不能排除词/);
  });

  it('moves selected words together and rejects negative times while snapping near a beat', () => {
    const document = sample();
    const targets = document.lines[0].words.map((word) => ({ kind: 'word' as const, lineId: document.lines[0].id, wordId: word.id }));
    const moved = moveTimeline(document, targets, 250_000);
    expect(moved.lines[0].words.map((word) => word.beginUs)).toEqual([1_250_000, 3_250_000]);
    expect(() => moveTimeline(document, targets, -2_000_000)).toThrow(/有效范围/);
    expect(snapTime(1_498_000, [1_000_000, 1_500_000, 2_000_000], 10_000)).toBe(1_500_000);
  });
});
