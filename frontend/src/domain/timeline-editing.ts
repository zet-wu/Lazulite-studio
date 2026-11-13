import { message, MessageError } from './messages';
import { createProjectEditing, followChangedEndLinks, type ProjectEditing } from './project-editing';
import type { LyricDocument, LyricLine, LyricWord, RubyUnit, TimeMs } from './lyric-document';
import { shiftLineTimes } from './batch-editing';

export type TimelineTarget =
  | { kind: 'line'; lineId: string }
  | { kind: 'word'; lineId: string; wordId: string }
  | { kind: 'ruby'; lineId: string; wordId: string; rubyId: string }
  | { kind: 'romanization'; attachment?: 'translation'; lineId: string; trackId: string; contentId: string; unitId: string };

const changed = (time: TimeMs, delta: number): TimeMs => {
  if (time === null) return null;
  const value = time + delta;
  if (!Number.isSafeInteger(value) || value < 0) throw new MessageError(message('timeline.rangeInvalid'));
  return value;
};
const valid = (begin: TimeMs, end: TimeMs) => {
  for (const time of [begin, end]) if (time !== null && (!Number.isSafeInteger(time) || time < 0)) throw new MessageError(message('timeline.integerTime'));
  if (begin !== null && end !== null && begin > end) throw new MessageError(message('timeline.reversed'));
};
const envelope = (values: TimeMs[], minimum: boolean): TimeMs => {
  const numbers = values.filter((value): value is number => value !== null);
  return numbers.length ? (minimum ? Math.min(...numbers) : Math.max(...numbers)) : null;
};
const include = (line: LyricLine, word: LyricWord, editing: ProjectEditing): LyricLine => {
  const beginMs = line.beginMs === null ? null : envelope([line.beginMs, word.beginMs], true);
  const endMs = line.endMs === null ? null : envelope([line.endMs, word.endMs], false);
  if (editing.endLinks[line.id] && endMs !== line.endMs) throw new MessageError(message('timeline.linkConflict'));
  return { ...line, beginMs, endMs };
};
const moveWord = (word: LyricWord, deltaMs: number): LyricWord => ({ ...word,
  beginMs: changed(word.beginMs, deltaMs), endMs: changed(word.endMs, deltaMs),
  rubyUnits: word.rubyUnits.map((unit) => ({ ...unit, beginMs: changed(unit.beginMs, deltaMs), endMs: changed(unit.endMs, deltaMs) })),
});

function editTarget(document: LyricDocument, target: TimelineTarget, update: (line: LyricLine) => LyricLine): LyricDocument {
  const index = document.lines.findIndex((line) => line.id === target.lineId);
  if (index < 0) throw new MessageError(message('timeline.lineMissing'));
  const lines = document.lines.slice();
  lines[index] = update(lines[index]);
  return { ...document, lines };
}

