import { validateProjectEditing } from '../domain/project-editing';
import type { ProjectDocument, ProjectSnapshot } from '../domain/project-document';
import { parseLyricTtml, serializeLyricTtml } from './ttml/lyric-codec';
export function parseProject(snapshot: ProjectSnapshot): ProjectDocument {
  if (snapshot.schemaVersion !== 'studio-project-v2') throw new Error('项目版本不兼容');
  const result = { ...snapshot, lyrics: parseLyricTtml(snapshot.lyrics.draftTtml) };
  validateProjectEditing(result.lyrics, result.editing);
  return result;
}
export function serializeProject(document: ProjectDocument): ProjectSnapshot {
  validateProjectEditing(document.lyrics, document.editing);
  return { ...document, lyrics: { draftTtml: serializeLyricTtml(document.lyrics, { draft: true }) } };
}
