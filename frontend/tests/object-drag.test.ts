import { expect, it } from 'vitest';
import { createLine, createLyricDocument, createWord } from '../src/domain/lyric-document';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand } from '../src/domain/lyric-commands';
import { dragCommand } from '../src/features/editor/object-drag';

it('uses explicit first/last slots for moves and copies, retaining backgrounds and one undo', () => {
  const document = createLyricDocument('A'), first = document.lines[0];
  const bg = { ...createLine('背景'), backgroundOf: first.id };
  const last = createLine('B'); document.lines.push(bg, last);
  for (const copy of [false, true]) {
    const result = dragCommand(document, { kind: 'line', lineId: last.id }, { lineId: first.id, afterId: null }, copy);
    const state = executeLyricCommand(createLyricEditorState(document), result.command);
    expect(state.present.lines.map(line => line.words[0].text)).toEqual(copy ? ['B', 'A', '背景', 'B'] : ['B', 'A', '背景']);
    expect(state.present.lines[2].backgroundOf).toBe(first.id);
    expect(state.past).toHaveLength(1);
    expect(undoLyricCommand(state).present).toBe(document);
  }
  const result = dragCommand(document, { kind: 'line', lineId: first.id }, { lineId: last.id, afterId: last.id }, false);
  expect(executeLyricCommand(createLyricEditorState(document), result.command).present.lines.map(line => line.id)).toEqual([last.id, first.id, bg.id]);
});

it('places words at the first slot for move/copy and expands a different target line', () => {
  const document = createLyricDocument('A'), first = document.lines[0]; first.words.push(createWord('B'));
  first.words[1].beginUs = 0; first.words[1].endUs = 3_000_000;
  const second = createLine('C'); second.beginUs = 1_000_000; second.endUs = 2_000_000;
  document.lines.push(second);
  for (const copy of [false, true]) for (const target of [first, second]) {
    const result = dragCommand(document, { kind: 'word', lineId: first.id, wordId: first.words[1].id }, { lineId: target.id, afterId: null }, copy);
    const state = executeLyricCommand(createLyricEditorState(document), result.command);
    expect(state.present.lines.find(line => line.id === target.id)!.words[0].text).toBe('B');
    expect(undoLyricCommand(state).present).toBe(document);
    if (target === second) expect(state.present.lines[1]).toMatchObject({ beginUs: 0, endUs: 3_000_000 });
  }
});

it('reorders same-track contents and timed units without modifying their times or text', () => {
  const document = createLyricDocument('正文'), line = document.lines[0];
  const units = [{ id: 'a', text: 'a', beginUs: 0, endUs: 100_000 }, { id: 'b', text: 'b', beginUs: 100_000, endUs: 200_000 }];
  document.romanizationTracks.push({ id: 'track', language: 'ja', contents: [
    { id: 'first', lineId: line.id, kind: 'timed', units }, { id: 'last', lineId: line.id, kind: 'plain', text: 'plain' },
  ] });
  const content = dragCommand(document, { kind: 'romanization-content', lineId: line.id, trackId: 'track', contentId: 'last' }, { lineId: line.id, afterId: null }, false);
  expect(executeLyricCommand(createLyricEditorState(document), content.command).present.romanizationTracks[0].contents.map(item => item.id)).toEqual(['last', 'first']);
  const unit = dragCommand(document, { kind: 'romanization-unit', lineId: line.id, trackId: 'track', contentId: 'first', unitId: 'b' }, { lineId: line.id, afterId: null }, false);
  const state = executeLyricCommand(createLyricEditorState(document), unit.command);
  expect(state.present.romanizationTracks[0].contents[0]).toMatchObject({ units: [units[1], units[0]] });
  expect(undoLyricCommand(state).present).toBe(document);
});