function moveTargets(document: LyricDocument, targets: TimelineTarget[], deltaMs: number, editing = createProjectEditing()): LyricDocument {
  if (!Number.isSafeInteger(deltaMs)) throw new MessageError(message('timeline.integerOffset'));
  if (!targets.length || !deltaMs) return document;
  if (targets.every((target) => target.kind === 'line')) {
    const ids = new Set(targets.map((target) => target.lineId));
    if (document.lines.some(line => ids.has(line.id) && (line.beginMs === null || line.endMs === null))) throw new MessageError(message('timeline.lineTimesRequired'));
    return (shiftLineTimes(document, [...ids], deltaMs, editing) as Extract<ReturnType<typeof shiftLineTimes>, { type: 'replace-document' }>).document;
  }
  if (new Set(targets.map(target => target.kind)).size > 1) throw new MessageError(message('timeline.sameKind'));
  if (targets.every(target => target.kind === 'romanization')) {
    let next = document;
    for (const target of targets) next = editRomanization(next,target,unit=>{
      if(unit.beginMs===null||unit.endMs===null)throw new MessageError(message('timeline.unitTimesRequired'));
      return {...unit,beginMs:changed(unit.beginMs,deltaMs),endMs:changed(unit.endMs,deltaMs)};
    });
    return next;
  }
  let result = document;
  for (const target of targets) {
    if (target.kind === 'romanization') throw new MessageError(message('timeline.sameKind'));
    if (target.kind === 'line') throw new MessageError(message('timeline.mixedTracks'));
    result = editTarget(result, target, (line) => {
      const index = line.words.findIndex((word) => word.id === target.wordId);
      if (index < 0) throw new MessageError(message('timeline.wordMissing'));
      const words = line.words.slice();
      const word = words[index];
      if (target.kind === 'word') {
        if (word.beginMs === null || word.endMs === null) throw new MessageError(message('timeline.wordTimesRequired'));
        words[index] = moveWord(word, deltaMs);
      } else {
        const rubyIndex = word.rubyUnits.findIndex((unit) => unit.id === target.rubyId);
        if (rubyIndex < 0) throw new MessageError(message('timeline.rubyMissing'));
        const rubyUnits = word.rubyUnits.slice();
        const unit = rubyUnits[rubyIndex];
        if (unit.beginMs === null || unit.endMs === null) throw new MessageError(message('timeline.rubyTimesRequired'));
        rubyUnits[rubyIndex] = { ...unit, beginMs: changed(unit.beginMs, deltaMs), endMs: changed(unit.endMs, deltaMs) };
        words[index] = { ...word, rubyUnits,
          beginMs: word.beginMs === null ? null : envelope(rubyUnits.map((item) => item.beginMs), true) ?? word.beginMs, endMs: word.endMs === null ? null : envelope(rubyUnits.map((item) => item.endMs), false) ?? word.endMs, };
      }
      return include({ ...line, words }, words[index], editing);
    });
  }
  return result;
}

function resizeTarget(document: LyricDocument, target: TimelineTarget, side: 'beginMs' | 'endMs', timeMs: number, editing = createProjectEditing()): LyricDocument {
  valid(timeMs, timeMs);
  if (target.kind === 'romanization') return editRomanization(document, target, unit => { const next = { ...unit, [side]: timeMs }; valid(next.beginMs, next.endMs); return next; });
  return editTarget(document, target, (line) => {
    if (target.kind === 'line') {
      const beginMs = side === 'beginMs' ? timeMs : line.beginMs;
      const endMs = side === 'endMs' ? timeMs : line.endMs;
      valid(beginMs, endMs);
      if (line.words.flatMap(word => [word, ...word.rubyUnits]).some((word) => beginMs !== null && word.beginMs !== null && word.beginMs < beginMs || endMs !== null && word.endMs !== null && word.endMs > endMs)) throw new MessageError(message('timeline.lineExcludesWords'));
      if (editing.endLinks[line.id] && endMs !== line.endMs) throw new MessageError(message('timeline.linkConflict'));
      return { ...line, beginMs, endMs };
    }
    const index = line.words.findIndex((word) => word.id === target.wordId);
    if (index < 0) throw new MessageError(message('timeline.wordMissing'));
    const words = line.words.slice();
    const word = words[index];
    if (target.kind === 'word') {
      const beginMs = side === 'beginMs' ? timeMs : word.beginMs;
      const endMs = side === 'endMs' ? timeMs : word.endMs;
      valid(beginMs, endMs);
      if (word.rubyUnits.some((unit) => beginMs !== null && unit.beginMs !== null && unit.beginMs < beginMs || endMs !== null && unit.endMs !== null && unit.endMs > endMs)) throw new MessageError(message('timeline.wordExcludesRuby'));
      words[index] = { ...word, beginMs, endMs };
    } else {
      const rubyIndex = word.rubyUnits.findIndex((unit) => unit.id === target.rubyId);
      if (rubyIndex < 0) throw new MessageError(message('timeline.rubyMissing'));
      const rubyUnits = word.rubyUnits.slice();
      const unit: RubyUnit = { ...rubyUnits[rubyIndex], [side]: timeMs };
      valid(unit.beginMs, unit.endMs);
      rubyUnits[rubyIndex] = unit;
      words[index] = { ...word, rubyUnits,
        beginMs: word.beginMs === null ? null : envelope(rubyUnits.map((item) => item.beginMs), true) ?? word.beginMs, endMs: word.endMs === null ? null : envelope(rubyUnits.map((item) => item.endMs), false) ?? word.endMs };
    }
    return include({ ...line, words }, words[index], editing);
  });
}

