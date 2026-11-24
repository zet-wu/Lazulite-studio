import { createProjectEditing } from '../src/domain/project-editing';
import { describe, expect, it } from 'vitest';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand } from './helpers/project-history';
import { createLine, createLyricDocument, lineText } from '../src/domain/lyric-document';
import { copySelection, cutSelection, deleteSelection, moveWordsAcrossLine, pastePlain, pasteRich, selectIds } from '../src/features/editor/editing-actions';

describe('editor selection and clipboard', () => {
  it('selects ordered ranges and toggles without disturbing document order', () => {
    const order = ['a', 'b', 'c', 'd'];
    expect(selectIds(order, ['b'], 'b', 'd', true, false)).toEqual(['b', 'c', 'd']);
    expect(selectIds(order, ['b', 'd'], 'b', 'c', false, true)).toEqual(['b', 'c', 'd']);
    expect(selectIds(order, ['b', 'c'], 'b', 'b', false, true)).toEqual(['c']);
  });

  it('pastes a 注音 word untimed while assigning fresh word and ruby IDs', () => {
    const document = createLyricDocument('今日');
    const line = document.lines[0];
    line.beginMs = 0; line.endMs = 2000;
    const word = line.words[0];
    word.beginMs = 0; word.endMs = 1000;
    word.rubyUnits = [{ id: 'ruby', reading: 'きょう', beginMs: 0, endMs: 1000 }];
    const selection = { kind: 'words' as const, lineId: line.id, ids: [word.id], anchorId: word.id, activeId: word.id };
    const clipboard = copySelection(document, selection);
    const pasted = pasteRich(document, clipboard, selection);
    const state = executeLyricCommand(createLyricEditorState(document), pasted.command);
    const clone = state.present.lines[0].words[1];
    expect(clone.id).not.toBe(word.id);
    expect(clone).toMatchObject({ text: '今日', beginMs: null, endMs: null });
    expect(clone.rubyUnits[0]).toMatchObject({ reading: 'きょう', beginMs: null, endMs: null });
    expect(clone.rubyUnits[0].id).not.toBe('ruby');
    expect(undoLyricCommand(state).present).toBe(document);
  });

  it('pastes a selected 注音 unit without timing', () => {
    const document = createLyricDocument('歌');
    const line = document.lines[0], word = line.words[0];
    line.beginMs = 0; line.endMs = 1000;
    word.beginMs = 0; word.endMs = 1000;
    word.rubyUnits = [{ id: 'ruby', reading: 'うた', beginMs: 0, endMs: 1000 }];
    const selection = { kind: 'ruby' as const, lineId: line.id, wordId: word.id, ids: ['ruby'], anchorId: 'ruby', activeId: 'ruby' };
    const clipboard = copySelection(document, selection);
    const pasted = pasteRich(document, clipboard, selection);
    const state = executeLyricCommand(createLyricEditorState(document), pasted.command);
    const result = state.present.lines[0].words[0];
    expect(result.rubyUnits.map((unit) => [unit.reading, unit.beginMs, unit.endMs])).toEqual([['うた', 0, 1000], ['うた', null, null]]);
    expect(result.rubyUnits[1].id).not.toBe('ruby');
    expect(undoLyricCommand(state).present).toBe(document);
  });

  it('copies and cuts a parent with its background as one undoable operation', () => {
    const document = createLyricDocument('主唱');
    const parent = document.lines[0];
    document.translationTracks = [...document.translationTracks.filter(track => !track.contents.some(content => content.lineId === parent.id)), ...([{ id: 'translation-3098', purpose: 'subtitle' as const, kind: 'plain' as const,  language: 'zh', text: '翻译' }]).map(({ language, purpose, ...content }) => ({ id: crypto.randomUUID(), language, purpose, contents: [{ ...content, lineId: parent.id }] }))];
    const background = { ...createLine('和声', 'bg'), backgroundOf: parent.id };
    document.lines.push(background, createLine('下一行', 'next'));
    const selection = { kind: 'lines' as const, ids: [parent.id], anchorId: parent.id, activeId: parent.id };
    const clipboard = copySelection(document, selection);
    const pasted = pasteRich(document, clipboard, selection);
    const duplicated = executeLyricCommand(createLyricEditorState(document), pasted.command);
    expect(duplicated.present.lines.map((line) => line.id)).toEqual([parent.id, 'bg', pasted.selection.ids[0], expect.any(String), 'next']);
    expect(duplicated.present.translationTracks.flatMap(track => track.contents.filter(content => content.lineId === duplicated.present.lines[2].id).map(({ lineId: _lineId, ...content }) => ({ ...content, language: track.language, purpose: track.purpose })))).toEqual(document.translationTracks.flatMap(track => track.contents.filter(content => content.lineId === parent.id).map(({ lineId: _lineId, ...content }) => ({ ...content, language: track.language, purpose: track.purpose }))).map(item => ({ ...item, id: expect.any(String) })));
    expect(duplicated.present.lines[3].backgroundOf).toBe(duplicated.present.lines[2].id);
    const cut = executeLyricCommand(duplicated, cutSelection(duplicated.present, selection));
    expect(cut.present.lines.map(lineText)).toEqual(['主唱', '和声', '下一行']);
    expect(undoLyricCommand(cut).present).toBe(duplicated.present);
  });

  it('copies attached track contents with fresh IDs and one undo', () => {
    const document = createLyricDocument('二人');
    const line = document.lines[0];
    document.romanizationTracks.push({ id: 'track', language: 'ja-Latn', contents: [{ id: 'content', lineId: line.id, kind: 'timed', units: [
      { id: 'fu', text: 'fu ', beginMs: 999, endMs: 1500 },
      { id: 'tari', text: 'tari', beginMs: 1500, endMs: 3001 },
    ] }] });
    const selection = { kind: 'lines' as const, ids: [line.id], anchorId: line.id, activeId: line.id };
    const copied = copySelection(document, selection);
    const pasted = pasteRich(document, copied, selection);
    const state = executeLyricCommand(createLyricEditorState(document), pasted.command);
    const contents = state.present.romanizationTracks[0].contents;
    expect(contents).toHaveLength(2);
    expect(contents[1]).toMatchObject({ lineId: pasted.selection.ids[0], kind: 'timed', units: [{ text: 'fu ', beginMs: 999 }, { text: 'tari', endMs: 3001 }] });
    expect(contents[1].id).not.toBe(contents[0].id);
    if (contents[0].kind === 'timed' && contents[1].kind === 'timed') expect(contents[1].units[0].id).not.toBe(contents[0].units[0].id);
    expect(undoLyricCommand(state).present).toBe(document);
  });

  it('pastes plain text as untimed words or lines according to selection', () => {
    const document = createLyricDocument('前');
    const word = document.lines[0].words[0];
    const wordSelection = { kind: 'words' as const, lineId: document.lines[0].id, ids: [word.id], anchorId: word.id, activeId: word.id };
    const one = pastePlain(document, ' 後', wordSelection);
    const withWord = executeLyricCommand(createLyricEditorState(document), one.command).present;
    expect(withWord.lines[0].words.map((item) => [item.text, item.beginMs])).toEqual([['前', null], [' 後', null]]);
    const many = pastePlain(document, '第一\r\n第二\n', wordSelection);
    const withLines = executeLyricCommand(createLyricEditorState(document), many.command).present;
    expect(withLines.lines.map(lineText)).toEqual(['前', '第一', '第二']);
  });

  it('moves timed 注音 words into a neighboring line without losing their timing', () => {
    const document = createLyricDocument('今日');
    document.lines[0].beginMs = 0; document.lines[0].endMs = 1000;
    const word = document.lines[0].words[0];
    word.beginMs = 0; word.endMs = 1000;
    word.rubyUnits = [{ id: 'reading', reading: 'きょう', beginMs: 0, endMs: 1000 }];
    const target = createLine('明日', 'next');
    target.beginMs = 1000; target.endMs = 2000;
    target.words[0].beginMs = 1000; target.words[0].endMs = 2000;
    document.lines.push(target);
    const selection = { kind: 'words' as const, lineId: document.lines[0].id, ids: [word.id], anchorId: word.id, activeId: word.id };
    const state = executeLyricCommand(createLyricEditorState(document), moveWordsAcrossLine(document, selection, target.id, null));
    expect(state.present.lines[1].beginMs).toBe(0);
    expect(state.present.lines[1].words[0]).toBe(word);
    expect(state.present.lines[1].words[0].rubyUnits[0].reading).toBe('きょう');
    expect(undoLyricCommand(state).present).toBe(document);

    const clipboard = copySelection(document, selection);
    const targetSelection = { kind: 'lines' as const, ids: [target.id], anchorId: target.id, activeId: target.id };
    const pasted = executeLyricCommand(createLyricEditorState(document), pasteRich(document, clipboard, targetSelection).command);
    expect(pasted.present.lines[1].beginMs).toBe(1000);
    expect(pasted.present.lines[1].words[1].rubyUnits[0].reading).toBe('きょう');
    expect(undoLyricCommand(pasted).present).toBe(document);
  });
});

