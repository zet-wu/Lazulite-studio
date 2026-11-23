import { message, MessageError } from './messages';
import { createProjectEditing, followChangedEndLinks, type ProjectEditing } from './project-editing';
import type { LyricDocument, LyricLine, LyricWord, RubyUnit, TimeMs } from './lyric-document';
import { shiftLineTimes } from './batch-editing';

export type TimelineTarget =
  | { kind: 'line'; lineId: string }
  | { kind: 'word'; lineId: string; wordId: string }
  | { kind: 'ruby'; lineId: string; wordId: string; rubyId: string }
  | { kind: 'romanization'; attachment?: 'translation'; lineId: string; trackId: string; contentId: string; unitId: string };

type BoundarySide = 'beginMs' | 'endMs';

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
/** Only a changed ruby envelope moves that side of its parent. */
function resizeRubyParent(word: LyricWord, rubyUnits: RubyUnit[], sides: Iterable<BoundarySide>): LyricWord {
  let next = { ...word, rubyUnits };
  for (const side of sides) {
    const before = envelope(word.rubyUnits.map(unit => unit[side]), side === 'beginMs');
    const after = envelope(rubyUnits.map(unit => unit[side]), side === 'beginMs');
    if (word[side] !== null && before !== after) next = { ...next, [side]: after ?? word[side] };
  }
  return next;
}
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
      words[index] = resizeRubyParent(word, rubyUnits, [side]);
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

/** Compare both ends, preserving duration; callers validate their own complete transaction. */
export function snapTimelineInterval(beginMs:number,endMs:number,anchors:number[],spanMs:number,width:number,enabled:boolean,accept:(delta:number,anchorIndex:number)=>boolean=()=>true):number {
  if(!enabled)return 0;
  const tolerance=spanMs*8/width;
  const candidates=anchors.flatMap((time,anchorIndex)=>[beginMs,endMs].map((end,side)=>({delta:Math.round(time-end),time,side,anchorIndex})))
    .filter(candidate=>Math.abs(candidate.delta)<=tolerance)
    .sort((a,b)=>Math.abs(a.delta)-Math.abs(b.delta)||a.side-b.side||a.time-b.time);
  for(const candidate of candidates)if(accept(candidate.delta,candidate.anchorIndex))return candidate.delta;
  return 0;
}

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

export type TimelineBoundary = { target: TimelineTarget; side: BoundarySide };
const boundaryId = (target: TimelineTarget) => target.kind === 'line' ? target.lineId : target.kind === 'word' ? target.wordId : target.kind === 'ruby' ? target.rubyId : target.unitId;

/** Resolve against the source document so preview changes cannot break adjacency. */
export function timelineBoundaryTargets(document: LyricDocument, target: TimelineTarget, side: BoundarySide, linked: boolean): TimelineBoundary[] {
  const edges: TimelineBoundary[] = [{ target, side }];
  if (!linked || target.kind === 'line') return edges;
  const opposite = side === 'beginMs' ? 'endMs' : 'beginMs';
  const direction = side === 'beginMs' ? -1 : 1;
  if (target.kind === 'romanization') {
    const tracks = document[target.attachment === 'translation' ? 'translationTracks' : 'romanizationTracks'];
    const content = tracks.find(track => track.id === target.trackId)?.contents.find(item => item.id === target.contentId && item.lineId === target.lineId);
    if (content?.kind !== 'timed') return edges;
    const index = content.units.findIndex(unit => unit.id === target.unitId);
    const current = content.units[index], adjacent = content.units[index + direction];
    if (current && adjacent && current.beginMs !== null && current.endMs !== null && adjacent.beginMs !== null && adjacent.endMs !== null && current[side] === adjacent[opposite])
      edges.push({ target: { ...target, unitId: adjacent.id }, side: opposite });
    return edges;
  }
  const line = document.lines.find(line => line.id === target.lineId)!;
  const word = line.words.find(word => word.id === target.wordId)!;
  const wordTarget = (word: LyricWord): TimelineTarget => ({ kind: 'word', lineId: line.id, wordId: word.id });
  const leafTargets = (word: LyricWord): { target: TimelineTarget; value: LyricWord | RubyUnit }[] => word.rubyUnits.length
    ? word.rubyUnits.map(unit => ({ target: { kind: 'ruby', lineId: line.id, wordId: word.id, rubyId: unit.id }, value: unit }))
    : [{ target: wordTarget(word), value: word }];
  const words = line.words.filter(item => item.id === word.id || item.text.trim() || item.beginMs !== null && item.endMs !== null);
  const sequence = target.kind === 'word'
    ? words.map(value => ({ target: wordTarget(value), value })) : words.flatMap(leafTargets);
  const index = sequence.findIndex(item => boundaryId(item.target) === boundaryId(target));
  const current = sequence[index], adjacent = sequence[index + direction];
  if (!current || !adjacent || current.value.beginMs === null || current.value.endMs === null || adjacent.value.beginMs === null || adjacent.value.endMs === null || current.value[side] !== adjacent.value[opposite]) return edges;
  edges.push({ target: adjacent.target, side: opposite });
  // A word handle carries only a coincident first/last ruby endpoint.
  for (const edge of [...edges]) {
    if (edge.target.kind !== 'word') continue;
    const wordId = edge.target.wordId;
    const owner = line.words.find(item => item.id === wordId)!;
    const ruby = edge.side === 'beginMs' ? owner.rubyUnits[0] : owner.rubyUnits.at(-1);
    if (ruby && ruby[edge.side] === owner[edge.side]) edges.push({ target: { kind: 'ruby', lineId: line.id, wordId: owner.id, rubyId: ruby.id }, side: edge.side });
  }
  return edges;
}