export function snapTime(timeMs: number, anchors: number[], toleranceMs: number): number {
  const nearest = anchors.reduce<{ value: number; distance: number } | null>((best, value) => {
    const distance = Math.abs(value - timeMs);
    return distance <= toleranceMs && (!best || distance < best.distance) ? { value, distance } : best;
  }, null);
  return nearest?.value ?? timeMs;
}

/** Shared pixel-to-time conversion for lyric and segment gestures. */
export const timelineDelta = (pixels: number, width: number, spanMs: number) => Math.round(pixels / width * spanMs);
export const snapTimelineTime = (timeMs: number, anchors: number[], spanMs: number, width: number, enabled: boolean) =>
  Math.round(enabled ? snapTime(timeMs, anchors, spanMs * 8 / width) : timeMs);

function editRomanization(document: LyricDocument, target: Extract<TimelineTarget, { kind: 'romanization' }>, update: (unit: import('./lyric-document').RomanizationUnit) => import('./lyric-document').RomanizationUnit): LyricDocument {
  let found = false;
  const key=target.attachment==='translation'?'translationTracks':'romanizationTracks';
  const tracks = document[key].map(track => track.id !== target.trackId ? track : { ...track, contents: track.contents.map(content => {
    if (content.id !== target.contentId || content.lineId !== target.lineId || content.kind !== 'timed') return content;
    return { ...content, units: content.units.map(unit => { if (unit.id !== target.unitId) return unit; found = true; return update(unit); }) };
  }) });
  if (!found) throw new MessageError(message('timeline.romanizationMissing'));
  return { ...document, [key]: tracks };
}

export function moveTimeline(document: LyricDocument, targets: TimelineTarget[], deltaMs: number, editing = createProjectEditing()) {
  return followChangedEndLinks(document, moveTargets(document, targets, deltaMs, editing), editing);
}
export function resizeTimeline(document: LyricDocument, target: TimelineTarget, side: 'beginMs' | 'endMs', timeMs: number, editing = createProjectEditing()) {
  return followChangedEndLinks(document, resizeTarget(document, target, side, timeMs, editing), editing);
}