it('batch deletion removes selected lines and undo restores both removed lines', () => {
  const doc = createLyricDocument('前');
  const first = doc.lines[0]; first.beginMs = 0; first.endMs = 3000;
  first.words[0].beginMs = 0; first.words[0].endMs = 2000;
  doc.lines.push(createLine('先删', 'first'), createLine('目标', 'target'));
  const state = createLyricEditorState(doc), before = structuredClone(doc);
  const deleted = executeLyricCommand(state, deleteSelection(doc, { kind: 'lines', ids: ['first', 'target'], anchorId: 'first', activeId: 'target' }));
  expect(deleted.present.lines).toHaveLength(1);
  expect(deleted.present.lines[0]).toMatchObject({ endMs: 3000 });
  expect(undoLyricCommand(deleted).present).toBe(doc);
  expect(state.present).toEqual(before); expect(state.past).toHaveLength(0);
});

it.each([false, true])('appends copied ruby to a selected word (existing ruby=%s), retains beats and leaves destination times', existing => {
  const document = createLyricDocument('源');
  const source = document.lines[0], word = source.words[0];
  Object.assign(source, { beginMs: 0, endMs: 1000 }); Object.assign(word, { beginMs: 0, endMs: 1000 });
  word.rubyUnits = [{ id: 'r', reading: 'げん', beginMs: 0, endMs: 1000 }];
  const destination = createLine('目标'); Object.assign(destination, { beginMs: 8000, endMs: 9000 });
  const target = destination.words[0]; Object.assign(target, { beginMs: 8000, endMs: 9000 });
  if (existing) target.rubyUnits = [{ id: 'old', reading: 'もく', beginMs: 8000, endMs: 9000 }];
  document.lines.push(destination);
  const editing = createProjectEditing(); editing.emptyBeats.r = { kind: 'ruby', count: 2 };
  const copied = copySelection(document, { kind: 'ruby', lineId: source.id, wordId: word.id, ids: ['r'], activeId: 'r', anchorId: 'r' }, editing);
  const paste = pasteRich(document, copied, { kind: 'words', lineId: destination.id, ids: [target.id], activeId: target.id, anchorId: target.id });
  const state = executeLyricCommand(createLyricEditorState(document, editing), paste.command);
  const result = state.present.lines[1].words[0];
  expect(result.rubyUnits).toHaveLength(existing ? 2 : 1);
  const ruby = result.rubyUnits.at(-1)!;
  expect(ruby).toMatchObject({ reading: 'げん', beginMs: null, endMs: null });
  expect(state.editing.emptyBeats[ruby.id]).toEqual({ kind: 'ruby', count: 2 });
  expect(result).toMatchObject({ beginMs: 8000, endMs: 9000 });
  expect(state.present.lines[1]).toMatchObject({ beginMs: 8000, endMs: 9000 });
  expect(paste.selection).toMatchObject({ kind: 'ruby', wordId: target.id, ids: [ruby.id] });
  expect(undoLyricCommand(state).present).toBe(document);
});

