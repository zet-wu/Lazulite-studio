import { message, MessageError, type Message } from './messages';
import { singerKey, initializeSingerMarkers, validateSingerMarkers, markerProblem, type SingerMarker } from './singer-markers';
import type { LyricDocument, LyricLine, LyricWord } from './lyric-document';

export type CueAnchor = { kind: 'before'; lineId: string } | { kind: 'word'; lineId: string; leftId: string; rightId: string } | { kind: 'ruby'; lineId: string; wordId: string; leftId: string; rightId: string };
export type KaraokeCue = { id: string; text: string; anchor: CueAnchor; beginMs: number; endMs: number };
export type Karaoke = {
  singerMarkers: SingerMarker[];
  sugSingerNames?: { outputId: string; agentIds: string[]; name: string }[];
  groups: { id: string; name: string }[];
  lineGroups: Record<string, string>;
  defaults: { text: string; beforeMs: number; wordMs: number; rubyMs: number };
  cues: KaraokeCue[];
  outputs: string[];
  offsets: Record<string, number>;
};
export const outputId = (groupId: string, kind = 'body', trackId = '') => JSON.stringify([groupId, kind, trackId]);
export function createKaraoke(lyrics: LyricDocument): Karaoke {
  return { singerMarkers: initializeSingerMarkers(lyrics, []), groups: [{ id: 'main', name: '主歌词' }, { id: 'background', name: '背景歌词' }], lineGroups: Object.fromEntries(lyrics.lines.map(line => [line.id, line.backgroundOf ? 'background' : 'main'])), defaults: { text: '●', beforeMs: 3000, wordMs: 500, rubyMs: 500 }, cues: [], offsets: {}, outputs: [outputId('main'), outputId('background')] };
}
export const anchorKey = (anchor: CueAnchor) => JSON.stringify(anchor.kind === 'before' ? [anchor.kind,anchor.lineId] : [anchor.kind,anchor.leftId,anchor.rightId]);
const timed = (item: { beginMs: number | null; endMs: number | null }) => item.beginMs !== null && item.endMs !== null && item.beginMs >= 0 && item.endMs > item.beginMs;
export const firstLyric = (line: LyricLine) => line.words.find(word => word.text.trim());
export function anchorRange(lyrics: LyricDocument, anchor: CueAnchor): { beginMs: number; endMs: number } | null {
  const line = lyrics.lines.find(line => line.id === anchor.lineId);
  if (!line) return null;
  if (anchor.kind === 'before') { const word = firstLyric(line); return word && timed(word) && word.beginMs! > 0 ? { beginMs: 0, endMs: word.beginMs! } : null; }
  const items = anchor.kind === 'word' ? line.words : line.words.find(word => word.id === anchor.wordId)?.rubyUnits;
  if (!items) return null;
  const index = items.findIndex(item => item.id === anchor.leftId), left = items[index], right = items[index + 1];
  if (!left || right?.id !== anchor.rightId || !timed(left) || !timed(right) || left.endMs! >= right.beginMs!) return null;
  return { beginMs: left.endMs!, endMs: right.beginMs! };
}
export function gapAnchors(line: LyricLine): CueAnchor[] {
  return line.words.flatMap((word, i) => [
    ...(i ? [{ kind: 'word' as const, lineId: line.id, leftId: line.words[i - 1].id, rightId: word.id }] : []),
    ...word.rubyUnits.slice(1).map((unit, j) => ({ kind: 'ruby' as const, lineId: line.id, wordId: word.id, leftId: word.rubyUnits[j].id, rightId: unit.id })),
  ]);
}
export function cueProblem(lyrics: LyricDocument, karaoke: Karaoke, cue: KaraokeCue): string | null {
  const range = anchorRange(lyrics, cue.anchor);
  if (!range) return 'karaoke.anchorGap';
  if (!cue.text.length) return 'karaoke.emptyText';
  if (!Number.isSafeInteger(cue.beginMs) || !Number.isSafeInteger(cue.endMs) || cue.beginMs < range.beginMs || cue.endMs > range.endMs || cue.endMs <= cue.beginMs) return 'karaoke.interval';
  if (karaoke.cues.some(other => other.id !== cue.id && anchorKey(other.anchor) === anchorKey(cue.anchor) && (cue.anchor.kind !== 'before' || other.beginMs < cue.endMs && other.endMs > cue.beginMs))) return 'karaoke.overlap';
  return null;
}
export function insertCue(lyrics: LyricDocument, karaoke: Karaoke, anchor: CueAnchor): Karaoke {
  const range = anchorRange(lyrics, anchor);
  if (!range) throw new MessageError(message('karaoke.noGap'));
  if (anchor.kind !== 'before' && karaoke.cues.some(cue => anchorKey(cue.anchor) === anchorKey(anchor))) return karaoke;
  let { beginMs, endMs } = range;
  if (anchor.kind === 'before') {
    endMs = Math.min(endMs, ...karaoke.cues.filter(cue => anchorKey(cue.anchor) === anchorKey(anchor)).map(cue => cue.beginMs));
    beginMs = Math.max(0, endMs - 1000);
    if (endMs <= beginMs) throw new MessageError(message('karaoke.noIntro'));
  }
  return { ...karaoke, cues: [...karaoke.cues, { id: crypto.randomUUID(), text: karaoke.defaults.text, anchor, beginMs, endMs }] };
}
export function autoInsertCues(lyrics: LyricDocument, karaoke: Karaoke, groupIds = karaoke.groups.map(group => group.id)): Karaoke {
  const validGroups = new Set(karaoke.groups.map(group => group.id));
  if (!groupIds.length || groupIds.some(id => !validGroups.has(id))) throw new MessageError(message('karaoke.chooseGroups'));
  const targetGroups = new Set(groupIds);
  const existingCueKeys = new Set(karaoke.cues.map(cue => anchorKey(cue.anchor)));
  const groupPeers = new Map<string, { lineId: string; firstBegin: number; maxEnd: number | null }[]>();
  const unknownBeforeLine = new Set<string>();
  const unknownSeenInGroup = new Set<string>();
  for (const line of lyrics.lines) {
    const group = karaoke.lineGroups[line.id];
    if (!group || !targetGroups.has(group)) continue;
    if (unknownSeenInGroup.has(group)) unknownBeforeLine.add(line.id);
    let hasUntimed = false;
    let maxEnd: number | null = 0;
    for (const word of line.words) {
      if (!word.text.trim()) continue;
      if (!timed(word)) { hasUntimed = true; maxEnd = null; }
      else if (maxEnd !== null) maxEnd = Math.max(maxEnd, word.endMs!);
    }
    if (hasUntimed) unknownSeenInGroup.add(group);
    const first = firstLyric(line);
    if (first && timed(first)) {
      let list = groupPeers.get(group);
      if (!list) { list = []; groupPeers.set(group, list); }
      list.push({ lineId: line.id, firstBegin: first.beginMs!, maxEnd });
    }
  }
  const groupMaxBefore = new Map<string, { starts: number[]; prefixEnds: (number | null)[] }>();
  for (const [group, list] of groupPeers) {
    list.sort((a, b) => a.firstBegin - b.firstBegin);
    const starts: number[] = [];
    const prefixEnds: (number | null)[] = [];
    let running: number | null = 0;
    for (const item of list) {
      running = running === null || item.maxEnd === null ? null : Math.max(running, item.maxEnd);
      starts.push(item.firstBegin);
      prefixEnds.push(running);
    }
    groupMaxBefore.set(group, { starts, prefixEnds });
  }
  const precedingEnd = (group: string, beginMs: number): number | null => {
    const entry = groupMaxBefore.get(group);
    if (!entry) return 0;
    const { starts, prefixEnds } = entry;
    let lo = 0, hi = starts.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (starts[mid] < beginMs) lo = mid + 1; else hi = mid; }
    return lo === 0 ? 0 : prefixEnds[lo - 1];
  };
  let next = karaoke;
  for (const line of lyrics.lines) {
    const group = karaoke.lineGroups[line.id], first = firstLyric(line);
    if (!targetGroups.has(group)) continue;
    if (group && first && timed(first)) {
      const preceding = unknownBeforeLine.has(line.id) ? null : precedingEnd(group, first.beginMs!);
      const anchor: CueAnchor = { kind: 'before', lineId: line.id };
      if (preceding !== null && first.beginMs! - preceding > karaoke.defaults.beforeMs && !existingCueKeys.has(anchorKey(anchor))) {
        next = insertCue(lyrics, next, anchor);
        existingCueKeys.add(anchorKey(anchor));
      }
    }
    for (const anchor of gapAnchors(line)) {
      const range = anchorRange(lyrics, anchor);
      if (range && range.endMs - range.beginMs > karaoke.defaults[anchor.kind === 'ruby' ? 'rubyMs' : 'wordMs']) next = insertCue(lyrics, next, anchor);
    }
  }
  return next;
}
/** Structural edits update identity ownership only. Retiming never moves a cue. */
export function reconcileKaraoke(lyrics: LyricDocument, karaoke: Karaoke, previous?: LyricDocument): Karaoke {
  const groupIds = new Set(karaoke.groups.map(group => group.id));
  const prevById = previous ? new Map(previous.lines.map(item => [item.id, item])) : null;
  const hasMainAndBg = groupIds.has('main') && groupIds.has('background');
  const lineGroups = Object.fromEntries(lyrics.lines.map(line => {
    const target = line.backgroundOf ? 'background' : 'main';
    let group = karaoke.lineGroups[line.id] ?? (groupIds.has(target) ? target : '');
    const old = prevById?.get(line.id);
    if (old && !!old.backgroundOf !== !!line.backgroundOf && hasMainAndBg && group === (old.backgroundOf ? 'background' : 'main')) group = target;
    return [line.id, group];
  }));
  const lineIds = new Set<string>();
  const wordPairs = new Map<string, string>();
  const rubyPairs = new Map<string, { lineId: string; wordId: string }>();
  for (const line of lyrics.lines) {
    lineIds.add(line.id);
    for (let i = 0; i < line.words.length; i++) {
      const word = line.words[i];
      if (i + 1 < line.words.length) wordPairs.set(`${word.id}\0${line.words[i + 1].id}`, line.id);
      for (let j = 0; j < word.rubyUnits.length - 1; j++) {
        rubyPairs.set(`${word.rubyUnits[j].id}\0${word.rubyUnits[j + 1].id}`, { lineId: line.id, wordId: word.id });
      }
    }
  }
  const cues = karaoke.cues.flatMap(cue => {
    const anchor = cue.anchor;
    if (anchor.kind === 'before') return lineIds.has(anchor.lineId) ? [cue] : [];
    if (anchor.kind === 'word') {
      const lineId = wordPairs.get(`${anchor.leftId}\0${anchor.rightId}`);
      return lineId !== undefined ? [{ ...cue, anchor: { ...anchor, lineId } }] : [];
    }
    const owner = rubyPairs.get(`${anchor.leftId}\0${anchor.rightId}`);
    return owner ? [{ ...cue, anchor: { ...anchor, lineId: owner.lineId, wordId: owner.wordId } }] : [];
  });
  const translationTrackIds = new Set(lyrics.translationTracks.map(track => track.id));
  const romanizationTrackIds = new Set(lyrics.romanizationTracks.map(track => track.id));
  const agentIds = new Set(lyrics.agents.map(agent => agent.id));
  const validOutput = (id: string) => {
    const [groupId, kind, trackId] = JSON.parse(id);
    return groupIds.has(groupId) && (kind === 'body' || (kind === 'translation' ? translationTrackIds : romanizationTrackIds).has(trackId));
  };
  return { ...karaoke, ...(karaoke.sugSingerNames ? { sugSingerNames: karaoke.sugSingerNames.filter(item => validOutput(item.outputId) && item.agentIds.every(id => agentIds.has(id))) } : {}), offsets: Object.fromEntries(Object.entries(karaoke.offsets).filter(([id])=>validOutput(id))), outputs: karaoke.outputs.filter(validOutput), lineGroups, cues, singerMarkers: initializeSingerMarkers(lyrics, karaoke.singerMarkers) };
}
export function nextGroupId(groups: Karaoke['groups']): string {
  const used = new Set(groups.map(group => group.id.trim().toLowerCase()));
  let n = 1; while (used.has(`group${n}`)) n++;
  return `group${n}`;
}
export function groupIdProblem(original: Karaoke['groups'], groups: Karaoke['groups'], renames: Record<string, string>): Message | null {
  const used = new Set<string>();
  for (const [index, group] of groups.entries()) {
    const id = group.id.trim();
    const unchanged = original.some(old => old.id === id && renames[old.id] === id);
    if (!id || !unchanged && !/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) return message('karaoke.groupInvalid',{number:index+1});
    if (used.has(id.toLowerCase())) return message('karaoke.groupDuplicate',{number:index+1});
    used.add(id.toLowerCase());
  }
  return null;
}
export type KaraokeCommand = { kind: 'sug-singer-names'; names: NonNullable<Karaoke['sugSingerNames']> } | { kind: 'remove-lines'; lineIds: string[] } | { kind: 'singer-markers'; markers: SingerMarker[] } | { kind: 'insert'; anchor: CueAnchor } | { kind: 'auto'; groupIds: string[]; thresholds: Pick<Karaoke['defaults'], 'beforeMs' | 'wordMs' | 'rubyMs'> } | { kind: 'cue'; id: string; text: string; beginMs: number; endMs: number } | { kind: 'remove'; id: string } | { kind: 'assign'; lineIds: string[]; groupId: string } | { kind: 'settings'; defaults: Karaoke['defaults'] } | { kind: 'groups'; groups: Karaoke['groups']; renames: Record<string, string> } | { kind: 'outputs'; outputs: string[] } | { kind: 'offsets'; offsets: Record<string, number> };
export function applyKaraoke(lyrics: LyricDocument, karaoke: Karaoke, command: KaraokeCommand): Karaoke {
  let next = karaoke;
  switch (command.kind) {
    case 'sug-singer-names': next = { ...karaoke, sugSingerNames: command.names }; break;
    case 'singer-markers': {
      for (const marker of command.markers) { const problem=markerProblem(marker); if(problem)throw new MessageError(message(problem)); }
      next = { ...karaoke, singerMarkers: command.markers }; break;
    }
    case 'insert': next = insertCue(lyrics, karaoke, command.anchor); break;
    case 'auto': {
      const configured = { ...karaoke, defaults: { ...karaoke.defaults, ...command.thresholds } };
      next = autoInsertCues(lyrics, configured, command.groupIds); break;
    }
    case 'remove-lines':
      if (command.lineIds.some(id => !lyrics.lines.some(line => line.id === id))) throw new MessageError(message('karaoke.lineStale'));
      next = { ...karaoke, cues: karaoke.cues.filter(cue => !command.lineIds.includes(cue.anchor.lineId)) }; break;
    case 'remove': next = { ...karaoke, cues: karaoke.cues.filter(cue => cue.id !== command.id) }; break;
    case 'cue': {
      const old = karaoke.cues.find(cue => cue.id === command.id);
      if (!old) throw new MessageError(message('karaoke.cueDeleted'));
      const cue = { ...old, text: command.text, beginMs: command.beginMs, endMs: command.endMs };
      const problem = cueProblem(lyrics, karaoke, cue);
      if (problem) throw new MessageError(message(problem));
      next = { ...karaoke, cues: karaoke.cues.map(item => item.id === cue.id ? cue : item) }; break;
    }
    case 'assign':
      if (command.groupId !== '' && !karaoke.groups.some(group => group.id === command.groupId) || command.lineIds.some(id => !lyrics.lines.some(line => line.id === id))) throw new MessageError(message('karaoke.groupOrLineStale'));
      next = { ...karaoke, lineGroups: { ...karaoke.lineGroups, ...Object.fromEntries(command.lineIds.map(id => [id, command.groupId])) } }; break;
    case 'settings': next = { ...karaoke, defaults: command.defaults }; break;
    case 'offsets': next = { ...karaoke, offsets: { ...karaoke.offsets, ...command.offsets } }; break;
    case 'outputs': next = { ...karaoke, outputs: command.outputs }; break;
    case 'groups': {
      const groups = command.groups.map(group => ({ ...group, id: group.id.trim() }));
      const problem = groupIdProblem(karaoke.groups, groups, command.renames);
      if (problem) throw new MessageError(problem);
      const resolve = (id: string) => {
        const renamed = command.renames[id];
        return renamed !== undefined && groups.some(group => group.id === renamed) ? renamed : '';
      };
      const lineGroups = Object.fromEntries(Object.entries(karaoke.lineGroups).map(([lineId, groupId]) => [lineId, resolve(groupId)]));
      const outputs = karaoke.outputs.flatMap(id => {
        const [groupId, kind, trackId] = JSON.parse(id), target = resolve(groupId);
        return target ? [outputId(target, kind, trackId)] : [];
      });
      const offsets = Object.fromEntries(Object.entries(karaoke.offsets).flatMap(([id, value]) => {
        const [groupId, kind, trackId] = JSON.parse(id), target = resolve(groupId);
        return target ? [[outputId(target, kind, trackId), value]] : [];
      }));
      const sugSingerNames = karaoke.sugSingerNames?.flatMap(item => {
        const [groupId, kind, trackId] = JSON.parse(item.outputId), target = resolve(groupId);
        return target ? [{ ...item, outputId: outputId(target, kind, trackId) }] : [];
      });
      next = { ...karaoke, groups, lineGroups, outputs, offsets, ...(sugSingerNames ? { sugSingerNames } : {}) }; break;
    }
  }
  validateKaraoke(lyrics, next);
  return JSON.stringify(next) === JSON.stringify(karaoke) ? karaoke : next;
}
/** Shape validation at persistence boundaries; editable timing issues belong to output validation. */
export function validateKaraoke(lyrics: LyricDocument, value: Karaoke) {
  if (!value || !Array.isArray(value.groups) || !Array.isArray(value.cues) || !value.lineGroups || !value.defaults || !Array.isArray(value.outputs)) throw new MessageError(message('karaoke.dataInvalid'));
  validateSingerMarkers(value.singerMarkers);
  if (value.sugSingerNames !== undefined) {
    if (!Array.isArray(value.sugSingerNames)) throw new MessageError(message('karaoke.dataInvalid'));
    const keys = new Set<string>();
    for (const item of value.sugSingerNames) {
      if (!item || typeof item.outputId !== 'string' || !Array.isArray(item.agentIds) || item.agentIds.some(id => typeof id !== 'string' || !id) || new Set(item.agentIds).size !== item.agentIds.length || typeof item.name !== 'string' || !item.name.length) throw new MessageError(message('karaoke.dataInvalid'));
      const key = JSON.stringify([item.outputId, singerKey(item.agentIds)]);
      if (keys.has(key)) throw new MessageError(message('karaoke.dataInvalid'));
      keys.add(key);
    }
  }
  const ids = new Set<string>();
  for (const group of value.groups) { if (typeof group.id !== 'string' || !group.id || ids.has(group.id) || typeof group.name !== 'string' || !group.name.trim()) throw new MessageError(message('karaoke.groupInvalidData')); ids.add(group.id); }
  if (typeof value.defaults.text !== 'string' || !value.defaults.text.length || [value.defaults.beforeMs, value.defaults.wordMs, value.defaults.rubyMs].some(n => !Number.isSafeInteger(n) || n < 0)) throw new MessageError(message('karaoke.defaultsInvalid'));
  const lineIds = new Set(lyrics.lines.map(line => line.id));
  if (Object.entries(value.lineGroups).some(([id, group]) => !lineIds.has(id) || typeof group !== 'string')) throw new MessageError(message('karaoke.groupReference'));
  ids.clear();
  for (const cue of value.cues) {
    if (typeof cue.id !== 'string' || !cue.id || ids.has(cue.id) || typeof cue.text !== 'string' || !Number.isSafeInteger(cue.beginMs) || !Number.isSafeInteger(cue.endMs) || !cue.anchor || !['before', 'word', 'ruby'].includes(cue.anchor.kind) || typeof cue.anchor.lineId !== 'string' || cue.anchor.kind !== 'before' && (typeof cue.anchor.leftId !== 'string' || typeof cue.anchor.rightId !== 'string') || cue.anchor.kind === 'ruby' && typeof cue.anchor.wordId !== 'string') throw new MessageError(message('karaoke.cueData'));
    ids.add(cue.id);
  }
  if (!value.offsets || typeof value.offsets!=='object' || Array.isArray(value.offsets) || Object.values(value.offsets).some(offset=>!Number.isSafeInteger(offset))) throw new MessageError(message('karaoke.offsetInvalid'));
  if ([...value.outputs,...Object.keys(value.offsets),...(value.sugSingerNames ?? []).map(item => item.outputId)].some(id => { if (typeof id !== 'string') return true; try { const parts = JSON.parse(id); return !Array.isArray(parts) || parts.length !== 3 || parts.some(p => typeof p !== 'string') || !['body', 'translation', 'romanization'].includes(parts[1]); } catch { return true; } })) throw new MessageError(message('karaoke.outputsInvalid'));
}
export function cueWord(lyrics: LyricDocument, cue: KaraokeCue): LyricWord | undefined {
  const line = lyrics.lines.find(line => line.id === cue.anchor.lineId);
  return cue.anchor.kind === 'before' ? line && firstLyric(line) : line?.words.find(word => word.id === (cue.anchor.kind === 'ruby' ? cue.anchor.wordId : cue.anchor.kind === 'word' ? cue.anchor.rightId : ''));
}