/** Apply every endpoint before validating parents; the caller commits one document. */
export function resizeTimelineBoundary(document: LyricDocument, target: TimelineTarget, side: BoundarySide, timeMs: number, linked: boolean, editing = createProjectEditing()): LyricDocument {
  const edges = timelineBoundaryTargets(document, target, side, linked);
  if (edges.length === 1) return resizeTimeline(document, target, side, timeMs, editing);
  valid(timeMs, timeMs);
  let next = document;
  const wordIds = new Set<string>(), rubyWordSides = new Map<string, Set<BoundarySide>>();
  for (const edge of edges) {
    const item = edge.target;
    if (item.kind === 'romanization') next = editRomanization(next, item, unit => {
      const updated = { ...unit, [edge.side]: timeMs }; valid(updated.beginMs, updated.endMs); return updated;
    });
    else if (item.kind === 'word' || item.kind === 'ruby') {
      if (item.kind === 'word') wordIds.add(item.wordId);
      else {
        const sides = rubyWordSides.get(item.wordId) ?? new Set<BoundarySide>();
        sides.add(edge.side); rubyWordSides.set(item.wordId, sides);
      }
      next = editTarget(next, item, line => ({ ...line, words: line.words.map(word => word.id !== item.wordId ? word : item.kind === 'word'
        ? { ...word, [edge.side]: timeMs }
        : { ...word, rubyUnits: word.rubyUnits.map(unit => unit.id === item.rubyId ? { ...unit, [edge.side]: timeMs } : unit) }) }));
    }
  }
  if (target.kind !== 'romanization') next = editTarget(next, target, line => {
    const words = line.words.map(word => {
      if (!wordIds.has(word.id) && !rubyWordSides.has(word.id)) return word;
      if (!wordIds.has(word.id)) {
        const original = document.lines.find(item => item.id === line.id)!.words.find(item => item.id === word.id)!;
        word = resizeRubyParent(original, word.rubyUnits, rubyWordSides.get(word.id)!);
      }
      valid(word.beginMs, word.endMs);
      for (const unit of word.rubyUnits) {
        valid(unit.beginMs, unit.endMs);
        if (word.beginMs !== null && unit.beginMs !== null && unit.beginMs < word.beginMs || word.endMs !== null && unit.endMs !== null && unit.endMs > word.endMs) throw new MessageError(message('timeline.wordExcludesRuby'));
      }
      return word;
    });
    let result = { ...line, words };
    for (const word of words) if (wordIds.has(word.id) || rubyWordSides.has(word.id)) result = include(result, word, editing);
    return result;
  });
  return followChangedEndLinks(document, next, editing);
}

