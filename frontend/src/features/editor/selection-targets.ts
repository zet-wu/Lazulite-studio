import { attachmentTracks } from '../../domain/selection-editing';
import type { LyricDocument, LyricLine, LyricWord, RomanizationTrack, RomanizationUnit, RubyUnit } from '../../domain/lyric-document';
import type { TimelineTarget } from '../../domain/timeline-editing';
import type { EditorSelection } from './editing-actions';

export const targetId = (target: TimelineTarget) => target.kind === 'line' ? target.lineId : target.kind === 'word' ? target.wordId : target.kind === 'ruby' ? target.rubyId : target.unitId;
const targetCache = new WeakMap<LyricDocument, TimelineTarget[]>();
export function documentTargets(document: LyricDocument): TimelineTarget[] {
  const cached = targetCache.get(document); if (cached) return cached;
  const targets = [...document.lines.flatMap<TimelineTarget>(line => [
    { kind: 'line' as const, lineId: line.id },
    ...line.words.flatMap(word => [{ kind: 'word' as const, lineId: line.id, wordId: word.id }, ...word.rubyUnits.map(unit => ({ kind: 'ruby' as const, lineId: line.id, wordId: word.id, rubyId: unit.id }))]),
  ]), ...(['romanizationTracks','translationTracks'] as const).flatMap(key=>document[key].flatMap(track => track.contents.flatMap(content => content.kind === 'timed' ? content.units.map(unit => ({ kind: 'romanization' as const, ...(key==='translationTracks'?{attachment:'translation' as const}:{}), lineId: content.lineId, trackId: track.id, contentId: content.id, unitId: unit.id })) : [])))];
  targetCache.set(document, targets); return targets;
}

type LineIndex = { line: LyricLine; words: Map<string, { word: LyricWord; rubies: Map<string, RubyUnit> }> };
type AttachmentIndex = Map<string, Map<string, Map<string, RomanizationUnit>>>;
type DocumentIndex = { lines: Map<string, LineIndex>; romanization: AttachmentIndex; translation: AttachmentIndex };
const indexCache = new WeakMap<LyricDocument, DocumentIndex>();

function indexTracks(tracks: RomanizationTrack[]): AttachmentIndex {
  const result: AttachmentIndex = new Map();
  for (const track of tracks) {
    const contents = new Map<string, Map<string, RomanizationUnit>>();
    for (const content of track.contents) {
      if (content.kind === 'timed') {
        contents.set(content.id, new Map(content.units.map(unit => [unit.id, unit])));
      }
    }
    result.set(track.id, contents);
  }
  return result;
}

function documentIndex(document: LyricDocument): DocumentIndex {
  const cached = indexCache.get(document);
  if (cached) return cached;
  const lines = new Map<string, LineIndex>();
  for (const line of document.lines) {
    const words = new Map<string, { word: LyricWord; rubies: Map<string, RubyUnit> }>();
    for (const word of line.words) {
      words.set(word.id, { word, rubies: new Map(word.rubyUnits.map(unit => [unit.id, unit])) });
    }
    lines.set(line.id, { line, words });
  }
  const index: DocumentIndex = {
    lines,
    romanization: indexTracks(document.romanizationTracks),
    translation: indexTracks(document.translationTracks),
  };
  indexCache.set(document, index);
  return index;
}

