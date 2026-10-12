import { initializeSingerMarkers, validateSingerMarkers, markerProblem, type SingerMarker } from './singer-markers';
import type { LyricDocument, LyricLine, LyricWord } from './lyric-document';

export type CueAnchor = { kind: 'before'; lineId: string } | { kind: 'word'; lineId: string; leftId: string; rightId: string } | { kind: 'ruby'; lineId: string; wordId: string; leftId: string; rightId: string };
export type KaraokeCue = { id: string; text: string; anchor: CueAnchor; beginMs: number; endMs: number };
export type Karaoke = {
  singerMarkers: SingerMarker[];
  groups: { id: string; name: string }[];
  lineGroups: Record<string, string>;
  defaults: { text: string; beforeMs: number; wordMs: number; rubyMs: number };
  cues: KaraokeCue[];
  outputs: string[];
};
export const outputId = (groupId: string, kind = 'body', trackId = '') => JSON.stringify([groupId, kind, trackId]);
export function createKaraoke(lyrics: LyricDocument): Karaoke {
  return { singerMarkers: initializeSingerMarkers(lyrics, []), groups: [{ id: 'main', name: '主歌词' }, { id: 'background', name: '背景歌词' }], lineGroups: Object.fromEntries(lyrics.lines.map(line => [line.id, line.backgroundOf ? 'background' : 'main'])), defaults: { text: '●', beforeMs: 3000, wordMs: 500, rubyMs: 500 }, cues: [], outputs: [outputId('main'), outputId('background')] };
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
  if (!range) return '导唱锚点已无合法正空隙，请调整源时间或删除导唱';
  if (!cue.text.length) return '导唱文字不能为空';
  if (!Number.isSafeInteger(cue.beginMs) || !Number.isSafeInteger(cue.endMs) || cue.beginMs < range.beginMs || cue.endMs > range.endMs || cue.endMs <= cue.beginMs) return '导唱双端必须位于原空隙内且具有正时长';
  if (karaoke.cues.some(other => other.id !== cue.id && anchorKey(other.anchor) === anchorKey(cue.anchor) && (cue.anchor.kind !== 'before' || other.beginMs < cue.endMs && other.endMs > cue.beginMs))) return '同一位置的导唱不能重复或重叠';
  return null;
}
export function insertCue(lyrics: LyricDocument, karaoke: Karaoke, anchor: CueAnchor): Karaoke {
  const range = anchorRange(lyrics, anchor);
  if (!range) throw new Error('此处没有可插入导唱的正空隙');
  if (anchor.kind !== 'before' && karaoke.cues.some(cue => anchorKey(cue.anchor) === anchorKey(anchor))) return karaoke;
  let { beginMs, endMs } = range;
  if (anchor.kind === 'before') {
    endMs = Math.min(endMs, ...karaoke.cues.filter(cue => anchorKey(cue.anchor) === anchorKey(anchor)).map(cue => cue.beginMs));
    beginMs = Math.max(0, endMs - 1000);
    if (endMs <= beginMs) throw new Error('曲头已无可用时长');
  }
  return { ...karaoke, cues: [...karaoke.cues, { id: crypto.randomUUID(), text: karaoke.defaults.text, anchor, beginMs, endMs }] };
}
export function autoInsertCues(lyrics: LyricDocument, karaoke: Karaoke, groupIds = karaoke.groups.map(group => group.id)): Karaoke {
  if (!groupIds.length || groupIds.some(id => !karaoke.groups.some(group => group.id === id))) throw new Error('请选择有效的目标分组');
  let next = karaoke;
  for (const line of lyrics.lines) {
    const group = karaoke.lineGroups[line.id], first = firstLyric(line);
    if (!groupIds.includes(group)) continue;
    if (group && first && timed(first)) {
      const peers = lyrics.lines.filter(other => other.id !== line.id && karaoke.lineGroups[other.id] === group && firstLyric(other)?.beginMs !== null && firstLyric(other)?.beginMs! < first.beginMs!);
      const ends = peers.flatMap(other => other.words.filter(word => word.text.trim()).map(word => timed(word) ? word.endMs! : null));
      const unknownBefore=lyrics.lines.slice(0,lyrics.lines.indexOf(line)).some(other=>karaoke.lineGroups[other.id]===group&&other.words.some(word=>word.text.trim()&&!timed(word)));
      const preceding = unknownBefore || ends.includes(null) ? null : Math.max(0, ...ends as number[]);
      const anchor: CueAnchor = { kind: 'before', lineId: line.id };
      if (preceding !== null && first.beginMs! - preceding > karaoke.defaults.beforeMs && !next.cues.some(cue => anchorKey(cue.anchor) === anchorKey(anchor))) next = insertCue(lyrics, next, anchor);
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
  const standard = (id: string) => karaoke.groups.some(group => group.id === id);
  const lineGroups = Object.fromEntries(lyrics.lines.map(line => {
    const target = line.backgroundOf ? 'background' : 'main';
    let group = karaoke.lineGroups[line.id] ?? (standard(target) ? target : '');
    const old = previous?.lines.find(item => item.id === line.id);
    if (old && !!old.backgroundOf !== !!line.backgroundOf && standard('main') && standard('background') && group === (old.backgroundOf ? 'background' : 'main')) group = target;
    return [line.id, group];
  }));
  const cues = karaoke.cues.flatMap(cue => {
    const anchor = cue.anchor;
    if (anchor.kind === 'before') return lyrics.lines.some(line => line.id === anchor.lineId) ? [cue] : [];
    for (const line of lyrics.lines) {
      if (anchor.kind === 'word') {
        const index = line.words.findIndex(word => word.id === anchor.leftId);
        if (index >= 0 && line.words[index + 1]?.id === anchor.rightId) return [{ ...cue, anchor: { ...anchor, lineId: line.id } }];
      } else for (const word of line.words) {
        const index = word.rubyUnits.findIndex(unit => unit.id === anchor.leftId);
        if (index >= 0 && word.rubyUnits[index + 1]?.id === anchor.rightId) return [{ ...cue, anchor: { ...anchor, lineId: line.id, wordId: word.id } }];
      }
    }
    return [];
  });
  return { ...karaoke, lineGroups, cues, singerMarkers: initializeSingerMarkers(lyrics, karaoke.singerMarkers) };
}
export function nextGroupId(groups: Karaoke['groups']): string {
  const used = new Set(groups.map(group => group.id.trim().toLowerCase()));
  let n = 1; while (used.has(`group${n}`)) n++;
  return `group${n}`;
}
export function groupIdProblem(original: Karaoke['groups'], groups: Karaoke['groups'], renames: Record<string, string>): string | null {
  const used = new Set<string>();
  for (const [index, group] of groups.entries()) {
    const id = group.id.trim();
    const unchanged = original.some(old => old.id === id && renames[old.id] === id);
    if (!id || !unchanged && !/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) return `第 ${index + 1} 组 ID 须以英文字母开头，后接字母、数字、下划线或连字符`;
    if (used.has(id.toLowerCase())) return `第 ${index + 1} 组 ID 重复（不区分大小写）`;
    used.add(id.toLowerCase());
  }
  return null;
}
export type KaraokeCommand = { kind: 'remove-lines'; lineIds: string[] } | { kind: 'singer-markers'; markers: SingerMarker[] } | { kind: 'insert'; anchor: CueAnchor } | { kind: 'auto'; groupIds: string[]; thresholds: Pick<Karaoke['defaults'], 'beforeMs' | 'wordMs' | 'rubyMs'> } | { kind: 'cue'; id: string; text: string; beginMs: number; endMs: number } | { kind: 'remove'; id: string } | { kind: 'assign'; lineIds: string[]; groupId: string } | { kind: 'settings'; defaults: Karaoke['defaults'] } | { kind: 'groups'; groups: Karaoke['groups']; renames: Record<string, string> } | { kind: 'outputs'; outputs: string[] };
export function applyKaraoke(lyrics: LyricDocument, karaoke: Karaoke, command: KaraokeCommand): Karaoke {
  let next = karaoke;
  switch (command.kind) {
    case 'singer-markers': {
      validateSingerMarkers(command.markers);
      for (const marker of command.markers) { const problem=markerProblem(marker); if(problem)throw new Error(problem); }
      next = { ...karaoke, singerMarkers: command.markers }; break;
    }
    case 'insert': next = insertCue(lyrics, karaoke, command.anchor); break;
    case 'auto': {
      const configured = { ...karaoke, defaults: { ...karaoke.defaults, ...command.thresholds } };
      validateKaraoke(lyrics, configured);
      next = autoInsertCues(lyrics, configured, command.groupIds); break;
    }
    case 'remove-lines':
      if (command.lineIds.some(id => !lyrics.lines.some(line => line.id === id))) throw new Error('歌词行已失效');
      next = { ...karaoke, cues: karaoke.cues.filter(cue => !command.lineIds.includes(cue.anchor.lineId)) }; break;
    case 'remove': next = { ...karaoke, cues: karaoke.cues.filter(cue => cue.id !== command.id) }; break;
    case 'cue': {
      const old = karaoke.cues.find(cue => cue.id === command.id);
      if (!old) throw new Error('导唱已删除');
      const cue = { ...old, text: command.text, beginMs: command.beginMs, endMs: command.endMs };
      const problem = cueProblem(lyrics, karaoke, cue);
      if (problem) throw new Error(problem);
      next = { ...karaoke, cues: karaoke.cues.map(item => item.id === cue.id ? cue : item) }; break;
    }
    case 'assign':
      if (command.groupId !== '' && !karaoke.groups.some(group => group.id === command.groupId) || command.lineIds.some(id => !lyrics.lines.some(line => line.id === id))) throw new Error('分组或歌词行已失效');
      next = { ...karaoke, lineGroups: { ...karaoke.lineGroups, ...Object.fromEntries(command.lineIds.map(id => [id, command.groupId])) } }; break;
    case 'settings': next = { ...karaoke, defaults: command.defaults }; break;
    case 'outputs': next = { ...karaoke, outputs: command.outputs }; break;
    case 'groups': {
      const groups = command.groups.map(group => ({ ...group, id: group.id.trim() }));
      const problem = groupIdProblem(karaoke.groups, groups, command.renames);
      if (problem) throw new Error(problem);
      const resolve = (id: string) => {
        const renamed = command.renames[id];
        return renamed !== undefined && groups.some(group => group.id === renamed) ? renamed : '';
      };
      const lineGroups = Object.fromEntries(Object.entries(karaoke.lineGroups).map(([lineId, groupId]) => [lineId, resolve(groupId)]));
      const outputs = karaoke.outputs.flatMap(id => {
        const [groupId, kind, trackId] = JSON.parse(id), target = resolve(groupId);
        return target ? [outputId(target, kind, trackId)] : [];
      });
      next = { ...karaoke, groups, lineGroups, outputs }; break;
    }
  }
  validateKaraoke(lyrics, next);
  return JSON.stringify(next) === JSON.stringify(karaoke) ? karaoke : next;
}
/** Shape validation at persistence boundaries; editable timing issues belong to output validation. */
export function validateKaraoke(lyrics: LyricDocument, value: Karaoke) {
  if (!value || !Array.isArray(value.groups) || !Array.isArray(value.cues) || !value.lineGroups || !value.defaults || !Array.isArray(value.outputs)) throw new Error('卡拉 OK 项目数据无效');
  validateSingerMarkers(value.singerMarkers);
  const ids = new Set<string>();
  for (const group of value.groups) { if (typeof group.id !== 'string' || !group.id || ids.has(group.id) || typeof group.name !== 'string' || !group.name.trim()) throw new Error('分组名称或标识无效'); ids.add(group.id); }
  if (typeof value.defaults.text !== 'string' || !value.defaults.text.length || [value.defaults.beforeMs, value.defaults.wordMs, value.defaults.rubyMs].some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error('导唱默认文字或阈值无效');
  if (Object.entries(value.lineGroups).some(([id, group]) => !lyrics.lines.some(line => line.id === id) || typeof group !== 'string')) throw new Error('歌词分组引用无效');
  ids.clear();
  for (const cue of value.cues) {
    if (typeof cue.id !== 'string' || !cue.id || ids.has(cue.id) || typeof cue.text !== 'string' || !Number.isSafeInteger(cue.beginMs) || !Number.isSafeInteger(cue.endMs) || !cue.anchor || !['before', 'word', 'ruby'].includes(cue.anchor.kind) || typeof cue.anchor.lineId !== 'string' || cue.anchor.kind !== 'before' && (typeof cue.anchor.leftId !== 'string' || typeof cue.anchor.rightId !== 'string') || cue.anchor.kind === 'ruby' && typeof cue.anchor.wordId !== 'string') throw new Error('导唱数据无效');
    ids.add(cue.id);
  }
  if (value.outputs.some(id => { if (typeof id !== 'string') return true; try { const parts = JSON.parse(id); return !Array.isArray(parts) || parts.length !== 3 || parts.some(p => typeof p !== 'string') || !['body', 'translation', 'romanization'].includes(parts[1]); } catch { return true; } })) throw new Error('输出选择无效');
}
export function cueWord(lyrics: LyricDocument, cue: KaraokeCue): LyricWord | undefined {
  const line = lyrics.lines.find(line => line.id === cue.anchor.lineId);
  return cue.anchor.kind === 'before' ? line && firstLyric(line) : line?.words.find(word => word.id === (cue.anchor.kind === 'ruby' ? cue.anchor.wordId : cue.anchor.kind === 'word' ? cue.anchor.rightId : ''));
}
