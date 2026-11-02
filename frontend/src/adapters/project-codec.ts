import { message, MessageError } from '../domain/messages';
import { initializeSingerMarkers } from '../domain/singer-markers';
import { validateSegments } from '../domain/project-document';
import { validateKaraoke } from '../domain/karaoke';
import { assertAmll } from '../domain/amll-compatibility';
import { validateProjectEditing } from '../domain/project-editing';
import type { ProjectDocument, ProjectSnapshot } from '../domain/project-document';
import { parseLyricTtml, serializeLyricTtml } from './ttml/lyric-codec';
export function parseProject(snapshot: ProjectSnapshot): ProjectDocument {
  if (snapshot.schemaVersion !== 'studio-project-v9') throw new MessageError(message('parse.projectVersion'));
  const result = { ...snapshot, lyrics: parseLyricTtml(snapshot.lyrics.draftTtml, { draft: true }) };
  if (!result.acoustics || (result.acoustics.analysisId !== null && typeof result.acoustics.analysisId !== 'string') || !Array.isArray(result.acoustics.segments)) throw new MessageError(message('parse.acousticsInvalid'));
  validateSegments(result.acoustics.segments);
  validateProjectEditing(result.lyrics, result.editing);
  validateKaraoke(result.lyrics, result.karaoke);
  assertAmll(result.lyrics, result.amll);
  if(!Array.isArray(result.lineOrder) || new Set(result.lineOrder).size!==result.lineOrder.length || result.lineOrder.some(id=>!result.lyrics.lines.some(line=>line.id===id))) throw new MessageError(message('parse.backgroundReference'));
  return { ...result, karaoke: { ...result.karaoke, singerMarkers: initializeSingerMarkers(result.lyrics, result.karaoke.singerMarkers) } };
}
export function serializeProject(document: ProjectDocument): ProjectSnapshot {
  validateProjectEditing(document.lyrics, document.editing);
  validateKaraoke(document.lyrics, document.karaoke);
  assertAmll(document.lyrics, document.amll);
  return { ...document, lyrics: { draftTtml: serializeLyricTtml(document.lyrics, { draft: true }) } };
}