export type TimelineAssignment={beginMs:number;endMs:number;fixed:boolean;minBegin:number;maxEnd:number;childBegin:number;childEnd:number};
/** Choose allocation from the raw drop, before snapping. Only real ancestors constrain it. */
export function prepareTimelineAssignment(document: LyricDocument, target: TimelineTarget, dropMs: number, durationMs: number): TimelineAssignment {
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
  const ancestorBegin=target.kind==='line'?null:target.kind==='ruby'?word!.beginMs??line.beginMs:line.beginMs;
  const ancestorEnd=target.kind==='line'?null:target.kind==='ruby'?word!.endMs??line.endMs:line.endMs;
  const internal=(ancestorBegin===null||dropMs>=ancestorBegin)&&(ancestorEnd===null||dropMs<=ancestorEnd);
  const minBegin=internal?Math.max(0,ancestorBegin??0):0, maxEnd=internal?Math.min(durationMs,ancestorEnd??durationMs):durationMs;
  const timedSiblings = siblings.filter(item=>item.id!==id && full(item)).sort((a,b)=>a.beginMs!-b.beginMs!);
  let fixed=false;
  // Immediate occupied boundaries around the drop also handle overlapping siblings.
  const inside=timedSiblings.some(item=>item.beginMs!<dropMs&&item.endMs!>dropMs);
  if(!inside){
    const left=timedSiblings.filter(item=>item.endMs!<=dropMs).reduce<number|null>((best,item)=>Math.max(best??-Infinity,item.endMs!),null);
    const right=timedSiblings.filter(item=>item.beginMs!>=dropMs).reduce<number|null>((best,item)=>Math.min(best??Infinity,item.beginMs!),null);
    const lower=internal&&ancestorBegin!==null?Math.max(left??-Infinity,ancestorBegin):left;
    const upper=internal&&ancestorEnd!==null?Math.min(right??Infinity,ancestorEnd):right;
    // Preserve the previous average-duration behavior outside ancestor bounds.
    if(lower!==null&&upper!==null&&lower<upper&&dropMs>=lower&&dropMs<=upper){beginMs=lower;endMs=upper;fixed=true;}
    else if(internal&&ancestorBegin!==null&&lower===ancestorBegin&&upper===null){beginMs=lower;endMs=beginMs+(endMs-Math.round(dropMs));fixed=true;}
    else if(internal&&ancestorEnd!==null&&upper===ancestorEnd&&lower===null){const length=endMs-beginMs;endMs=upper;beginMs=endMs-length;fixed=true;}
  }
  if(internal){beginMs=Math.max(minBegin,beginMs);endMs=Math.min(maxEnd,endMs);}
  const attachments = [...document.romanizationTracks,...document.translationTracks].flatMap(t=>t.contents.flatMap(c=>c.lineId===line.id&&c.kind==='timed'?c.units:[]));
  const children = target.kind==='line' ? [...line.words.flatMap(w=>[w,...w.rubyUnits]),...attachments] : target.kind==='word' ? word!.rubyUnits : [];
  beginMs = Math.max(0,Math.min(beginMs,...children.flatMap(c=>c.beginMs===null?[]:[c.beginMs])));
  endMs = Math.min(durationMs,Math.max(endMs,...children.flatMap(c=>c.endMs===null?[]:[c.endMs])));
  valid(beginMs,endMs);
  if (!Number.isSafeInteger(durationMs) || beginMs >= endMs || children.some(c=>c.endMs!==null&&c.endMs>durationMs)) throw new MessageError(message('timeline.rangeInvalid'));
  return {beginMs,endMs,fixed,minBegin,maxEnd,
    childBegin:Math.min(Infinity,...children.flatMap(child=>child.beginMs===null?[]:[child.beginMs])),
    childEnd:Math.max(0,...children.flatMap(child=>child.endMs===null?[]:[child.endMs]))};
}

/** Assign both endpoints without moving descendants; expand parents in the same transaction. */
export function applyTimelineAssignment(document:LyricDocument,target:TimelineTarget,assignment:TimelineAssignment,deltaMs=0,editing=createProjectEditing()):LyricDocument {
  const {beginMs:start,endMs:end,minBegin,maxEnd,childBegin,childEnd,fixed}=assignment;
  const beginMs=start+deltaMs,endMs=end+deltaMs;
  if((fixed&&deltaMs!==0)||beginMs<minBegin||endMs>maxEnd||beginMs>childBegin||endMs<childEnd||beginMs>=endMs)throw new MessageError(message('timeline.rangeInvalid'));
  valid(beginMs,endMs);
  const line=document.lines.find(line=>line.id===target.lineId)!;
  const attachments=[...document.romanizationTracks,...document.translationTracks].flatMap(t=>t.contents.flatMap(c=>c.lineId===line.id&&c.kind==='timed'?c.units:[]));
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

/** Clear only explicit targets, preserving descendant times and editing configuration. */
export function clearTimelineTimes(document: LyricDocument, targets: TimelineTarget[], editing = createProjectEditing()): LyricDocument {
  const clearedLines = new Set(targets.filter(target => target.kind === 'line').map(target => target.lineId));
  if (Object.entries(editing.endLinks).some(([source,target]) => clearedLines.has(source) || clearedLines.has(target))) throw new MessageError(message('timeline.clearLinked'));
  let next = document;
  for (const target of targets) {
    if (target.kind === 'romanization') next = editRomanization(next,target,unit => ({...unit,beginMs:null,endMs:null}));
    else next = editTarget(next,target,line => {
      if (target.kind === 'line') return {...line,beginMs:null,endMs:null};
      const index = line.words.findIndex(word => word.id === target.wordId);
      if (index < 0) throw new MessageError(message('timeline.wordMissing'));
      const words = line.words.slice(), word = words[index];
      if (target.kind === 'word') words[index] = {...word,beginMs:null,endMs:null};
      else {
        const rubyIndex = word.rubyUnits.findIndex(unit => unit.id === target.rubyId);
        if (rubyIndex < 0) throw new MessageError(message('timeline.rubyMissing'));
        const rubyUnits = word.rubyUnits.slice();
        rubyUnits[rubyIndex] = {...rubyUnits[rubyIndex],beginMs:null,endMs:null};
        words[index] = {...word,rubyUnits};
      }
      return {...line,words};
    });
  }
  return next;
}
