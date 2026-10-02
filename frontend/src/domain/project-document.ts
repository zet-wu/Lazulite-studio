import { applyLyricCommand, type LyricCommand } from './lyric-commands';
import { createLyricDocument, type LyricDocument } from './lyric-document';

export type VocalSegment = { id: string; beginMs: number; endMs: number };
export type Acoustics = { analysisId: string | null; segments: VocalSegment[] };
export type ProjectDocument = {
  schemaVersion: 'studio-project-v1';
  sourceAssetId: string | null;
  lyrics: LyricDocument;
  acoustics: Acoustics;
};
export type ProjectSnapshot = Omit<ProjectDocument, 'lyrics'> & { lyrics: { draftTtml: string } };
export type ProjectEditorState = { present: ProjectDocument; past: ProjectDocument[]; future: ProjectDocument[] };
export type ProjectCommand = { type: 'lyrics'; command: LyricCommand } | { type: 'acoustics'; acoustics: Acoustics; durationMs: number };
export function createProjectDocument(lyrics = createLyricDocument(), sourceAssetId: string | null = null): ProjectDocument {
  return { schemaVersion: 'studio-project-v1', sourceAssetId, lyrics, acoustics: { analysisId: null, segments: [] } };
}
export function validateSegments(segments: VocalSegment[], durationMs: number) {
  const ids = new Set<string>();
  for (const segment of segments) {
    if (!segment.id || ids.has(segment.id) || !Number.isSafeInteger(segment.beginMs) || !Number.isSafeInteger(segment.endMs) || segment.beginMs < 0 || segment.beginMs >= segment.endMs || segment.endMs > durationMs) throw new Error('人声片段必须具有唯一标识，且位于歌曲范围内');
    ids.add(segment.id);
  }
}
export function createProjectEditorState(present: ProjectDocument): ProjectEditorState { return { present, past: [], future: [] }; }
export function executeProjectCommand(state: ProjectEditorState, command: ProjectCommand): ProjectEditorState {
  let present: ProjectDocument;
  if (command.type === 'lyrics') {
    const lyrics = applyLyricCommand(state.present.lyrics, command.command);
    if (lyrics === state.present.lyrics) return state;
    present = { ...state.present, lyrics };
  } else {
    validateSegments(command.acoustics.segments, command.durationMs);
    if (command.acoustics === state.present.acoustics) return state;
    present = { ...state.present, acoustics: command.acoustics };
  }
  return { present, past: [...state.past.slice(-255), state.present], future: [] };
}
export function undoProjectCommand(state: ProjectEditorState): ProjectEditorState {
  return !state.past.length ? state : { present: state.past.at(-1)!, past: state.past.slice(0, -1), future: [state.present, ...state.future] };
}
export function redoProjectCommand(state: ProjectEditorState): ProjectEditorState {
  return !state.future.length ? state : { present: state.future[0], past: [...state.past, state.present], future: state.future.slice(1) };
}
