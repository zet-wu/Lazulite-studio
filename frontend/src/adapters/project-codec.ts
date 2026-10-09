import { validateSegments } from '../domain/project-document';
import { validateKaraoke } from '../domain/karaoke';
import { assertAmll } from '../domain/amll-compatibility';
import { validateProjectEditing } from '../domain/project-editing';
import type { ProjectDocument, ProjectSnapshot } from '../domain/project-document';
import { parseLyricTtml, serializeLyricTtml } from './ttml/lyric-codec';
export function parseProject(snapshot: ProjectSnapshot): ProjectDocument {
  if (snapshot.schemaVersion !== 'studio-project-v6') throw new Error('项目版本不兼容');
  const result = { ...snapshot, lyrics: parseLyricTtml(snapshot.lyrics.draftTtml, { draft: true }) };
  if (!result.acoustics || (result.acoustics.analysisId !== null && typeof result.acoustics.analysisId !== 'string') || !Array.isArray(result.acoustics.segments)) throw new Error('声学数据无效');
  validateSegments(result.acoustics.segments, Number.MAX_SAFE_INTEGER);
  validateProjectEditing(result.lyrics, result.editing);
  validateKaraoke(result.lyrics, result.karaoke);
  assertAmll(result.lyrics, result.amll);
  if(!Array.isArray(result.lineOrder) || new Set(result.lineOrder).size!==result.lineOrder.length || result.lineOrder.some(id=>!result.lyrics.lines.some(line=>line.id===id))) throw new Error('背景前置引用无效');
  return result;
}
export function serializeProject(document: ProjectDocument): ProjectSnapshot {
  validateProjectEditing(document.lyrics, document.editing);
  validateKaraoke(document.lyrics, document.karaoke);
  assertAmll(document.lyrics, document.amll);
  return { ...document, lyrics: { draftTtml: serializeLyricTtml(document.lyrics, { draft: true }) } };
}
