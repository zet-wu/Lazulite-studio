// Existing lyric assertions, backed by the same project history used by both editors.
import { createProjectDocument, createProjectEditorState, executeProjectCommand, undoProjectCommand, redoProjectCommand, type ProjectEditorState } from '../../src/domain/project-document';
import type { LyricDocument } from '../../src/domain/lyric-document';
import type { LyricCommand } from '../../src/domain/lyric-commands';
import { createProjectEditing } from '../../src/domain/project-editing';
const view = (project: ProjectEditorState) => ({ project, present: project.present.lyrics, editing: project.present.editing, past: project.past.map(p => p.lyrics), future: project.future.map(p => p.lyrics) });
export const createLyricEditorState = (lyrics: LyricDocument, editing = createProjectEditing()) => view(createProjectEditorState({ ...createProjectDocument(lyrics), editing }));
export const executeLyricCommand = (state: ReturnType<typeof view>, command: LyricCommand) => { const next = executeProjectCommand(state.project, { type: 'lyrics', command }); return next === state.project ? state : view(next); };
export const undoLyricCommand = (state: ReturnType<typeof view>) => view(undoProjectCommand(state.project));
export const redoLyricCommand = (state: ReturnType<typeof view>) => view(redoProjectCommand(state.project));