/** Assign both endpoints without moving descendants; expand parents in the same transaction. */
export function assignTimeline(document: LyricDocument, target: TimelineTarget, dropMs: number, durationMs: number, editing = createProjectEditing()): LyricDocument {
  const line = document.lines.find(line => line.id === target.lineId);
  if (!line) throw new MessageError(message('timeline.lineMissing'));
  const word = target.kind === 'word' || target.kind === 'ruby' ? line.words.find(word => word.id === target.wordId) : undefined;
  const tracks = target.kind === 'romanization' ? document[target.attachment === 'translation' ? 'translationTracks' : 'romanizationTracks'] : [];
  const content = target.kind === 'romanization' ? tracks.find(t => t.id === target.trackId)?.contents.find(c => c.id === target.contentId && c.lineId === target.lineId) : undefined;
  const siblings = target.kind === 'line' ? document.lines.filter(l => l.backgroundOf === line.backgroundOf) : target.kind === 'word' ? line.words : target.kind === 'ruby' ? word?.rubyUnits ?? [] : content?.kind === 'timed' ? content.units : [];
  const id = target.kind === 'line' ? target.lineId : target.kind === 'word' ? target.wordId : target.kind === 'ruby' ? target.rubyId : target.unitId;
  const index = siblings.findIndex(item => item.id === id);
  if (index < 0) throw new MessageError(message('timeline.unitTimesRequired'));
  const full = (item: {beginMs:TimeMs;endMs:TimeMs}): item is {beginMs:number;endMs:number} => item.beginMs !== null && item.endMs !== null && item.endMs > item.beginMs;
  const local = [...siblings.slice(0,index).filter(full).slice(-2), ...siblings.slice(index+1).filter(full).slice(0,2)];
  const global = target.kind === 'line' ? document.lines : target.kind === 'word' ? document.lines.flatMap(l=>l.words) : target.kind === 'ruby' ? document.lines.flatMap(l=>l.words.flatMap(w=>w.rubyUnits)) : tracks.flatMap(t=>t.contents.flatMap(c=>c.kind==='timed'?c.units:[]));
  const samples = (local.length ? local : global).filter(full);
  let beginMs = Math.round(dropMs), endMs = beginMs + (samples.length ? Math.round(samples.reduce((sum,item)=>sum+item.endMs!-item.beginMs!,0)/samples.length) : target.kind==='line'?1000:300);
  const timedSiblings = siblings.filter(item=>item.id!==id && full(item));
  for (let i=0;i<timedSiblings.length-1;i++) {
    const left=timedSiblings[i], right=timedSiblings[i+1];
    if (left.endMs! < right.beginMs! && dropMs >= left.endMs! && dropMs <= right.beginMs! && !timedSiblings.some(item=>item!==left&&item!==right&&item.beginMs!<right.beginMs!&&item.endMs!>left.endMs!)) { beginMs=left.endMs!; endMs=right.beginMs!; break; }
  }
  const attachments = [...document.romanizationTracks,...document.translationTracks].flatMap(t=>t.contents.flatMap(c=>c.lineId===line.id&&c.kind==='timed'?c.units:[]));
  const children = target.kind==='line' ? [...line.words.flatMap(w=>[w,...w.rubyUnits]),...attachments] : target.kind==='word' ? word!.rubyUnits : [];
  beginMs = Math.max(0,Math.min(beginMs,...children.flatMap(c=>c.beginMs===null?[]:[c.beginMs])));
  endMs = Math.min(durationMs,Math.max(endMs,...children.flatMap(c=>c.endMs===null?[]:[c.endMs])));
  if (!Number.isSafeInteger(durationMs) || beginMs >= endMs || children.some(c=>c.endMs!==null&&c.endMs>durationMs)) throw new MessageError(message('timeline.rangeInvalid'));
  const includeChildren = <T extends {beginMs:TimeMs;endMs:TimeMs}>(parent:T, children:{beginMs:TimeMs;endMs:TimeMs}[]):T => ({...parent,
    beginMs:envelope([parent.beginMs,...children.map(c=>c.beginMs)],true),endMs:envelope([parent.endMs,...children.map(c=>c.endMs)],false)});
  let next = target.kind==='romanization' ? editRomanization(document,target,unit=>({...unit,beginMs,endMs})) : editTarget(document,target,current=>{
    if (target.kind==='line') return {...current,beginMs,endMs};
    const words=current.words.map(w=>w.id!==target.wordId?w:target.kind==='word'?{...w,beginMs,endMs}:includeChildren({...w,rubyUnits:w.rubyUnits.map(u=>u.id===target.rubyId?{...u,beginMs,endMs}:u)},w.rubyUnits.map(u=>u.id===target.rubyId?{...u,beginMs,endMs}:u)));
    return includeChildren({...current,words},[...words.flatMap(w=>[w,...w.rubyUnits]),...attachments]);
  });
  if (target.kind==='romanization') next=editTarget(next,target,current=>includeChildren(current,[{beginMs,endMs},...current.words.flatMap(w=>[w,...w.rubyUnits]),...attachments]));
  const changedLine=next.lines.find(l=>l.id===line.id)!;
  if (editing.endLinks[line.id] && changedLine.endMs!==line.endMs) throw new MessageError(message('timeline.linkConflict'));
  return followChangedEndLinks(document,next,editing);
}
