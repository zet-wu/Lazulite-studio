import { exportLyricFile } from '../src/adapters/lyric-formats';
import { collectOutputIssues } from '../src/adapters/output-validation';
import { expect, it } from 'vitest';
import { createLine, createLyricDocument, createWord } from '../src/domain/lyric-document';
import { createProjectDocument, createProjectEditorState, executeProjectCommand, undoProjectCommand, redoProjectCommand } from '../src/domain/project-document';
import { emptyBeatCount, validateProjectEditing } from '../src/domain/project-editing';
import { parseProject, serializeProject } from '../src/adapters/project-codec';
import { parseLyricTtml, serializeLyricTtml } from '../src/adapters/ttml/lyric-codec';
import { copySelection, pasteRich } from '../src/features/editor/editing-actions';
import { syncUnits } from '../src/domain/sync-editing';
import type { LyricCommand } from '../src/domain/lyric-commands';
const apply = (state: ReturnType<typeof createProjectEditorState>, command: LyricCommand) => executeProjectCommand(state, { type: 'lyrics', command });
function fixture() {
  const lyrics = createLyricDocument(); lyrics.lines = [createLine('', 'a'), createLine('', 'b')];
  lyrics.lines[0].words = [createWord('A', 'a1'), createWord('B', 'a2')];
  return createProjectEditorState(createProjectDocument(lyrics));
}
it('saves project-only configuration, rejects obsolete TTML and restores one shared history', () => {
  const original = fixture();
  const next = apply(original, { type: 'batch', commands: [
    { type: 'set-empty-beat', id: 'a1', kind: 'word', count: 32 }, { type: 'set-ignore-sync', lineId: 'a', ignoreSync: true },
    { type: 'set-line-time', lineId: 'b', beginMs: 2000, endMs: 3000 }, { type: 'link-line-end', lineId: 'a', targetLineId: 'b' },
  ] });
  const snapshot = serializeProject(next.present);
  expect(snapshot.lyrics.draftTtml).not.toMatch(/emptyBeat|ignoreSync|endLink/);
  expect(parseProject(snapshot)).toEqual(next.present);
  expect(undoProjectCommand(next).present).toBe(original.present);
  expect(redoProjectCommand(undoProjectCommand(next)).present).toBe(next.present);
  expect(() => parseLyricTtml(snapshot.lyrics.draftTtml.replace('<p ', '<p studio:ignoreSync="true" '))).toThrow();
});
it('configuration changes are atomic and the same count does not add history', () => {
  const state = apply(fixture(), { type: 'set-empty-beat', id: 'a1', kind: 'word', count: 2 });
  expect(apply(state, { type: 'set-empty-beat', id: 'a1', kind: 'word', count: 2 })).toBe(state);
  for (const count of [-1, 1.5, 33]) expect(() => apply(state, { type: 'set-empty-beat', id: 'a1', kind: 'word', count })).toThrow();
  expect(() => apply(state, { type: 'batch', commands: [{ type: 'delete-word', lineId: 'a', wordId: 'a1' }, { type: 'set-empty-beat', id: 'missing', kind: 'ruby', count: 1 }] })).toThrow();
  expect(state.present.editing.emptyBeats.a1.count).toBe(2);
});
it('transfers word beats to first Ruby and back, splits/merges by first ID, rejects conflicts', () => {
  let state = apply(fixture(), { type: 'set-empty-beat', id: 'a1', kind: 'word', count: 2 });
  state = apply(state, { type: 'add-ruby', lineId: 'a', wordId: 'a1', reading: 'あい', rubyId: 'r' });
  expect(state.present.editing.emptyBeats).toEqual({ r: { kind: 'ruby', count: 2 } });
  state = apply(state, { type: 'split-ruby', lineId: 'a', wordId: 'a1', rubyId: 'r', at: 1, newRubyId: 'r2' });
  expect(emptyBeatCount(state.present.editing, 'r2')).toBe(0);
  const conflict = apply(state, { type: 'set-empty-beat', id: 'r2', kind: 'ruby', count: 1 });
  expect(() => apply(conflict, { type: 'batch', commands: [{ type: 'delete-ruby', lineId: 'a', wordId: 'a1', rubyId: 'r' }, { type: 'delete-ruby', lineId: 'a', wordId: 'a1', rubyId: 'r2' }] })).toThrow(/空拍/);
  state = apply(conflict, { type: 'merge-ruby', rubyIds: ['r2', 'r'] });
  state = apply(state, { type: 'delete-ruby', lineId: 'a', wordId: 'a1', rubyId: 'r' });
  expect(state.present.editing.emptyBeats).toEqual({ a1: { kind: 'word', count: 2 } });
});
it('copies mapped beats, ignore and internal links without linking to original objects', () => {
  let state = fixture();
  state = apply(state, { type: 'batch', commands: [{ type: 'set-empty-beat', kind: 'word', id: 'a1', count: 3 }, { type: 'set-ignore-sync', lineId: 'a', ignoreSync: true }, { type: 'set-line-time', lineId: 'b', beginMs: 1000, endMs: 2000 }, { type: 'link-line-end', lineId: 'a', targetLineId: 'b' }] });
  const clipboard = copySelection(state.present.lyrics, { kind: 'lines', ids: ['a', 'b'], activeId: 'b', anchorId: 'a' }, state.present.editing);
  const result = pasteRich(state.present.lyrics, clipboard, null);
  const next = apply(state, result.command), [a, b] = next.present.lyrics.lines.slice(2);
  expect(next.present.editing.endLinks[a.id]).toBe(b.id);
  expect(next.present.editing.ignoredSyncLineIds).toContain(a.id);
  expect(emptyBeatCount(next.present.editing, a.words[0].id)).toBe(3);
  expect(undoProjectCommand(next).present).toBe(state.present);
});
it('cleans deletion, preserves movement and keeps first-word count including zero on merge', () => {
  let state = apply(fixture(), { type: 'set-empty-beat', kind: 'word', id: 'a2', count: 3 });
  const moved = apply(state, { type: 'move-word', lineId: 'a', wordId: 'a2', toLineId: 'b', afterWordId: null });
  expect(emptyBeatCount(moved.present.editing, 'a2')).toBe(3);
  state = apply(state, { type: 'merge-words', wordIds: ['a2', 'a1'] });
  expect(state.present.editing.emptyBeats).toEqual({});
});
it('filters expanded units by trim without rewriting text, times or stored counts', () => {
  const state = fixture(), lyrics = state.present.lyrics;
  lyrics.lines[0].words.splice(1, 0, ...[' ', '\t', '　', ''].map((text, i) => ({ ...createWord(text, `s${i}`), beginMs: 100, endMs: 200 })));
  lyrics.lines[1].words = [{ ...createWord(' ', 'whiteBase'), rubyUnits: [{ id: 'r0', reading: ' ', beginMs: null, endMs: null }, { id: 'r1', reading: 'あ', beginMs: null, endMs: null }] }];
  const next = apply(state, { type: 'set-empty-beat', kind: 'word', id: 's0', count: 2 });
  expect(syncUnits(next.present.lyrics, next.present.editing).map(unit => unit.rubyUnitId ?? unit.wordId)).toEqual(['a1', 'a2', 'r1']);
  expect(next.present.lyrics).toBe(lyrics);
  expect(emptyBeatCount(next.present.editing, 's0')).toBe(2);
});
it('validates IDs, categories, limits and evaluated relationships at restore boundaries', () => {
  const state = fixture();
  for (const editing of [
    { ...state.present.editing, emptyBeats: { missing: { kind: 'word', count: 1 } } },
    { ...state.present.editing, emptyBeats: { a1: { kind: 'ruby', count: 1 } } },
    { ...state.present.editing, ignoredSyncLineIds: ['a', 'a'] },
    { ...state.present.editing, endLinks: { a: 'b' } },
  ]) expect(() => validateProjectEditing(state.present.lyrics, editing as any)).toThrow();
});
it('timeline target start follows incoming links and rejects invalid endpoints atomically', async () => {
  const { resizeTimeline } = await import('../src/domain/timeline-editing');
  let state = fixture();
  state = apply(state, { type: 'batch', commands: [{ type: 'set-line-time', lineId: 'b', beginMs: 1000, endMs: 2000 }, { type: 'link-line-end', lineId: 'a', targetLineId: 'b' }] });
  const moved = resizeTimeline(state.present.lyrics, { kind: 'line', lineId: 'b' }, 'beginMs', 1500, state.present.editing);
  expect(moved.lines[0].endMs).toBe(1500);
  expect(() => resizeTimeline(state.present.lyrics, { kind: 'line', lineId: 'a' }, 'endMs', 900, state.present.editing)).toThrow(/链接/);
  const next = apply(state, { type: 'replace-document', document: moved });
  expect(undoProjectCommand(next).present).toBe(state.present);
});

