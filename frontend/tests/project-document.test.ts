import { expect, it } from 'vitest';
import { createProjectDocument, createProjectEditorState, executeProjectCommand, undoProjectCommand, redoProjectCommand } from '../src/domain/project-document';
import { createLyricDocument } from '../src/domain/lyric-document';
import { serializeProject, parseProject } from '../src/adapters/project-codec';
it('uses one history for acoustic and lyric edits; lyric import retains acoustics', () => {
  const initial = createProjectEditorState(createProjectDocument(createLyricDocument('old')));
  const acoustics = { analysisId: 'analysis', segments: [{ id: 's', beginMs: 100, endMs: 400 }] };
  const acoustic = executeProjectCommand(initial, { type: 'acoustics', acoustics, durationMs: 500 });
  expect(acoustic.present.lyrics).toBe(initial.present.lyrics);
  const imported = executeProjectCommand(acoustic, { type: 'lyrics', command: { type: 'replace-document', document: createLyricDocument('new') } });
  expect(imported.present.acoustics).toBe(acoustics);
  expect(undoProjectCommand(imported).present).toBe(acoustic.present);
  expect(undoProjectCommand(undoProjectCommand(imported)).present).toBe(initial.present);
  expect(redoProjectCommand(undoProjectCommand(imported)).present).toBe(imported.present);
  expect(parseProject(serializeProject(imported.present)).acoustics).toEqual(acoustics);
  expect(serializeProject(imported.present).lyrics.draftTtml).not.toContain('analysis');
  expect(() => executeProjectCommand(imported, { type: 'acoustics', acoustics: { ...acoustics, segments: [{ id: 's', beginMs: 400, endMs: 600 }] }, durationMs: 500 })).toThrow();
  expect(imported.past).toHaveLength(2);
});
it('bounds the single history to 256 entries', () => {
 let state = createProjectEditorState(createProjectDocument());
 for (let i = 0; i < 300; i++) state = executeProjectCommand(state, { type: 'lyrics', command: { type: 'set-metadata', key: 'title', values: [String(i)] } });
 expect(state.past).toHaveLength(256);
});
