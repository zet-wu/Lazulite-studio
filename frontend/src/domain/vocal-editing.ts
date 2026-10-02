import type { LyricDocument, TimeMs } from './lyric-document';
import type { Acoustics, VocalSegment } from './project-document';
import { validateSegments } from './project-document';
export class AssignmentError extends Error {
  constructor(message: string, readonly lineId: string, readonly objectIds: string[]) { super(message); }
}
export function assignVocalSegment(document: LyricDocument, lineId: string, segment: VocalSegment, durationMs: number): LyricDocument {
  validateSegments([segment], durationMs);
  const line = document.lines.find(item => item.id === lineId);
  if (!line) throw new Error('请选择一行歌词');
  const internal = [...line.words.flatMap(w => [w, ...w.rubyUnits, ...w.alignmentUnits]), ...document.romanizationTracks.flatMap(t => t.contents.flatMap(c => c.lineId === lineId && c.kind === 'timed' ? c.units : []))];
  if (line.beginMs === null && line.endMs === null && internal.some(unit => unit.beginMs !== null || unit.endMs !== null)) throw new AssignmentError('行内已有时间，请先明确行起点或终点', lineId, [lineId]);
  const delta = line.beginMs !== null ? segment.beginMs - line.beginMs : line.endMs !== null ? segment.endMs - line.endMs : 0;
  const invalid = [line, ...internal].filter(unit => [unit.beginMs, unit.endMs].some(t => t !== null && (!Number.isSafeInteger(t + delta) || t + delta < 0 || t + delta > durationMs)));
  if (invalid.length) throw new AssignmentError('分配后时间超出歌曲范围，未修改歌词或链接', lineId, invalid.map(x => x.id));
  const shift = <T extends { beginMs: TimeMs; endMs: TimeMs }>(unit: T): T => ({ ...unit, beginMs: unit.beginMs === null ? null : unit.beginMs + delta, endMs: unit.endMs === null ? null : unit.endMs + delta });
  // Freeze all incoming ends before moving the selected row. No recursive following.
  const lines = document.lines.map(item => {
    if (item.id !== lineId) return item.endLink?.targetLineId === lineId ? { ...item, endLink: null } : item;
    const moved = shift(item);
    if (item.beginMs === null && item.endMs === null) { moved.beginMs = segment.beginMs; moved.endMs = segment.endMs; }
    return { ...moved, endLink: null, words: item.words.map(word => ({ ...shift(word), rubyUnits: word.rubyUnits.map(shift), alignmentUnits: word.alignmentUnits.map(shift) })) };
  });
  const romanizationTracks = document.romanizationTracks.map(track => {
    const contents = track.contents.map(content => content.lineId === lineId && content.kind === 'timed' ? { ...content, units: content.units.map(shift) } : content);
    return contents.every((c,i) => c === track.contents[i]) ? track : { ...track, contents };
  });
  return { ...document, lines, romanizationTracks };
}
export function editSegments(acoustics: Acoustics, operation: { type: 'put'; segment: VocalSegment } | { type: 'delete' | 'merge'; ids: string[] }, durationMs: number): Acoustics {
  let segments: VocalSegment[];
  if (operation.type === 'put') {
    const index = acoustics.segments.findIndex(s => s.id === operation.segment.id);
    segments = index < 0 ? [...acoustics.segments, operation.segment] : acoustics.segments.map(s => s.id === operation.segment.id ? operation.segment : s);
  } else {
    const sorted = [...acoustics.segments].sort((a,b) => a.beginMs-b.beginMs || a.endMs-b.endMs || a.id.localeCompare(b.id));
    const selected = sorted.filter(s => operation.ids.includes(s.id));
    if (selected.length !== new Set(operation.ids).size || !selected.length) throw new Error('请选择有效人声片段');
    segments = acoustics.segments.filter(s => !operation.ids.includes(s.id));
    if (operation.type === 'merge') {
      if (selected.length < 2 || sorted.indexOf(selected.at(-1)!) - sorted.indexOf(selected[0]) + 1 !== selected.length) throw new Error('只能合并时间排序连续的多个片段');
      segments.push({ id: selected[0].id, beginMs: Math.min(...selected.map(s => s.beginMs)), endMs: Math.max(...selected.map(s => s.endMs)) });
    }
  }
  validateSegments(segments, durationMs);
  return { ...acoustics, segments };
}