it('retains configured whitespace export gates without leaking configuration into TTML', () => {
  const state = fixture(), line = state.present.lyrics.lines[0];
  line.beginMs = 0; line.endMs = 2000;
  line.words = [{ ...createWord('text', 'text'), beginMs: 0, endMs: 2000 }, createWord(' ', 'space')];
  const configured = apply(state, { type: 'set-empty-beat', kind: 'word', id: 'space', count: 2 }).present;
  expect(collectOutputIssues(configured.lyrics, 'elrc', configured.editing).some(issue => issue.wordId === 'space')).toBe(true);
  expect(() => exportLyricFile(configured.lyrics, 'qrc', configured.editing)).toThrow();
  const xml = exportLyricFile(configured.lyrics, 'ttml', configured.editing);
  expect(xml).not.toMatch(/emptyBeat|ignoreSync|endLink/);
  expect(parseLyricTtml(xml).lines[0].words.at(-1)?.text).toBe(' ');
});

it('rejects generated Ruby replacement that would silently erase configured identity', () => {
 let state=apply(fixture(),{type:'add-ruby',lineId:'a',wordId:'a1',reading:'あ',rubyId:'r'});
 state=apply(state,{type:'set-empty-beat',id:'r',kind:'ruby',count:2});
 expect(()=>apply(state,{type:'set-ruby-units',lineId:'a',wordId:'a1',overwrite:true,units:[{id:'new-r',reading:'い',beginMs:null,endMs:null}]})).toThrow(/空拍/);
 expect(state.present.editing.emptyBeats.r.count).toBe(2);
});