it.each(['romanizationTracks', 'translationTracks'] as const)('pastes timed units across lines untimed in %s without changing text', key => {
  const document = createLyricDocument('源'); const source = document.lines[0];
  const destination = createLine('目标'); document.lines.push(destination);
  Object.assign(destination, { beginMs: 8000, endMs: 9000 });
  document[key] = [{ id: 't', language: 'ja', purpose: 'subtitle' as const, contents: [
    { id: 'c1', lineId: source.id, kind: 'timed', units: [{ id: 'u1', text: ' gen ', beginMs: 0, endMs: 1000 }] },
    { id: 'c2', lineId: destination.id, kind: 'timed', units: [{ id: 'u2', text: 'mokuhyou', beginMs: 8000, endMs: 9000 }] },
  ] }];
  const attachment = key === 'translationTracks' ? { attachment: 'translation' as const } : {};
  const copied = copySelection(document, { kind: 'romanization-unit', ...attachment, lineId: source.id, trackId: 't', contentId: 'c1', ids: ['u1'], activeId: 'u1', anchorId: 'u1' });
  const paste = pasteRich(document, copied, { kind: 'romanization-unit', ...attachment, lineId: destination.id, trackId: 't', contentId: 'c2', ids: ['u2'], activeId: 'u2', anchorId: 'u2' });
  const state = executeLyricCommand(createLyricEditorState(document), paste.command);
  const content = state.present[key][0].contents[1];
  expect(content.kind === 'timed' && content.units[1]).toMatchObject({ text: ' gen ', beginMs: null, endMs: null });
  expect(state.present.lines[1]).toBe(destination);
  expect(undoLyricCommand(state).present).toBe(document);
});

