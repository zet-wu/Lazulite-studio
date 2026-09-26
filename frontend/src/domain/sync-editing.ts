import type { LyricDocument, LyricLine, LyricWord, RubyUnit } from './lyric-document';

export type SyncCursor = { lineId: string; wordId: string; rubyUnitId: string | null };
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

function assign(word: LyricWord, rubyUnitId: string | null, side: 'beginUs' | 'endUs', timeUs: number): LyricWord {
  if (word.alignmentUnits.length) throw new Error('带对齐结果的词需要先处理对齐时间');
  if (!rubyUnitId) {
    const other = side === 'beginUs' ? 'endUs' : 'beginUs';
    return { ...word, [side]: timeUs, [other]: word[other] !== null && (side === 'beginUs' ? word[other] < timeUs : word[other] > timeUs) ? null : word[other] };
  }
  const index = word.rubyUnits.findIndex((unit) => unit.id === rubyUnitId);
  if (index < 0) throw new Error('打轴 Ruby 单元已不存在');
  const rubyUnits = word.rubyUnits.slice();
  const unit = rubyUnits[index];
  const other = side === 'beginUs' ? 'endUs' : 'beginUs';
  rubyUnits[index] = { ...unit, [side]: timeUs, [other]: unit[other] !== null && (side === 'beginUs' ? unit[other] < timeUs : unit[other] > timeUs) ? null : unit[other] } as RubyUnit;
  const starts = rubyUnits.map((item) => item.beginUs).filter((value): value is number => value !== null);
  const ends = rubyUnits.map((item) => item.endUs).filter((value): value is number => value !== null);
  return { ...word, rubyUnits, beginUs: starts.length ? Math.min(...starts) : null, endUs: ends.length ? Math.max(...ends) : null };
}

function updateUnit(line: LyricLine, cursor: SyncCursor, side: 'beginUs' | 'endUs', timeUs: number): LyricLine {
  const index = line.words.findIndex((word) => word.id === cursor.wordId);
  if (index < 0) throw new Error('打轴词已不存在');
  const words = line.words.slice();
  words[index] = assign(words[index], cursor.rubyUnitId, side, timeUs);
  const starts = words.map((word) => word.beginUs).filter((value): value is number => value !== null);
  const ends = words.map((word) => word.endUs).filter((value): value is number => value !== null);
  const beginUs = starts.length ? Math.min(...starts) : line.beginUs;
  const endUs = ends.length ? Math.max(...ends) : line.endUs;
  return { ...line, words, beginUs, endUs, endLink: endUs === line.endUs ? line.endLink : null };
}

export function stampSync(document: LyricDocument, cursor: SyncCursor, action: SyncAction, timeUs: number): LyricDocument {
  if (!Number.isSafeInteger(timeUs) || timeUs < 0) throw new Error('打轴时间必须是非负整数微秒');
  const units = syncUnits(document);
  const index = syncIndex(units, cursor);
  if (index < 0) throw new Error('打轴游标已失效');
  const current = units[index];
  const next = action === 'next' ? units[index + 1] : null;
  const changes = new Map<string, LyricLine>();
  const read = (id: string) => changes.get(id) ?? document.lines.find((line) => line.id === id)!;
  if (action === 'start') changes.set(current.lineId, updateUnit(read(current.lineId), current, 'beginUs', timeUs));
  else {
    const original = read(current.lineId).words.find((word) => word.id === current.wordId)!;
    const begin = current.rubyUnitId ? original.rubyUnits.find((unit) => unit.id === current.rubyUnitId)!.beginUs : original.beginUs;
    if (begin === null) throw new Error('请先为当前单元打起始轴');
    if (timeUs < begin) throw new Error('结束轴不能早于起始轴');
    changes.set(current.lineId, updateUnit(read(current.lineId), current, 'endUs', timeUs));
    if (next) changes.set(next.lineId, updateUnit(read(next.lineId), next, 'beginUs', timeUs));
  }
  return { ...document, lines: document.lines.map((line) => changes.get(line.id) ?? line) };
}
