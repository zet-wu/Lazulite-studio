import type { ProjectDocument, ProjectSnapshot } from '../domain/project-document';
import { parseLyricTtml, serializeLyricTtml } from './ttml/lyric-codec';
export function parseProject(snapshot: ProjectSnapshot): ProjectDocument {
  return { ...snapshot, lyrics: parseLyricTtml(snapshot.lyrics.draftTtml) };
}
export function serializeProject(document: ProjectDocument): ProjectSnapshot {
  return { ...document, lyrics: { draftTtml: serializeLyricTtml(document.lyrics, { draft: true }) } };
}
