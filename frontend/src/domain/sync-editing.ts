import type { LyricDocument, LyricLine, LyricWord, RubyUnit } from './lyric-document';

export type SyncCursor = { lineId: string; wordId: string; rubyUnitId: string | null };
export type SyncMode = 'continuous' | 'line';
export type SyncAction = 'start' | 'next' | 'end';

export function syncUnits(document: LyricDocument): SyncCursor[] {
  return document.lines.filter((line) => !line.backgroundOf && !line.ignoreSync).flatMap((line) =>
    line.words.flatMap((word): SyncCursor[] => word.rubyUnits.length
      ? word.rubyUnits.map((unit) => ({ lineId: line.id, wordId: word.id, rubyUnitId: unit.id }))
      : [{ lineId: line.id, wordId: word.id, rubyUnitId: null }]));
}

export function syncIndex(units: SyncCursor[], cursor: SyncCursor | null): number {
  return cursor ? units.findIndex((unit) => unit.lineId === cursor.lineId && unit.wordId === cursor.wordId && unit.rubyUnitId === cursor.rubyUnitId) : -1;
}

function assign(word: LyricWord, rubyUnitId: string | null, side: 'beginMs' | 'endMs', timeMs: number): LyricWord {
  if (word.alignmentUnits.length) throw new Error('带对齐结果的词需要先处理对齐时间');
  if (!rubyUnitId) {
    const other = side === 'beginMs' ? 'endMs' : 'beginMs';
    return { ...word, [side]: timeMs, [other]: word[other] !== null && (side === 'beginMs' ? word[other] < timeMs : word[other] > timeMs) ? null : word[other] };
  }
  const index = word.rubyUnits.findIndex((unit) => unit.id === rubyUnitId);
  if (index < 0) throw new Error('打轴 注音 单元已不存在');
  const rubyUnits = word.rubyUnits.slice();
  const unit = rubyUnits[index];
  const other = side === 'beginMs' ? 'endMs' : 'beginMs';
  rubyUnits[index] = { ...unit, [side]: timeMs, [other]: unit[other] !== null && (side === 'beginMs' ? unit[other] < timeMs : unit[other] > timeMs) ? null : unit[other] } as RubyUnit;
  const starts = rubyUnits.map((item) => item.beginMs).filter((value): value is number => value !== null);
  const ends = rubyUnits.map((item) => item.endMs).filter((value): value is number => value !== null);
  return { ...word, rubyUnits, beginMs: starts.length ? Math.min(...starts) : null, endMs: ends.length ? Math.max(...ends) : null };
}

function updateUnit(line: LyricLine, cursor: SyncCursor, side: 'beginMs' | 'endMs', timeMs: number): LyricLine {
  const index = line.words.findIndex((word) => word.id === cursor.wordId);
  if (index < 0) throw new Error('打轴词已不存在');
  const words = line.words.slice();
  words[index] = assign(words[index], cursor.rubyUnitId, side, timeMs);
  const starts = words.map((word) => word.beginMs).filter((value): value is number => value !== null);
  const ends = words.map((word) => word.endMs).filter((value): value is number => value !== null);
  const beginMs = starts.length ? Math.min(...starts, ...(line.beginMs === null ? [] : [line.beginMs])) : line.beginMs;
  const endMs = ends.length ? Math.max(...ends, ...(line.endMs === null ? [] : [line.endMs])) : line.endMs;
  return { ...line, words, beginMs, endMs, endLink: endMs === line.endMs ? line.endLink : null };
}

export function stampSync(document: LyricDocument, cursor: SyncCursor, action: SyncAction, timeMs: number, mode: SyncMode = 'continuous'): LyricDocument {
  if (!Number.isSafeInteger(timeMs) || timeMs < 0) throw new Error('打轴时间必须是非负整数毫秒');
  const units = syncUnits(document);
  const index = syncIndex(units, cursor);
  if (index < 0) throw new Error('打轴游标已失效');
  const current = units[index];
  const successor = units[index + 1];
  const next = action === 'next' && (mode === 'continuous' || successor?.lineId === current.lineId) ? successor : null;
  const changes = new Map<string, LyricLine>();
  const read = (id: string) => changes.get(id) ?? document.lines.find((line) => line.id === id)!;
  if (action === 'start') changes.set(current.lineId, updateUnit(read(current.lineId), current, 'beginMs', timeMs));
  else {
    const original = read(current.lineId).words.find((word) => word.id === current.wordId)!;
    const begin = current.rubyUnitId ? original.rubyUnits.find((unit) => unit.id === current.rubyUnitId)!.beginMs : original.beginMs;
    if (begin === null) throw new Error('请先为当前单元打起始轴');
    if (timeMs < begin) throw new Error('结束轴不能早于起始轴');
    changes.set(current.lineId, updateUnit(read(current.lineId), current, 'endMs', timeMs));
    if (next) changes.set(next.lineId, updateUnit(read(next.lineId), next, 'beginMs', timeMs));
  }
  const lines = document.lines.map((line) => changes.get(line.id) ?? line);
  // A linked end follows the target start, but never excludes the source words.
  // Validate the whole result before exposing the single timing transaction.
  return { ...document, lines: lines.map(line => {
    if (!line.endLink || !changes.has(line.endLink.targetLineId)) return line;
    const target = changes.get(line.endLink.targetLineId)!;
    const original = document.lines.find(item => item.id === target.id)!;
    if (target.beginMs === original.beginMs) return line;
    const endMs = target.beginMs;
    if (endMs === null || line.beginMs !== null && line.beginMs > endMs || line.words.some(word => word.endMs !== null && word.endMs > endMs)) {
      throw new Error('打轴会使关联行终点早于行起点或排除已有词，请先处理行尾链接');
    }
    return { ...line, endMs };
  }) };

}