export const selectionKind = (target: TimelineTarget): EditorSelection['kind'] => target.kind === 'line' ? 'lines' : target.kind === 'word' ? 'words' : target.kind === 'ruby' ? 'ruby' : 'romanization-unit';
export function selectionTargets(document: LyricDocument, selection: EditorSelection | null) {
  if (!selection) return [];
  const selectedIds = new Set(selection.ids);
  return documentTargets(document).filter(target => selectionKind(target) === selection.kind && selectedIds.has(targetId(target)));
}
export function targetSelection(target: TimelineTarget, ids = [targetId(target)], anchorId = targetId(target)): EditorSelection {
  const common = { ids, anchorId, activeId: targetId(target) };
  if (target.kind === 'line') return { kind: 'lines', ...common };
  if (target.kind === 'word') return { kind: 'words', lineId: target.lineId, ...common };
  if (target.kind === 'ruby') return { kind: 'ruby', lineId: target.lineId, wordId: target.wordId, ...common };
  return { kind: 'romanization-unit', ...(target.attachment?{attachment:target.attachment}:{}), lineId: target.lineId, trackId: target.trackId, contentId: target.contentId, ...common };
}
export function targetInterval(document: LyricDocument, target: TimelineTarget) {
  const index = documentIndex(document);
  if (target.kind === 'romanization') {
    const tracks = target.attachment === 'translation' ? index.translation : index.romanization;
    return tracks.get(target.trackId)?.get(target.contentId)?.get(target.unitId);
  }
  const lineEntry = index.lines.get(target.lineId);
  if (!lineEntry) return undefined;
  if (target.kind === 'line') return lineEntry.line;
  const wordEntry = lineEntry.words.get(target.wordId);
  if (!wordEntry) return undefined;
  return target.kind === 'word' ? wordEntry.word : wordEntry.rubies.get(target.rubyId);
}
export function selectionEnvelope(document: LyricDocument, selection: EditorSelection | null, duration: number) {
  const targets = selectionTargets(document, selection);
  if (selection?.kind === 'romanization-content' && attachmentTracks(document,selection).flatMap(track => track.contents).filter(content => selection.ids.includes(content.id)).length !== selection.ids.length) return { reason: 'selection.staleEnvelope' };
  const intervals = selection?.kind === 'romanization-content' ? attachmentTracks(document,selection).flatMap(track => track.contents.filter(content => selection.ids.includes(content.id)).flatMap(content => content.kind === 'timed' ? (content.units.length ? content.units : [{ id: content.id, text: '', beginMs: null, endMs: null }]) : [{ id: content.id, text: content.text, beginMs: null, endMs: null }])) : targets.map(target => targetInterval(document, target));
  if (selection && selection.kind !== 'romanization-content' && targets.length !== selection.ids.length) return { reason: 'selection.staleEnvelope' };
  if (!selection?.ids.length || !intervals.length) return { reason: 'selection.chooseTimed' };
  if (intervals.some(item => !item || item.beginMs === null || item.endMs === null)) return { reason: 'selection.invalidTimes' };
  const points = intervals.flatMap(item => [item!.beginMs!, item!.endMs!]);
  const begin_ms = Math.min(...points), end_ms = Math.max(...points);
  return begin_ms < end_ms && end_ms <= duration ? { range: { begin_ms, end_ms }, reason: '' } : { reason: 'selection.outsideMedia' };
}

/** Partial selections can locate any real endpoint or legal display projection. */
export function selectionLocation(document: LyricDocument, selection: EditorSelection | null, duration: number) {
  const intervals = selection?.kind === 'romanization-content'
    ? attachmentTracks(document,selection).flatMap(track=>track.contents.filter(content=>selection.ids.includes(content.id)).flatMap(content=>content.kind==='timed'?content.units:[]))
    : selectionTargets(document,selection).map(target=>targetInterval(document,target));
  const times=intervals.flatMap(item=>item?[item.beginMs,item.endMs]:[]).filter((value):value is number=>value!==null&&value<=duration);
  return times.length?{beginMs:Math.min(...times),endMs:Math.max(...times)}:null;
}

export type LyricSnapAnchor={time:number;target?:TimelineTarget;side?:'beginMs'|'endMs'};
/** Retain endpoint identity: an unrelated boundary at the same time is still usable. */
export function lyricSnapAnchors(before:LyricDocument,after:LyricDocument|null,excluded:(target:TimelineTarget)=>boolean,external:number[]):LyricSnapAnchor[]{
  return [...external.map(time=>({time})),...documentTargets(before).filter(target=>!excluded(target)).flatMap(target=>{
    const old=targetInterval(before,target),next=after?targetInterval(after,target):old;
    return old&&next?(['beginMs','endMs'] as const).flatMap(side=>old[side]!==null&&old[side]===next[side]?[{time:old[side]!,target,side}]:[]):[];
  })];
}
export const stableSnapAnchor=(anchor:LyricSnapAnchor,document:LyricDocument)=>!anchor.target||targetInterval(document,anchor.target)?.[anchor.side!]===anchor.time;
