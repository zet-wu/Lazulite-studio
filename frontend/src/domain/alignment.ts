import type { Acoustics, ProjectDocument } from './project-document';
import { validateSegments } from './project-document';
import { validateProjectEditing } from './project-editing';
import { assertAmll } from './amll-compatibility';
import type { TimeMs } from './lyric-document';

type Endpoint = { time: number; source: string } | null;
export type AlignmentResult = {
  kind: 'alignment';
  binding: { project_id: string; revision: string; asset_id: string };
  alignment: { schema: 'lazulite-japanese-result-v1'; units: { unit_id: string; line_id: string; proposed_timing: { start: Endpoint; end: Endpoint } }[] };
  mapping: { unit_id: string; object_id: string; word_id: string; line_id: string; kind: 'word' | 'ruby' }[];
  scope: {object_id:string; word_id:string; line_id:string; kind:'word'|'ruby'; target_ids:string[]}[];
  acoustics: Acoustics | null;
};
type Pair = { beginMs: TimeMs; endMs: TimeMs };
export function mergeAlignment(project: ProjectDocument, result: AlignmentResult, durationMs: number, clearUnmatched = false, gapThresholdMs: number | null = null) {
  if (gapThresholdMs !== null && (!Number.isSafeInteger(gapThresholdMs) || gapThresholdMs <= 0)) throw new Error("行内空隙阈值必须为正的安全整数毫秒");
  if (result.alignment.schema !== 'lazulite-japanese-result-v1') throw new Error('自动对齐结果版本无效');
  const next = structuredClone(project), skipped = new Set(project.editing.skippedAlignmentLineIds);
  const units = new Map(result.alignment.units.map(unit => [unit.unit_id, unit]));
  if (units.size !== result.alignment.units.length) throw new Error('自动对齐结果包含重复标识');
  const groups = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const item of result.mapping) {
    const line = project.lyrics.lines.find(line => line.id === item.line_id);
    const word = line?.words.find(word => word.id === item.word_id);
    if (!line || !word || skipped.has(line.id) || (item.kind === 'word' ? item.object_id !== word.id : !word.rubyUnits.some(r => r.id === item.object_id)) || seen.has(item.unit_id) || units.get(item.unit_id)?.line_id !== line.id) throw new Error('对齐结果与启动歌词不匹配');
    seen.add(item.unit_id);
    groups.set(item.object_id, [...(groups.get(item.object_id) ?? []), item.unit_id]);
  }
  if (seen.size !== units.size) throw new Error('自动对齐结果映射不完整');
  const leaves = project.lyrics.lines.filter(l => !skipped.has(l.id)).flatMap(l => l.words.flatMap(w =>
    w.rubyUnits.length ? w.rubyUnits.map(r => ({object_id:r.id,word_id:w.id,line_id:l.id,kind:'ruby'})) : [{object_id:w.id,word_id:w.id,line_id:l.id,kind:'word'}]));
  const scope = new Map(result.scope.map(item => [item.object_id,item]));
  if ([...groups.keys()].some(id => !scope.has(id)) || scope.size !== result.scope.length || scope.size !== leaves.length || leaves.some(leaf => {
    const item = scope.get(leaf.object_id);
    return !item || item.word_id !== leaf.word_id || item.line_id !== leaf.line_id || item.kind !== leaf.kind
      || JSON.stringify(item.target_ids) !== JSON.stringify(groups.get(leaf.object_id) ?? []);
  })) throw new Error('对齐结果完整范围或目标映射不匹配');
  const retained: { id: string; reason: string }[] = [];
  const cleared: string[] = [];
  const adoptedComplete = new Set<string>();
  let mergedGaps = 0;
  const segments = [...(result.acoustics ?? project.acoustics).segments].sort((a,b) => a.beginMs - b.beginMs);
  function continuouslyCovered(begin: number, end: number) {
    let covered = begin;
    for (const segment of segments) {
      if (segment.endMs <= covered) continue;
      if (segment.beginMs > covered) return false;
      covered = segment.endMs;
      if (covered >= end) return true;
    }
    return false;
  }
  const endpoint = (value: Endpoint): TimeMs => value === null ? null : Math.round(value.time * 1000);
  const legal = (pair: Pair) => [pair.beginMs, pair.endMs].every(t => t === null || Number.isSafeInteger(t) && t >= 0 && t <= durationMs) && (pair.beginMs === null || pair.endMs === null || pair.beginMs < pair.endMs);
  function merge(id: string, old: Pair, proposed: Pair): Pair {
    if (!legal(proposed)) { retained.push({id, reason:'非法建议端点'}); return old; }
    if (proposed.beginMs !== null && proposed.endMs !== null) adoptedComplete.add(id);
    if (clearUnmatched) {
      if (old.beginMs !== null && proposed.beginMs === null || old.endMs !== null && proposed.endMs === null) cleared.push(id);
      return proposed;
    }
    if (proposed.beginMs === null && proposed.endMs === null) { retained.push({id, reason: '没有连续建议端点'}); return old; }
    const candidate = { beginMs: proposed.beginMs ?? old.beginMs, endMs: proposed.endMs ?? old.endMs };
    if (!legal(candidate)) { retained.push({id, reason: '量化后越界或无法合法合并旧端点'}); return old; }
    if (proposed.beginMs === null || proposed.endMs === null) retained.push({id, reason:'部分端点保留'});
    return candidate;
  }
  function adopt(id: string, old: Pair): Pair {
    const ids = groups.get(id);
    if (!ids?.length) return clearUnmatched ? merge(id,old,{beginMs:null,endMs:null}) : old;
    if (ids.some(uid => {const timing=units.get(uid)!.proposed_timing;return !legal({beginMs:endpoint(timing.start),endMs:endpoint(timing.end)});})) {
      retained.push({id,reason:'非法建议端点'}); return old;
    }
    // Missing leading/trailing units cannot be replaced by a lucky middle prediction.
    return merge(id, old, { beginMs: endpoint(units.get(ids[0])!.proposed_timing.start), endMs: endpoint(units.get(ids.at(-1)!)!.proposed_timing.end) });
  }
  function envelope(old: Pair, children: Pair[]): Pair {
    if (!children.length) return clearUnmatched ? {beginMs:null,endMs:null} : old;
    const proposed = {beginMs: children[0].beginMs, endMs: children.at(-1)!.endMs};
    // Parents do not count as retained/cleared leaf objects.
    const candidate = clearUnmatched ? proposed : {beginMs:proposed.beginMs ?? old.beginMs,endMs:proposed.endMs ?? old.endMs};
    if (!legal(candidate)) return old;
    const starts = children.flatMap(c => c.beginMs === null ? [] : [c.beginMs]);
    const ends = children.flatMap(c => c.endMs === null ? [] : [c.endMs]);
    return {beginMs: candidate.beginMs === null ? null : Math.min(candidate.beginMs, ...starts), endMs: candidate.endMs === null ? null : Math.max(candidate.endMs, ...ends)};
  }
  for (const [lineIndex, line] of next.lyrics.lines.entries()) {
    if (skipped.has(line.id)) continue;
    const before = JSON.stringify(line.words);
    const lineLeaves = line.words.flatMap<Pair & {id:string}>(word => word.rubyUnits.length ? word.rubyUnits : [word]);
    for (const leaf of lineLeaves) Object.assign(leaf, adopt(leaf.id, leaf));
    if (gapThresholdMs !== null) {
      let previous: (Pair & {id:string}) | undefined;
      for (const leaf of lineLeaves) {
        // Only authoritative omitted, finally untimed separators are transparent.
        if (!scope.get(leaf.id)!.target_ids.length && leaf.beginMs === null && leaf.endMs === null) continue;
        if (!adoptedComplete.has(leaf.id)) { previous = undefined; continue; }
        if (previous) {
          const end = previous.endMs!, start = leaf.beginMs!;
          if (0 < start - end && start - end < gapThresholdMs && continuouslyCovered(end, start)) {
            previous.endMs = start;
            mergedGaps++;
          }
        }
        previous = leaf;
      }
    }
    for (const [wordIndex, word] of line.words.entries()) {
      if (word.rubyUnits.length) {
        const original = project.lyrics.lines[lineIndex].words[wordIndex];
        if (clearUnmatched || JSON.stringify(word) !== JSON.stringify(original)) Object.assign(word, envelope(word, word.rubyUnits.filter(r => !clearUnmatched || scope.get(r.id)!.target_ids.length)));
      }
    }
    const lineChanged = JSON.stringify(line.words) !== before;
    if (clearUnmatched || lineChanged) Object.assign(line, envelope(line, line.words.filter(word => clearUnmatched ? (word.rubyUnits.length ? word.rubyUnits.some(r => scope.get(r.id)!.target_ids.length) : scope.get(word.id)!.target_ids.length) : word.text.trim() || word.rubyUnits.length)));
  }
  // Keep evaluated links only when already consistent. Never propagate into skipped rows.
  for (const [id, target] of Object.entries(next.editing.endLinks)) {
    const line = next.lyrics.lines.find(l => l.id === id)!, destination = next.lyrics.lines.find(l => l.id === target)!;
    if (line.endMs !== destination.beginMs || destination.beginMs === null) delete next.editing.endLinks[id];
  }
  if (result.acoustics) { validateSegments(result.acoustics.segments, durationMs); next.acoustics = result.acoustics; }
  validateProjectEditing(next.lyrics, next.editing); assertAmll(next.lyrics, next.amll);
  return { project: JSON.stringify(next) === JSON.stringify(project) ? project : next, retained, cleared, mergedGaps };
}