it('pastes words across singer lines with nested beats intact and every copied timestamp cleared', () => {
  const document = createLyricDocument('源'); const source = document.lines[0], word = source.words[0];
  document.agents = [{ id: 'a', type: 'person', name: '甲' }, { id: 'b', type: 'person', name: '乙' }];
  source.agentRefs = ['a']; Object.assign(source, { beginMs: 0, endMs: 1000 });
  Object.assign(word, { beginMs: 0, endMs: 1000 }); word.rubyUnits = [{ id: 'r', reading: 'げん', beginMs: 0, endMs: 1000 }];
  const destination = createLine('目标'); destination.agentRefs = ['b']; Object.assign(destination, { beginMs: 8000, endMs: 9000 }); document.lines.push(destination);
  const editing = createProjectEditing(); editing.emptyBeats.r = { kind: 'ruby', count: 3 };
  const copied = copySelection(document, { kind: 'words', lineId: source.id, ids: [word.id], activeId: word.id, anchorId: word.id }, editing);
  const paste = pasteRich(document, copied, { kind: 'lines', ids: [destination.id], activeId: destination.id, anchorId: destination.id });
  const initial = createLyricEditorState(document, editing); initial.project.present.amll.noWordAgents = false;
  const state = executeLyricCommand(initial, paste.command), result = state.present.lines[1].words[1];
  expect(result).toMatchObject({ text: '源', agentRefs: ['a'], beginMs: null, endMs: null, rubyUnits: [{ reading: 'げん', beginMs: null, endMs: null }] });
  expect(state.editing.emptyBeats[result.rubyUnits[0].id]).toEqual({ kind: 'ruby', count: 3 });
  expect(state.present.lines[1]).toMatchObject({ beginMs: 8000, endMs: 9000 });
  expect(undoLyricCommand(state).present).toBe(document);
});

it.each(['romanizationTracks', 'translationTracks'] as const)('pastes timed contents in %s untimed while full-line paste retains timing', key => {
  const document = createLyricDocument('源'), source = document.lines[0], destination = createLine('目标');
  Object.assign(source, { beginMs: 0, endMs: 1000 }); Object.assign(destination, { beginMs: 8000, endMs: 9000 }); document.lines.push(destination);
  document[key] = [{ id: 't', language: 'ja', purpose: 'subtitle', contents: [
    { id: 'timed', lineId: source.id, kind: 'timed', units: [{ id: 'u', text: ' gen ', beginMs: 0, endMs: 1000 }] },
    { id: 'plain', lineId: source.id, kind: 'plain', text: ' plain ' },
  ] }];
  const attachment = key === 'translationTracks' ? { attachment: 'translation' as const } : {};
  const copied = copySelection(document, { kind: 'romanization-content', ...attachment, trackId: 't', contentId: 'timed', lineId: source.id, ids: ['timed', 'plain'], activeId: 'timed', anchorId: 'timed' });
  const pasted = pasteRich(document, copied, { kind: 'lines', ids: [destination.id], activeId: destination.id, anchorId: destination.id });
  const state = executeLyricCommand(createLyricEditorState(document), pasted.command);
  const contents = state.present[key][0].contents.slice(2);
  expect(contents).toMatchObject([{ lineId: destination.id, kind: 'timed', units: [{ text: ' gen ', beginMs: null, endMs: null }] }, { lineId: destination.id, kind: 'plain', text: ' plain ' }]);
  expect(contents[0].id).not.toBe('timed');
  expect(contents[0].kind === 'timed' && contents[0].units[0].id).not.toBe('u');
  expect(state.present.lines[1]).toBe(destination);
  expect(undoLyricCommand(state).present).toBe(document);
  const lineCopy = copySelection(document, { kind: 'lines', ids: [source.id], activeId: source.id, anchorId: source.id });
  const whole = executeLyricCommand(createLyricEditorState(document), pasteRich(document, lineCopy, null).command);
  expect(whole.present[key][0].contents.at(-2)).toMatchObject({ kind: 'timed', units: [{ beginMs: 0, endMs: 1000 }] });
});
