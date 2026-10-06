import type { LyricDocument } from '../../domain/lyric-document';
import type { TimelineTarget } from '../../domain/timeline-editing';
import type { EditorSelection } from './editing-actions';

export const targetId = (target: TimelineTarget) => target.kind === 'line' ? target.lineId : target.kind === 'word' ? target.wordId : target.kind === 'ruby' ? target.rubyId : target.unitId;
const targetCache = new WeakMap<LyricDocument, TimelineTarget[]>();
export function documentTargets(document: LyricDocument): TimelineTarget[] {
  const cached = targetCache.get(document); if (cached) return cached;
  const targets = [...document.lines.flatMap<TimelineTarget>(line => [
    { kind: 'line' as const, lineId: line.id },
    ...line.words.flatMap(word => [{ kind: 'word' as const, lineId: line.id, wordId: word.id }, ...word.rubyUnits.map(unit => ({ kind: 'ruby' as const, lineId: line.id, wordId: word.id, rubyId: unit.id }))]),
  ]), ...document.romanizationTracks.flatMap(track => track.contents.flatMap(content => content.kind === 'timed' ? content.units.map(unit => ({ kind: 'romanization' as const, lineId: content.lineId, trackId: track.id, contentId: content.id, unitId: unit.id })) : []))];
  targetCache.set(document, targets); return targets;
}
export const selectionKind = (target: TimelineTarget): EditorSelection['kind'] => target.kind === 'line' ? 'lines' : target.kind === 'word' ? 'words' : target.kind === 'ruby' ? 'ruby' : 'romanization-unit';
export function selectionTargets(document: LyricDocument, selection: EditorSelection | null) {
  return selection ? documentTargets(document).filter(target => selectionKind(target) === selection.kind && selection.ids.includes(targetId(target))) : [];
}
export function targetSelection(target: TimelineTarget, ids = [targetId(target)], anchorId = targetId(target)): EditorSelection {
  const common = { ids, anchorId, activeId: targetId(target) };
  if (target.kind === 'line') return { kind: 'lines', ...common };
  if (target.kind === 'word') return { kind: 'words', lineId: target.lineId, ...common };
  if (target.kind === 'ruby') return { kind: 'ruby', lineId: target.lineId, wordId: target.wordId, ...common };
  return { kind: 'romanization-unit', lineId: target.lineId, trackId: target.trackId, contentId: target.contentId, ...common };
}
export function targetInterval(document: LyricDocument, target: TimelineTarget) {
  const line = document.lines.find(line => line.id === target.lineId)!;
  if (target.kind === 'line') return line;
  if (target.kind === 'romanization') {
    const content = document.romanizationTracks.find(track => track.id === target.trackId)?.contents.find(content => content.id === target.contentId);
    return content?.kind === 'timed' ? content.units.find(unit => unit.id === target.unitId)! : undefined;
  }
  const word = line?.words.find(word => word.id === target.wordId);
  return target.kind === 'word' ? word : word?.rubyUnits.find(unit => unit.id === target.rubyId);
}
export function selectionEnvelope(document: LyricDocument, selection: EditorSelection | null, duration: number) {
  const targets = selectionTargets(document, selection);
  if (selection?.kind === 'romanization-content' && document.romanizationTracks.flatMap(track => track.contents).filter(content => selection.ids.includes(content.id)).length !== selection.ids.length) return { reason: '选区包含已失效对象' };
  const intervals = selection?.kind === 'romanization-content' ? document.romanizationTracks.flatMap(track => track.contents.filter(content => selection.ids.includes(content.id)).flatMap(content => content.kind === 'timed' ? (content.units.length ? content.units : [{ id: content.id, text: '', beginMs: null, endMs: null }]) : [{ id: content.id, text: content.text, beginMs: null, endMs: null }])) : targets.map(target => targetInterval(document, target));
  if (selection && selection.kind !== 'romanization-content' && targets.length !== selection.ids.length) return { reason: '选区包含已失效对象' };
  if (!selection?.ids.length || !intervals.length) return { reason: '请选择有时间的对象' };
  if (intervals.some(item => !item || item.beginMs === null || item.endMs === null || !Number.isSafeInteger(item.beginMs) || !Number.isSafeInteger(item.endMs) || item.beginMs < 0 || item.endMs < item.beginMs)) return { reason: '选区包含未定时或非法时间' };
  const begin_ms = Math.min(...intervals.map(item => item!.beginMs!)), end_ms = Math.max(...intervals.map(item => item!.endMs!));
  return begin_ms < end_ms && end_ms <= duration ? { range: { begin_ms, end_ms }, reason: '' } : { reason: '选区为空或超出媒体范围' };
}