it('keeps alignment skipping independent, copies/splits it and merges only unanimous sources', () => {
  const base = fixture();
  let state = apply(base, { type: 'set-skip-alignment', lineId: 'a', skip: true });
  expect(state.present.editing.ignoredSyncLineIds).toEqual([]);
  expect(apply(state, { type: 'set-skip-alignment', lineId: 'a', skip: true })).toBe(state);
  const clip = copySelection(state.present.lyrics, { kind: 'lines', ids: ['a'], activeId: 'a', anchorId: 'a' }, state.present.editing);
  const copied = apply(state, pasteRich(state.present.lyrics, clip, null).command);
  expect(copied.present.editing.skippedAlignmentLineIds).toContain(copied.present.lyrics.lines.at(-1)!.id);
  state = apply(state, { type: 'split-line', lineId: 'a', beforeWordIds: ['a2'], newLineIds: ['split'], contentTargets: {}, translationTargets: {}, backgroundTargets: {} });
  expect(state.present.editing.skippedAlignmentLineIds).toEqual(['a', 'split']);
  const merged = apply(state, { type: 'merge-lines', firstLineId: 'a', secondLineId: 'split' });
  expect(merged.present.editing.skippedAlignmentLineIds).toEqual(['a']);
  const mixed = apply(merged, { type: 'merge-lines', firstLineId: 'a', secondLineId: 'b' });
  expect(mixed.present.editing.skippedAlignmentLineIds).toEqual([]);
  expect(undoProjectCommand(mixed).present).toBe(merged.present);
  expect(redoProjectCommand(undoProjectCommand(mixed)).present).toBe(mixed.present);
  expect(parseProject(serializeProject(merged.present))).toEqual(merged.present);
  expect(serializeProject(merged.present).lyrics.draftTtml).not.toContain('skippedAlignment');
  expect(apply(merged, { type: 'delete-line', lineId: 'a' }).present.editing.skippedAlignmentLineIds).toEqual([]);
});
