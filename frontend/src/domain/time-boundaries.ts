import type { LyricDocument, TimeMs } from './lyric-document';
import type { ProjectDocument, VocalSegment } from './project-document';

export type TimedObject = {
  id: string; beginMs: TimeMs; endMs: TimeMs;
  kind: 'line' | 'word' | 'ruby' | 'romanization-unit' | 'translation-unit' | 'acoustic' | 'cue';
  lineId: string; wordId?: string; rubyId?: string; trackId?: string; contentId?: string; unitId?: string;
};
export function lyricTimes(document: LyricDocument): TimedObject[] {
  const objects: TimedObject[] = [];
  const timing = ({id,beginMs,endMs}: {id:string;beginMs:TimeMs;endMs:TimeMs}) => ({id,beginMs,endMs});
  for (const line of document.lines) {
    objects.push({ ...timing(line), kind: 'line', lineId: line.id });
    for (const word of line.words) {
      objects.push({ ...timing(word), kind: 'word', lineId: line.id, wordId: word.id });
      for (const ruby of word.rubyUnits) objects.push({ ...timing(ruby), kind: 'ruby', lineId: line.id, wordId: word.id, rubyId: ruby.id });
    }
  }
  for (const [kind, tracks] of [['romanization-unit', document.romanizationTracks], ['translation-unit', document.translationTracks]] as const)
    for (const track of tracks) for (const content of track.contents) if (content.kind === 'timed')
      for (const unit of content.units) objects.push({ ...timing(unit), kind, lineId: content.lineId, trackId: track.id, contentId: content.id, unitId: unit.id });
  return objects;
}
export function projectTimes(project: ProjectDocument): TimedObject[] {
  return [...lyricTimes(project.lyrics),
    ...project.acoustics.segments.map(segment => ({ ...segment, kind: 'acoustic' as const, lineId: '' })),
    ...project.karaoke.cues.map(cue => ({ ...cue, kind: 'cue' as const, lineId: cue.anchor.lineId }))];
}
/** Check only created or changed endpoints after all snapping and linked edits. */
export function assertChangedTimes(before: TimedObject[], after: TimedObject[], durationMs: number | null) {
  if (durationMs === null) throw new Error('源音频时长未知，无法拖动时间');
  const old = new Map(before.map(item => [item.id, item]));
  for (const item of after) for (const side of ['beginMs', 'endMs'] as const) {
    const value = item[side];
    if (value !== null && value !== old.get(item.id)?.[side] && (!Number.isSafeInteger(value) || value < 0 || value > durationMs))
      throw new Error(`对象 ${item.id} 的${side === 'beginMs' ? '开始' : '结束'}时间超出源音频范围（${durationMs} ms）`);
  }
}
export function intersectSegments(segments: VocalSegment[], durationMs: number) {
  let clipped = 0, dropped = 0;
  const result = segments.flatMap(segment => {
    const beginMs = Math.max(0, segment.beginMs), endMs = Math.min(durationMs, segment.endMs);
    if (beginMs >= endMs) { dropped++; return []; }
    if (beginMs !== segment.beginMs || endMs !== segment.endMs) clipped++;
    return [{ ...segment, beginMs, endMs }];
  });
  return { segments: result, clipped, dropped };
}
