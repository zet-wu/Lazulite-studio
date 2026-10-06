import { createProjectEditing } from '../src/domain/project-editing';
import { createProjectDocument } from '../src/domain/project-document';
import { parseProject, serializeProject } from '../src/adapters/project-codec';
import { expect, it } from 'vitest';
import { createLine, createWord, createLyricDocument } from '../src/domain/lyric-document';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand, redoLyricCommand } from './helpers/project-history';
import { parseLyricTtml, serializeLyricTtml } from '../src/adapters/ttml/lyric-codec';
import { lineStructureIssues } from '../src/domain/line-structure';
function fixture() {
  const doc = createLyricDocument();
  const editing = createProjectEditing();
  doc.lines = ['a', 'b', 'c', 'incoming'].map((id, i) => ({ ...createLine(id, id), beginMs: i * 2000, endMs: (i + 1) * 2000, words: [] }));
  doc.lines[0].words = [0, 1].map(i => ({ ...createWord(String(i), `w${i}`), beginMs: i * 1000, endMs: (i + 1) * 1000 }));
  editing.endLinks[doc.lines[0].id] = 'b';
  editing.endLinks[doc.lines[1].id] = 'c';
  return { doc, editing };
}
it('splits linked lines preserving incoming links, current endpoint, target updates and atomic history', () => {
  const { doc, editing } = fixture(); doc.lines[3].endMs = 0; doc.lines[3].beginMs = 0;
  editing.endLinks[doc.lines[3].id] = 'a';
  const before = createLyricEditorState(doc, editing);
  const split = executeLyricCommand(before, { type: 'split-line', lineId: 'a', beforeWordIds: ['w1'], newLineIds: ['new'], translationTargets: {}, contentTargets: {}, backgroundTarget: null });
  expect(split.present.lines[0]).toMatchObject({ id: 'a', endMs: 1000 });
  expect(split.editing.endLinks[split.present.lines[1].id]).toEqual(editing.endLinks[doc.lines[0].id]);
  expect(split.editing.endLinks[split.present.lines.at(-1)!.id]).toBe('a');
  expect(undoLyricCommand(split).present).toBe(doc);
  expect(redoLyricCommand(undoLyricCommand(split)).present).toBe(split.present);
  expect(parseProject(serializeProject(split.project.present)).editing).toEqual(split.editing);
  const moved = executeLyricCommand(split, { type: 'set-line-time', lineId: 'b', beginMs: 3000, endMs: 4000 });
  expect(moved.present.lines[1].endMs).toBe(3000);
  expect(executeLyricCommand(moved, { type: 'unlink-line-end', lineId: 'new' }).present.lines[1].endMs).toBe(3000);
  expect(serializeLyricTtml(split.present)).not.toContain('endLink');
});
it('merges the internal chain and inherits the last external link and current end', () => {
  const { doc, editing } = fixture(), state = createLyricEditorState(doc, editing);
  const result = executeLyricCommand(state, { type: 'merge-lines', firstLineId: 'a', secondLineId: 'b' });
  expect(result.present.lines[0]).toMatchObject({ id: 'a', endMs: 4000 });
  expect(executeLyricCommand(result, { type: 'unlink-line-end', lineId: 'a' }).present.lines[0].endMs).toBe(4000);
  expect(undoLyricCommand(result).present).toBe(doc);
});
it('reports all real conflicts with source ordinals and safely rebinds identical starts', () => {
  const { doc, editing } = fixture(); editing.endLinks[doc.lines[3].id] = 'b'; doc.lines[3].endMs = 2000; doc.lines[3].beginMs = 0;
  doc.translationTracks = [...doc.translationTracks.filter(track => !track.contents.some(content => content.lineId === doc.lines[0].id)), ...([{ id: 'translation-2964', purpose: 'subtitle' as const, kind: 'plain' as const,  language: 'en', text: 'a' }]).map(({ language, purpose, ...content }) => ({ id: crypto.randomUUID(), language, purpose, contents: [{ ...content, lineId: doc.lines[0].id }] }))]; doc.translationTracks = [...doc.translationTracks.filter(track => !track.contents.some(content => content.lineId === doc.lines[1].id)), ...([{ id: 'translation-3025', purpose: 'subtitle' as const, kind: 'plain' as const,  language: 'ja', text: 'b' }]).map(({ language, purpose, ...content }) => ({ id: crypto.randomUUID(), language, purpose, contents: [{ ...content, lineId: doc.lines[1].id }] }))];
  doc.lines[1].agentRefs = ['v2']; doc.lines[1].songPart = 'verse';
  const issues = lineStructureIssues(doc, doc.lines[0], doc.lines[1], editing);
  expect(issues).toHaveLength(5); expect(issues.join('；')).toContain('L4行尾链接 → L2');
  const state = createLyricEditorState(doc, editing);
  expect(() => executeLyricCommand(state, { type: 'merge-lines', firstLineId: 'a', secondLineId: 'b' })).toThrow(issues.join('；'));
  expect(state.present).toBe(doc); expect(state.past).toHaveLength(0);
  doc.translationTracks = doc.translationTracks.filter(track => !track.contents.some(content => content.lineId === doc.lines[0].id)); doc.translationTracks = doc.translationTracks.filter(track => !track.contents.some(content => content.lineId === doc.lines[1].id)); doc.lines[1].agentRefs = []; doc.lines[1].songPart = null;
  doc.lines[0].beginMs = 2000; doc.lines[0].words = [];
  const safe = executeLyricCommand(state, { type: 'merge-lines', firstLineId: 'a', secondLineId: 'b' });
  expect(safe.editing.endLinks[safe.present.lines.at(-1)!.id]).toBe('a');
  editing.endLinks[doc.lines[0].id] = 'c';
  expect(lineStructureIssues(doc, doc.lines[0], doc.lines[1], editing)).toEqual(['L1行尾链接 → L3在合并范围外']);
});
it('assigns translations independently with romanization and background in one split and roundtrip', () => {
  const { doc, editing } = fixture();
  doc.translationTracks = [...doc.translationTracks.filter(track => !track.contents.some(content => content.lineId === doc.lines[0].id)), ...([{ id: 'translation-4196', purpose: 'subtitle' as const, kind: 'plain' as const,  text: 'one', language: 'en' }, { id: 'translation-4229', purpose: 'subtitle' as const, kind: 'plain' as const,  text: '二', language: 'zh-Hans' }, { id: 'translation-4265', purpose: 'subtitle' as const, kind: 'plain' as const,  text: '三', language: 'ja' }]).map(({ language, purpose, ...content }) => ({ id: crypto.randomUUID(), language, purpose, contents: [{ ...content, lineId: doc.lines[0].id }] }))];
  doc.lines.splice(1, 0, { ...createLine('声', 'bg'), backgroundOf: 'a' });
  doc.romanizationTracks = [{ id: 't', language: 'ja-Latn', contents: [{ id: 'r', lineId: 'a', kind: 'plain', text: 'a' }] }];
  const state = createLyricEditorState(doc, editing);
  const result = executeLyricCommand(state, { type: 'split-line', lineId: 'a', beforeWordIds: ['w1'], newLineIds: ['new'], contentTargets: { r: 1 }, translationTargets: { 'translation-4196': 0, 'translation-4229': 1, 'translation-4265': 1 }, backgroundTarget: 1 });
  expect(result.present.translationTracks.flatMap(track => track.contents.filter(content => content.lineId === result.present.lines[0].id).map(({ lineId: _lineId, ...content }) => ({ ...content, language: track.language, purpose: track.purpose })))).toEqual([doc.translationTracks.flatMap(track => track.contents.filter(content => content.lineId === doc.lines[0].id).map(({ lineId: _lineId, ...content }) => ({ ...content, language: track.language, purpose: track.purpose })))[0]]);
  expect(result.present.translationTracks.flatMap(track => track.contents.filter(content => content.lineId === result.present.lines[1].id).map(({ lineId: _lineId, ...content }) => ({ ...content, language: track.language, purpose: track.purpose })))).toEqual(doc.translationTracks.flatMap(track => track.contents.filter(content => content.lineId === doc.lines[0].id).map(({ lineId: _lineId, ...content }) => ({ ...content, language: track.language, purpose: track.purpose }))).slice(1));
  expect(result.present.lines[2].backgroundOf).toBe('new');
  expect(result.present.romanizationTracks[0].contents[0].lineId).toBe('new');
  for (const draft of [true, false]) expect(parseLyricTtml(serializeLyricTtml(result.present, { draft })).translationTracks.flatMap(track => track.contents.filter(content => content.lineId === result.present.lines[1].id).map(({ lineId: _lineId, ...content }) => ({ ...content, language: track.language, purpose: track.purpose })))).toEqual(doc.translationTracks.flatMap(track => track.contents.filter(content => content.lineId === doc.lines[0].id).map(({ lineId: _lineId, ...content }) => ({ ...content, language: track.language, purpose: track.purpose }))).slice(1).map(item => ({ ...item, id: expect.any(String) })));
  expect(undoLyricCommand(result).present).toBe(doc);
  expect(() => executeLyricCommand(state, { type: 'split-line', lineId: 'a', beforeWordIds: ['w1'], newLineIds: ['new'], contentTargets: { r: 0 }, translationTargets: { missing: 1 }, backgroundTarget: 0 })).toThrow('翻译分配条目不存在');
});

it('eliminates every internal end link when coincident boundaries merge', () => {
  const { doc, editing } = fixture();
  doc.lines[0].words = []; doc.lines[0].beginMs = 0; doc.lines[0].endMs = 0;
  doc.lines[1].beginMs = 0; doc.lines[1].endMs = 0; editing.endLinks[doc.lines[1].id] = 'a';
  const result = executeLyricCommand(createLyricEditorState(doc, editing), { type: 'merge-lines', firstLineId: 'a', secondLineId: 'b' });
  expect(result.editing.endLinks[result.present.lines[0].id]).toBeUndefined();
  expect(undoLyricCommand(result).present).toBe(doc);
});
