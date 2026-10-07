import { expect, it } from 'vitest';
import { createLine, createLyricDocument, createWord } from '../src/domain/lyric-document';
import { createProjectDocument, createProjectEditorState, executeProjectCommand, undoProjectCommand, redoProjectCommand } from '../src/domain/project-document';
import { parseLyricTtml, serializeLyricTtml } from '../src/adapters/ttml/lyric-codec';
import { parseProject, serializeProject } from '../src/adapters/project-codec';
import { copySelection, pasteRich } from '../src/features/editor/editing-actions';

function fixture() {
  const doc = createLyricDocument('Alpha'), line = doc.lines[0]; line.beginMs = 0; line.endMs = 5000;
  line.words[0].beginMs = 0; line.words[0].endMs = 1000;
  line.words.push({ ...createWord('今日'), beginMs: 1000, endMs: 2000, rubyUnits: [{ id: 'r', reading: 'きょう', beginMs: 1000, endMs: 2000 }] });
  const bg = createLine('背景'); bg.backgroundOf = line.id; bg.beginMs = 0; bg.endMs = 2000; bg.words[0].beginMs = 0; bg.words[0].endMs = 2000; doc.lines.push(bg);
  return doc;
}
it('word flags have one project history each; plain, ruby and background roundtrip with original text', () => {
  const doc = fixture(); let state = createProjectEditorState(createProjectDocument(doc));
  for (const line of doc.lines) for (const word of line.words) {
    const before = state;
    state = executeProjectCommand(state, { type: 'lyrics', command: { type: 'set-word-obscene', lineId: line.id, wordId: word.id, obscene: true } });
    expect(state.past.length).toBe(before.past.length + 1); expect(undoProjectCommand(state).present).toBe(before.present);
    expect(redoProjectCommand(undoProjectCommand(state)).present).toBe(state.present);
    expect(executeProjectCommand(state, { type: 'lyrics', command: { type: 'set-word-obscene', lineId: line.id, wordId: word.id, obscene: true } }).past).toHaveLength(state.past.length);
  }
  const flagged = state.present.lyrics;
  for (const draft of [true, false]) {
    const xml = serializeLyricTtml(flagged, { draft });
    expect(xml.match(/amll:obscene="true"/g)).toHaveLength(3);
    const parsed = parseLyricTtml(xml);
    expect(parsed.lines.flatMap(l => l.words.map(w => [w.text, w.obscene]))).toEqual([['Alpha', true], ['今日', true], ['背景', true]]);
    expect(parsed.lines[0].words[1].rubyUnits[0]).not.toHaveProperty('obscene');
    if (draft) expect(parsed).toEqual(flagged);
  }
  expect(parseProject(serializeProject(state.present))).toEqual(state.present);
});
it('rich copy remaps IDs, merge uses logical OR, and attached-property split gate stays closed', () => {
  const doc = fixture(), line = doc.lines[0]; line.words[0].obscene = true;
  let state = createProjectEditorState(createProjectDocument(doc));
  const selection = { kind: 'words' as const, lineId: line.id, ids: [line.words[0].id], activeId: line.words[0].id, anchorId: line.words[0].id };
  const pasted = pasteRich(doc, copySelection(doc, selection, state.present.editing), selection);
  const copied = executeProjectCommand(state, { type: 'lyrics', command: pasted.command });
  expect(copied.present.lyrics.lines[0].words[1]).toMatchObject({ obscene: true, text: 'Alpha' });
  expect(copied.present.lyrics.lines[0].words[1].id).not.toBe(line.words[0].id);
  expect(() => executeProjectCommand(state, { type: 'lyrics', command: { type: 'split-word', lineId: line.id, wordId: line.words[0].id, at: 2 } })).toThrow(/attached/);
  state = executeProjectCommand(state, { type: 'lyrics', command: { type: 'merge-words', wordIds: line.words.map(w => w.id) } });
  expect(state.present.lyrics.lines[0].words[0]).toMatchObject({ text: 'Alpha今日', obscene: true });
  expect(undoProjectCommand(state).present.lyrics).toEqual(doc);
});
it('rejects invalid flag values and flags on individual Ruby/line nodes instead of discarding them', () => {
  const doc = fixture(); doc.lines[0].words[1].obscene = true;
  const xml = serializeLyricTtml(doc, { draft: true });
  expect(parseLyricTtml(xml.replace('amll:obscene="true"', 'amll:obscene="false"')).lines[0].words[1].obscene).toBe(false);
  expect(() => parseLyricTtml(xml.replace('amll:obscene="true"', 'amll:obscene="yes"'))).toThrow(/true or false/);
  for (const target of ['tts:ruby="text"', 'xml:id=']) {
    const invalid = target === 'xml:id=' ? xml.replace('<p ', '<p amll:obscene="true" ') : xml.replace(target, `${target} amll:obscene="true"`);
    expect(() => parseLyricTtml(invalid)).toThrow(/Unsupported TTML attribute/);
  }
});
