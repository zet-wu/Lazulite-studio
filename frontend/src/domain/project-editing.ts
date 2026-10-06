import type { LyricDocument } from './lyric-document';

/** Project-only editing data. Never encoded in a lyric or a TTML node. */
export type ProjectEditing = {
  emptyBeats: Record<string, { kind: 'word' | 'ruby'; count: number }>;
  ignoredSyncLineIds: string[];
  endLinks: Record<string, string>;
};
export const createProjectEditing = (): ProjectEditing => ({ emptyBeats: {}, ignoredSyncLineIds: [], endLinks: {} });
export const emptyBeatCount = (editing: ProjectEditing, id: string) => editing.emptyBeats[id]?.count ?? 0;
export function setEmptyBeat(editing: ProjectEditing, id: string, kind: 'word' | 'ruby', count: number) {
  if (!Number.isSafeInteger(count) || count < 0 || count > 32) throw new Error('空拍数必须是 0–32 的整数');
  if (count) editing.emptyBeats[id] = { kind, count };
  else delete editing.emptyBeats[id];
}

export function validateProjectEditing(document: LyricDocument, editing: ProjectEditing) {
  if (!editing || typeof editing !== 'object' || !editing.emptyBeats || Array.isArray(editing.emptyBeats) || !Array.isArray(editing.ignoredSyncLineIds) || !editing.endLinks || Array.isArray(editing.endLinks)
    || Object.keys(editing).some(key => !['emptyBeats', 'ignoredSyncLineIds', 'endLinks'].includes(key))) throw new Error('项目编辑配置无效');
  const objects = new Map<string, 'line' | 'word' | 'ruby'>();
  const add = (id: string, kind: 'line' | 'word' | 'ruby') => { if (!id || objects.has(id)) throw new Error('歌词对象标识重复或为空'); objects.set(id, kind); };
  for (const line of document.lines) {
    add(line.id, 'line');
    if ('endLink' in line || 'ignoreSync' in line) throw new Error('旧歌词编辑字段不再支持');
    for (const word of line.words) { add(word.id, 'word'); if ('emptyBeat' in word) throw new Error('旧词空拍字段不再支持'); for (const ruby of word.rubyUnits) add(ruby.id, 'ruby'); }
  }
  for (const [id, value] of Object.entries(editing.emptyBeats)) {
    if (!value || !['word', 'ruby'].includes(value.kind) || objects.get(id) !== value.kind || !Number.isSafeInteger(value.count) || value.count < 1 || value.count > 32 || Object.keys(value).some(key => !['kind', 'count'].includes(key))) throw new Error('空拍对象、类别或数量无效');
  }
  if (new Set(editing.ignoredSyncLineIds).size !== editing.ignoredSyncLineIds.length || editing.ignoredSyncLineIds.some(id => objects.get(id) !== 'line')) throw new Error('忽略打轴的行无效');
  for (const [id, targetId] of Object.entries(editing.endLinks)) {
    const line = document.lines.find(line => line.id === id), target = document.lines.find(line => line.id === targetId);
    if (!line || !target || line === target || line.backgroundOf || target.backgroundOf || target.beginMs === null || line.endMs !== target.beginMs
      || line.beginMs !== null && line.beginMs > line.endMs! || line.words.some(word => word.endMs !== null && word.endMs > line.endMs!)) throw new Error('行尾链接对象、关系或已求值时间无效');
  }
}

/** Called within the same transaction, before commit; never an effect or save repair. */
export function reconcileEditing(before: LyricDocument, after: LyricDocument, editing: ProjectEditing) {
  const lines = new Set(after.lines.map(line => line.id));
  const words = new Map(after.lines.flatMap(line => line.words.map(word => [word.id, word] as const)));
  const rubies = new Set([...words.values()].flatMap(word => word.rubyUnits.map(unit => unit.id)));
  for (const old of before.lines.flatMap(line => line.words)) {
    const word = words.get(old.id);
    if (!word) continue;
    if (old.rubyUnits.length && word.rubyUnits.length && old.rubyUnits.every(unit => !rubies.has(unit.id)) && old.rubyUnits.some(unit => emptyBeatCount(editing, unit.id))) throw new Error('替换注音会丢失空拍归属，请先清除原注音空拍');
    if (old.rubyUnits.length === word.rubyUnits.length) continue;
    if (!old.rubyUnits.length && word.rubyUnits.length && emptyBeatCount(editing, word.id)) {
      const first = word.rubyUnits[0].id;
      if (emptyBeatCount(editing, first)) throw new Error('词与首个注音都有空拍，请先清除其中一处配置');
      setEmptyBeat(editing, first, 'ruby', emptyBeatCount(editing, word.id)); delete editing.emptyBeats[word.id];
    } else if (old.rubyUnits.length && !word.rubyUnits.length) {
      // Moving Ruby keeps its own identity and configuration at the destination.
      const removed = old.rubyUnits.filter(unit => !rubies.has(unit.id));
      const configured = removed.filter(unit => emptyBeatCount(editing, unit.id));
      if (configured.length > 1 || configured.length && (configured[0].id !== old.rubyUnits[0].id || emptyBeatCount(editing, word.id))) throw new Error('移除注音会丢失或覆盖空拍，请先调整注音空拍');
      if (configured.length) setEmptyBeat(editing, word.id, 'word', emptyBeatCount(editing, configured[0].id));
    }
  }
  for (const [id, value] of Object.entries(editing.emptyBeats)) if (!(value.kind === 'word' ? words.has(id) : rubies.has(id))) delete editing.emptyBeats[id];
  editing.ignoredSyncLineIds = editing.ignoredSyncLineIds.filter(id => lines.has(id));
  for (const [id, target] of Object.entries(editing.endLinks)) if (!lines.has(id) || !lines.has(target)) delete editing.endLinks[id];
}

export function remapEditing(source: ProjectEditing, ids: Map<string, string>): ProjectEditing {
  return {
    emptyBeats: Object.fromEntries(Object.entries(source.emptyBeats).filter(([id]) => ids.has(id)).map(([id, value]) => [ids.get(id)!, value])),
    ignoredSyncLineIds: source.ignoredSyncLineIds.filter(id => ids.has(id)).map(id => ids.get(id)!),
    endLinks: Object.fromEntries(Object.entries(source.endLinks).filter(([id, target]) => ids.has(id) && ids.has(target)).map(([id, target]) => [ids.get(id)!, ids.get(target)!])),
  };
}

export function followChangedEndLinks(before: LyricDocument, after: LyricDocument, editing: ProjectEditing): LyricDocument {
  const changedStarts = new Map(after.lines.filter(line => before.lines.find(old => old.id === line.id)?.beginMs !== line.beginMs).map(line => [line.id, line.beginMs]));
  let changed = false;
  const lines = after.lines.map(line => {
    const target = editing.endLinks[line.id];
    if (!target || !changedStarts.has(target)) return line;
    const endMs = changedStarts.get(target)!;
    if (endMs === null || line.beginMs !== null && line.beginMs > endMs || line.words.some(word => word.endMs !== null && word.endMs > endMs)) throw new Error('时间修改使行尾链接排除已有词或早于行起点');
    if (line.endMs === endMs) return line;
    changed = true; return { ...line, endMs };
  });
  return changed ? { ...after, lines } : after;
}
